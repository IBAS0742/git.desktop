/**
 * Tauri compatibility shim for the GitHub Desktop renderer bundle.
 *
 * The renderer is built with webpack `target: 'electron-renderer'`, so the
 * emitted bundle expects the following globals to exist before it evaluates:
 *
 *   - `require`  – Node-style require for externals (`electron`, `path`, ...)
 *   - `module` / `exports` – for the `commonjs2` library output type
 *   - `process`  – EventEmitter-capable process object
 *   - `Buffer`, `global`, `setImmediate`, `__dirname`, `__filename`
 *
 * This file is a webpack entry (`tauri-shim`) that HtmlWebpackPlugin injects
 * before `renderer.js`. It implements the Node/Electron surface on top of the
 * Tauri IPC bridge (`desktop_invoke` / `desktop_send`) and browser APIs.
 *
 * Anything that cannot work inside a webview throws a descriptive error only
 * when actually called, so the UI still boots and degrades gracefully.
 */
;(function () {
  'use strict'

  if (window.__TAURI_SHIM__) {
    return
  }
  window.__TAURI_SHIM__ = true

  var tauri = window.__TAURI__ || null
  var isWindows = /Windows/i.test(navigator.userAgent)
  var isMac = /Macintosh/i.test(navigator.userAgent)
  var platform = isWindows ? 'win32' : isMac ? 'darwin' : 'linux'

  function shimError(what) {
    return new Error(
      '[tauri-shim] ' + what + ' is not available in the Tauri build yet'
    )
  }

  function logWarn() {
    try {
      console.warn.apply(console, ['[tauri-shim]'].concat(
        Array.prototype.slice.call(arguments)
      ))
    } catch (e) {
      /* ignore */
    }
  }

  function desktopInvoke(channel, args) {
    if (!tauri) {
      return Promise.reject(new Error('window.__TAURI__ is not available'))
    }
    return tauri.core.invoke('desktop_invoke', {
      channel: channel,
      args: args || [],
    })
  }

  function desktopSend(channel, args) {
    if (!tauri) {
      return Promise.reject(new Error('window.__TAURI__ is not available'))
    }
    return tauri.core.invoke('desktop_send', {
      channel: channel,
      args: args || [],
    })
  }

  /* ------------------------------------------------------------------ *
   * OAuth token exchange proxy                                            *
   *                                                                       *
   * GitHub's /login/oauth/access_token responds without                   *
   * Access-Control-Allow-Origin, so the webview's fetch would be rejected  *
   * by CORS the moment the sign-in flow tries to trade the callback code   *
   * for a token. Route those POSTs through Rust, which performs the HTTPS  *
   * request outside the webview and hands back status + body verbatim.     *
   * ------------------------------------------------------------------ */

  var originalFetch =
    typeof window.fetch === 'function' ? window.fetch.bind(window) : null

  function isOAuthTokenExchange(url, method) {
    if (!url || String(method || 'get').toUpperCase() !== 'POST') {
      return false
    }
    try {
      return /\/login\/oauth\/access_token$/.test(
        String(url).split('?')[0]
      )
    } catch (e) {
      return false
    }
  }

  if (originalFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : input && input.url
      var options = init || (input && typeof input === 'object' ? input : null)
      if (options && isOAuthTokenExchange(url, options.method)) {
        var body = typeof options.body === 'string' ? options.body : ''
        return tauri.core
          .invoke('oauth_token_exchange', { url: url, body: body })
          .then(function (result) {
            return new Response((result && result.body) || '', {
              status: (result && result.status) || 200,
              headers: { 'Content-Type': 'application/json' },
            })
          })
          .catch(function (err) {
            // Match fetch's rejection shape: callers treat this as a
            // network failure, which oauth-token.ts reports generically.
            throw new TypeError(
              String((err && err.message) || err || 'NetworkError')
            )
          })
      }
      return originalFetch(input, init)
    }
  }

  /* ------------------------------------------------------------------ *
   * Async-filled caches for values that Electron exposes synchronously  *
   * ------------------------------------------------------------------ */

  var pathCache = {}
  var homedirCache = ''
  var tmpdirCache = ''

  ;['home', 'temp', 'appData', 'userData', 'logs', 'desktop', 'documents'].forEach(
    function (name) {
      desktopInvoke('get-path', [name])
        .then(function (value) {
          if (typeof value === 'string' && value.length > 0) {
            pathCache[name] = value
            if (name === 'home') homedirCache = value
            if (name === 'temp') tmpdirCache = value
          }
        })
        .catch(function () {
          /* not fatal */
        })
    }
  )

  /* ------------------------------------------------------------------ *
   * EventEmitter (needed by `events`, `process` and friends)           *
   * ------------------------------------------------------------------ */

  function EventEmitter() {
    this._events = Object.create(null)
    this._maxListeners = 10
  }

  EventEmitter.defaultMaxListeners = 10

  EventEmitter.prototype.addListener = function (type, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type Function')
    }
    var events = this._events
    ;(events[type] = events[type] || []).push(listener)
    return this
  }
  EventEmitter.prototype.on = EventEmitter.prototype.addListener

  EventEmitter.prototype.prependListener = function (type, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type Function')
    }
    var events = this._events
    ;(events[type] = events[type] || []).unshift(listener)
    return this
  }

  EventEmitter.prototype.once = function (type, listener) {
    var self = this
    function onceWrapper() {
      self.removeListener(type, onceWrapper)
      listener.apply(self, arguments)
    }
    onceWrapper.listener = listener
    return this.on(type, onceWrapper)
  }

  EventEmitter.prototype.removeListener = function (type, listener) {
    var list = this._events[type]
    if (!list) return this
    for (var i = 0; i < list.length; i++) {
      if (list[i] === listener || list[i].listener === listener) {
        list.splice(i, 1)
        break
      }
    }
    if (list.length === 0) delete this._events[type]
    return this
  }
  EventEmitter.prototype.off = EventEmitter.prototype.removeListener

  EventEmitter.prototype.removeAllListeners = function (type) {
    if (type !== undefined) delete this._events[type]
    else this._events = Object.create(null)
    return this
  }

  EventEmitter.prototype.emit = function (type) {
    var list = this._events[type]
    if (!list || list.length === 0) {
      if (type === 'error') {
        var err = arguments[1]
        if (err instanceof Error) throw err
        throw new Error('Unhandled error event: ' + err)
      }
      return false
    }
    var args = Array.prototype.slice.call(arguments, 1)
    var copy = list.slice()
    for (var i = 0; i < copy.length; i++) {
      try {
        copy[i].apply(this, args)
      } catch (e) {
        logWarn('listener for', type, 'threw', e)
      }
    }
    return true
  }

  EventEmitter.prototype.listenerCount = function (type) {
    return (this._events[type] || []).length
  }
  EventEmitter.prototype.listeners = function (type) {
    return (this._events[type] || []).slice()
  }
  EventEmitter.prototype.eventNames = function () {
    return Object.keys(this._events)
  }
  EventEmitter.prototype.setMaxListeners = function (n) {
    this._maxListeners = n
    return this
  }
  EventEmitter.prototype.getMaxListeners = function () {
    return this._maxListeners
  }

  /* ------------------------------------------------------------------ *
   * process                                                            *
   * ------------------------------------------------------------------ */

  var proc = new EventEmitter()
  proc.platform = platform
  proc.arch = 'x64'
  proc.type = 'renderer'
  proc.versions = {
    chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1],
    electron: '44.1.1',
    node: '22.17.1',
    v8: '12.4.254.20-node.22',
    webview: navigator.userAgent.match(/Edg\/([\d.]+)/)?.[1],
  }
  proc.version = 'v22.17.1'
  proc.revision = '44.1.1'
  proc.env = {}
  proc.argv = ['github-desktop']
  proc.execPath = ''
  proc.pid = 0
  proc.title = 'github-desktop'
  proc.ppid = 0
  proc.exit = function (code) {
    desktopSend('quit-app').catch(function () {})
    logWarn('process.exit(' + code + ') -> quit-app')
  }
  proc.abort = function () {
    throw new Error('process.abort() is not supported')
  }
  proc.cwd = function () {
    return homedirCache || 'C:\\'
  }
  proc.chdir = function () {
    throw shimError('process.chdir')
  }
  proc.nextTick = function (fn) {
    var args = Array.prototype.slice.call(arguments, 1)
    queueMicrotask(function () {
      fn.apply(null, args)
    })
  }
  proc.hrtime = function (prev) {
    var ns = Math.round(performance.now() * 1e6)
    var s = Math.floor(ns / 1e9)
    var n = ns % 1e9
    if (prev) {
      n -= prev[1]
      s -= prev[0]
      if (n < 0) {
        s -= 1
        n += 1e9
      }
    }
    return [s, n]
  }
  proc.stdout = {
    write: function (chunk) {
      console.log(String(chunk))
      return true
    },
    isTTY: false,
    columns: 80,
    on: function () {},
    once: function () {},
    emit: function () {},
  }
  proc.stderr = {
    write: function (chunk) {
      console.error(String(chunk))
      return true
    },
    isTTY: false,
    columns: 80,
    on: function () {},
    once: function () {},
    emit: function () {},
  }
  proc.stdin = { on: function () {}, once: function () {}, resume: function () {} }
  proc.umask = function () {
    return 0
  }
  proc.kill = function () {
    throw shimError('process.kill')
  }
  proc.binding = function (name) {
    if (name === 'uv') {
      // execa reads libuv errno constants through this private API to name
      // child-process failures; a small map keeps that code path quiet.
      var errnoMap = {
        EPERM: -1,
        ENOENT: -2,
        ESRCH: -3,
        EINTR: -4,
        EIO: -5,
        ENXIO: -6,
        E2BIG: -7,
        ENOEXEC: -8,
        EBADF: -9,
        ECHILD: -10,
        EAGAIN: -11,
        ENOMEM: -12,
        EACCES: -13,
        EFAULT: -14,
        EBUSY: -16,
        EEXIST: -17,
        EXDEV: -18,
        ENODEV: -19,
        ENOTDIR: -20,
        EISDIR: -21,
        EINVAL: -22,
        ENFILE: -23,
        EMFILE: -24,
        ENOTTY: -25,
        EFBIG: -27,
        ENOSPC: -28,
        ESPIPE: -29,
        EROFS: -30,
        EMLINK: -31,
        EPIPE: -32,
        ERANGE: -34,
        ENAMETOOLONG: -38,
        ELOOP: -40,
        ENOTEMPTY: -41,
        EADDRINUSE: -100,
        EADDRNOTAVAIL: -99,
        ENETDOWN: -100,
        ENETUNREACH: -101,
        ECONNABORTED: -103,
        ECONNRESET: -104,
        ENOBUFS: -105,
        EISCONN: -106,
        ENOTCONN: -107,
        ETIMEDOUT: -110,
        ECONNREFUSED: -111,
        EHOSTUNREACH: -113,
        EALREADY: -114,
        ECANCELED: -105,
      }
      return {
        errno: errnoMap,
        // execa maps libuv error numbers back to names through this helper.
        errname: function (code) {
          var n = Number(code)
          var keys = Object.keys(errnoMap)
          for (var i = 0; i < keys.length; i++) {
            if (errnoMap[keys[i]] === n) return keys[i]
          }
          return 'UNKNOWN'
        },
      }
    }
    throw shimError('process.binding(' + name + ')')
  }
  proc.on('uncaughtException', function (err) {
    logWarn('uncaughtException', err)
  })

  /* ------------------------------------------------------------------ *
   * Buffer                                                             *
   * ------------------------------------------------------------------ */

  function ShimBuffer() {
    var args = Array.prototype.slice.call(arguments)
    if (!(this instanceof ShimBuffer)) {
      return ShimBuffer.from.apply(ShimBuffer, args)
    }
    return ShimBuffer.alloc.apply(ShimBuffer, args)
  }

  ShimBuffer.prototype = Object.create(Uint8Array.prototype)
  ShimBuffer.prototype.constructor = ShimBuffer

  ShimBuffer.alloc = function (size, fill, encoding) {
    var buf = new Uint8Array(size)
    if (fill !== undefined && fill !== 0) {
      if (typeof fill === 'string') {
        var bytes = encodeUtf8(fill)
        for (var i = 0; i < size; i++) buf[i] = bytes[i % bytes.length]
      } else {
        buf.fill(Number(fill) & 0xff)
      }
    }
    return wrap(buf)
  }
  ShimBuffer.allocUnsafe = function (size) {
    return wrap(new Uint8Array(size))
  }
  ShimBuffer.allocUnsafeSlow = ShimBuffer.allocUnsafe
  ShimBuffer.isEncoding = function (enc) {
    return /^(utf-?8|ascii|latin1|binary|hex|base64|ucs2|utf16le)$/i.test(
      String(enc || '')
    )
  }
  ShimBuffer.from = function (value, encodingOrOffset, length) {
    if (typeof value === 'string') {
      return wrap(encodeUtf8(value))
    }
    if (value instanceof ArrayBuffer) {
      return wrap(new Uint8Array(value, encodingOrOffset, length))
    }
    if (ArrayBuffer.isView(value)) {
      return wrap(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      )
    }
    if (Array.isArray(value)) {
      return wrap(new Uint8Array(value))
    }
    if (value && typeof value === 'object' && value.type === 'Buffer') {
      return wrap(new Uint8Array(value.data))
    }
    return wrap(new Uint8Array(0))
  }
  ShimBuffer.concat = function (list, totalLength) {
    if (!Array.isArray(list)) list = [list]
    var len =
      totalLength !== undefined
        ? totalLength
        : list.reduce(function (acc, b) {
            return acc + b.length
          }, 0)
    var out = new Uint8Array(len)
    var offset = 0
    list.forEach(function (b) {
      out.set(asBytes(b), offset)
      offset += b.length
    })
    return wrap(out)
  }
  ShimBuffer.isBuffer = function (value) {
    return value && value.__shimBuffer === true
  }
  ShimBuffer.byteLength = function (str, encoding) {
    if (typeof str === 'string') return encodeUtf8(str).length
    if (ArrayBuffer.isView(str)) return str.byteLength
    if (str instanceof ArrayBuffer) return str.byteLength
    return 0
  }
  ShimBuffer.compare = function (a, b) {
    var ab = asBytes(a)
    var bb = asBytes(b)
    var len = Math.min(ab.length, bb.length)
    for (var i = 0; i < len; i++) {
      if (ab[i] !== bb[i]) return ab[i] < bb[i] ? -1 : 1
    }
    return ab.length === bb.length ? 0 : ab.length < bb.length ? -1 : 1
  }

  function wrap(u8) {
    Object.setPrototypeOf(u8, ShimBuffer.prototype)
    u8.__shimBuffer = true
    u8.toString = bufferToString
    return u8
  }

  ShimBuffer.prototype.slice = function (start, end) {
    var s = start === undefined ? 0 : start < 0 ? this.length + start : start
    var e = end === undefined ? this.length : end < 0 ? this.length + end : end
    if (s < 0) s = 0
    if (e > this.length) e = this.length
    var len = Math.max(e - s, 0)
    var out = new Uint8Array(len)
    for (var i = 0; i < len; i++) out[i] = this[s + i]
    return wrap(out)
  }
  ShimBuffer.prototype.subarray = function (start, end) {
    var s = start === undefined ? 0 : start < 0 ? this.length + start : start
    var e = end === undefined ? this.length : end < 0 ? this.length + end : end
    if (s < 0) s = 0
    if (e > this.length) e = this.length
    return wrap(
      new Uint8Array(this.buffer, this.byteOffset + s, Math.max(e - s, 0))
    )
  }
  ShimBuffer.prototype.copy = function (target, targetStart, sourceStart, sourceEnd) {
    var src = this.subarray(sourceStart || 0, sourceEnd || this.length)
    target.set(src, targetStart || 0)
    return src.length
  }
  ShimBuffer.prototype.equals = function (other) {
    return ShimBuffer.compare(this, other) === 0
  }
  ShimBuffer.prototype.toJSON = function () {
    var data = []
    for (var i = 0; i < this.length; i++) data.push(this[i])
    return { type: 'Buffer', data: data }
  }
  ShimBuffer.prototype.write = function (str, offset, encoding) {
    var bytes = encodeUtf8(String(str))
    this.set(bytes, offset || 0)
    return bytes.length
  }

  function asBytes(value) {
    if (value instanceof Uint8Array) return value
    return ShimBuffer.from(value)
  }

  function bufferToString(encoding, start, end) {
    encoding = encoding || 'utf8'
    start = start || 0
    end = end === undefined ? this.length : end
    var view = this.subarray(start, end)
    if (encoding === 'hex') {
      var hex = ''
      for (var i = 0; i < view.length; i++) {
        hex += view[i].toString(16).padStart(2, '0')
      }
      return hex
    }
    if (encoding === 'base64') {
      var bin = ''
      for (var j = 0; j < view.length; j++) bin += String.fromCharCode(view[j])
      return btoa(bin)
    }
    if (encoding === 'latin1' || encoding === 'binary') {
      var s = ''
      for (var k = 0; k < view.length; k++) s += String.fromCharCode(view[k])
      return s
    }
    if (encoding === 'utf16le' || encoding === 'ucs2') {
      var out = ''
      for (var m = 0; m + 1 < view.length; m += 2) {
        out += String.fromCharCode(view[m] + (view[m + 1] << 8))
      }
      return out
    }
    // utf8
    try {
      return new TextDecoder('utf-8').decode(view)
    } catch (e) {
      var res = ''
      var n = 0
      while (n < view.length) {
        var c = view[n++]
        if (c < 0x80) res += String.fromCharCode(c)
        else if (c < 0xe0) {
          res += String.fromCharCode(((c & 0x1f) << 6) | (view[n++] & 0x3f))
        } else if (c < 0xf0) {
          res += String.fromCharCode(
            ((c & 0xf) << 12) | ((view[n++] & 0x3f) << 6) | (view[n++] & 0x3f)
          )
        } else {
          var cp =
            ((c & 0x7) << 18) |
            ((view[n++] & 0x3f) << 12) |
            ((view[n++] & 0x3f) << 6) |
            (view[n++] & 0x3f)
          cp -= 0x10000
          res += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
        }
      }
      return res
    }
  }

  function encodeUtf8(str) {
    var bytes = []
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i)
      if (c < 0x80) bytes.push(c)
      else if (c < 0x800) {
        bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var cp = 0x10000 + ((c & 0x3ff) << 10) + (str.charCodeAt(++i) & 0x3ff)
        bytes.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        )
      } else {
        bytes.push(
          0xe0 | (c >> 12),
          0x80 | ((c >> 6) & 0x3f),
          0x80 | (c & 0x3f)
        )
      }
    }
    return new Uint8Array(bytes)
  }

  /* ------------------------------------------------------------------ *
   * path (win32-aware)                                                 *
   * ------------------------------------------------------------------ */

  function makePathModule(winStyle) {
    var SEP = winStyle ? '\\' : '/'
    var sep = SEP
    var delimiter = winStyle ? ';' : ':'

    function isPathSeparator(code) {
      return code === 47 /* / */ || (winStyle && code === 92) /* \ */
    }

    function isWindowsDeviceRoot(code) {
      return (
        winStyle && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))
      )
    }

    function normalizeString(path, allowAboveRoot) {
      var res = ''
      var lastSegmentLength = 0
      var lastSlash = -1
      var dots = 0
      var code = 0
      for (var i = 0; i <= path.length; ++i) {
        if (i < path.length) code = path.charCodeAt(i)
        else if (isPathSeparator(code)) break
        else code = 47 /* / */

        if (isPathSeparator(code)) {
          if (lastSlash === i - 1 || dots === 1) {
            // NOOP
          } else if (dots === 2) {
            if (
              res.length < 2 ||
              lastSegmentLength !== 2 ||
              res.charCodeAt(res.length - 1) !== 46 ||
              res.charCodeAt(res.length - 2) !== 46
            ) {
              if (res.length > 2) {
                var lastSlashIndex = res.lastIndexOf(SEP)
                if (lastSlashIndex === -1) {
                  res = ''
                  lastSegmentLength = 0
                } else {
                  res = res.slice(0, lastSlashIndex)
                  lastSegmentLength = res.length - 1 - res.lastIndexOf(SEP)
                }
                lastSlash = i
                dots = 0
                continue
              } else if (res.length !== 0) {
                res = ''
                lastSegmentLength = 0
                lastSlash = i
                dots = 0
                continue
              }
            }
            if (allowAboveRoot) {
              res += (res.length > 0 ? SEP : '') + '..'
              lastSegmentLength = 2
            }
          } else {
            if (res.length > 0) {
              res += SEP + path.slice(lastSlash + 1, i)
            } else {
              res = path.slice(lastSlash + 1, i)
            }
            lastSegmentLength = i - lastSlash - 1
          }
          lastSlash = i
          dots = 0
        } else if (code === 46 /* . */ && dots !== -1) {
          ++dots
        } else {
          dots = -1
        }
      }
      return res
    }

    function normalize(path) {
      if (typeof path !== 'string') {
        throw new TypeError(
          'The "path" argument must be of type string. Received ' +
            (path === null ? 'null' : typeof path)
        )
      }
      if (path.length === 0) return '.'
      var len = path.length
      var rootEnd = 0
      var code = path.charCodeAt(0)

      // Try to match a root
      if (len === 1) {
        return winStyle && isPathSeparator(code) ? path : '.'
      }
      if (isPathSeparator(code)) {
        rootEnd = 1
        if (isPathSeparator(path.charCodeAt(1))) {
          // Possible UNC path
          var j = 2
          var last = j
          while (j < len && !isPathSeparator(path.charCodeAt(j))) ++j
          if (j < len && !isPathSeparator(path.charCodeAt(j - 1))) {
            last = j
            while (j < len && isPathSeparator(path.charCodeAt(j))) ++j
          }
          if (j < len) {
            last = j
            while (j < len && !isPathSeparator(path.charCodeAt(j))) ++j
          }
          rootEnd = j
        }
      } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === 58) {
        rootEnd = 2
        if (len > 2 && isPathSeparator(path.charCodeAt(2))) rootEnd = 3
      }

      var tail = rootEnd < len ? normalizeString(path.slice(rootEnd), false) : ''
      if (rootEnd === 0) return tail.length > 0 ? tail : '.'
      if (tail.length === 0) return path.slice(0, rootEnd)
      if (isPathSeparator(path.charCodeAt(rootEnd - 1))) {
        // The root already ends with a separator ("C:\\" or "/").
        return path.slice(0, rootEnd) + tail
      }
      return path.slice(0, rootEnd) + SEP + tail
    }

    function join() {
      if (arguments.length === 0) return '.'
      var joined = ''
      for (var i = 0; i < arguments.length; ++i) {
        var arg = arguments[i]
        if (arg.length > 0) {
          if (joined === '') joined = arg
          else joined += SEP + arg
        }
      }
      if (joined === '') return '.'
      return winStyle ? normalize(joined.replace(/[\\/]+/g, '\\')) : normalize(joined.replace(/\/+/g, '/'))
    }

    function resolve() {
      var resolvedPath = ''
      var resolvedAbsolute = false

      for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
        var path
        if (i >= 0) path = arguments[i]
        else path = homedirCache || (winStyle ? 'C:\\' : '/')

        if (path.length === 0) continue
        resolvedPath = path + SEP + resolvedPath
        resolvedAbsolute = isPathSeparator(path.charCodeAt(0))
      }

      resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute)
      if (resolvedAbsolute) {
        if (winStyle && resolvedPath.charCodeAt(0) === 47 /* / */) {
          resolvedPath = resolvedPath.charCodeAt(1) === 47 /* / */ ? '\\' + resolvedPath.slice(1) : '\\' + resolvedPath.slice(1)
        } else {
          resolvedPath = SEP + resolvedPath
        }
      }
      return winStyle ? resolvedPath.replace(/[\\/]+/g, '\\') : resolvedPath.replace(/\/+/g, '/')
    }

    function isAbsolute(path) {
      if (typeof path !== 'string') {
        throw new TypeError('The "path" argument must be of type string')
      }
      if (path.length === 0) return false
      return isPathSeparator(path.charCodeAt(0))
    }

    function dirname(path) {
      if (typeof path !== 'string') {
        throw new TypeError('The "path" argument must be of type string')
      }
      if (path.length === 0) return '.'
      var hasRoot = isPathSeparator(path.charCodeAt(0))
      var end = -1
      var matchedSlash = true
      for (var i = path.length - 1; i >= 1; --i) {
        if (isPathSeparator(path.charCodeAt(i))) {
          if (!matchedSlash) {
            end = i
            break
          }
        } else {
          matchedSlash = false
        }
      }
      if (end === -1) return hasRoot ? (winStyle ? '\\' : '/') : '.'
      if (hasRoot && end === 1) return winStyle ? '\\\\' : '/'
      return path.slice(0, end)
    }

    function basename(path, suffix) {
      if (typeof path !== 'string') {
        throw new TypeError('The "path" argument must be of type string')
      }
      var start = 0
      var end = -1
      var matchedSlash = true

      if (
        suffix !== undefined &&
        suffix.length > 0 &&
        suffix.length <= path.length
      ) {
        if (suffix === path) return ''
        var extIdx = suffix.length - 1
        var firstNonSlashEnd = -1
        for (var i = path.length - 1; i >= 0; --i) {
          var code = path.charCodeAt(i)
          if (isPathSeparator(code)) {
            if (!matchedSlash) {
              start = i + 1
              break
            }
          } else {
            if (firstNonSlashEnd === -1) {
              matchedSlash = false
              firstNonSlashEnd = i + 1
            }
            if (extIdx >= 0) {
              if (code === suffix.charCodeAt(extIdx)) {
                if (--extIdx === -1) end = i
              } else {
                extIdx = -1
                end = i
              }
            }
          }
        }
        if (start === end) end = firstNonSlashEnd
        else if (end === -1) end = path.length
        return path.slice(start, end)
      }

      for (var k = path.length - 1; k >= 0; --k) {
        if (isPathSeparator(path.charCodeAt(k))) {
          if (!matchedSlash) {
            start = k + 1
            break
          }
        } else if (end === -1) {
          matchedSlash = false
          end = k + 1
        }
      }
      if (end === -1) return ''
      return path.slice(start, end)
    }

    function extname(path) {
      if (typeof path !== 'string') {
        throw new TypeError('The "path" argument must be of type string')
      }
      var startDot = -1
      var startPart = 0
      var end = -1
      var matchedSlash = true
      var preDotState = 0
      for (var i = path.length - 1; i >= 0; --i) {
        var code = path.charCodeAt(i)
        if (isPathSeparator(code)) {
          if (!matchedSlash) {
            startPart = i + 1
            break
          }
          continue
        }
        if (end === -1) {
          matchedSlash = false
          end = i + 1
        }
        if (code === 46 /* . */) {
          if (startDot === -1) startDot = i
          else if (preDotState !== 1) preDotState = 1
        } else if (startDot !== -1) {
          preDotState = -1
        }
      }
      if (
        startDot === -1 ||
        end === -1 ||
        preDotState === 0 ||
        (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
      ) {
        return ''
      }
      return path.slice(startDot, end)
    }

    function splitForRelative(p) {
      var s = winStyle
        ? p.replace(/^[a-zA-Z]:[\\/]/, '').replace(/\\/g, '\\')
        : p.replace(/^\//, '')
      return s.split(winStyle ? /[\\/]+/ : /\/+/).filter(function (seg) {
        return seg.length > 0 && seg !== '.'
      })
    }

    function relative(from, to) {
      if (typeof from !== 'string' || typeof to !== 'string') {
        throw new TypeError('The "from" and "to" arguments must be strings')
      }
      from = resolve(from)
      to = resolve(to)
      if (from === to) return ''

      var fromParts = splitForRelative(from)
      var toParts = splitForRelative(to)
      var n = Math.min(fromParts.length, toParts.length)
      var i = 0
      for (; i < n; i++) {
        var a = fromParts[i]
        var b = toParts[i]
        if (winStyle) {
          a = a.toLowerCase()
          b = b.toLowerCase()
        }
        if (a !== b) break
      }

      var ups = fromParts.length - i
      var out = []
      for (var k = 0; k < ups; k++) out.push('..')
      out = out.concat(toParts.slice(i))
      if (out.length === 0) return '.'
      return out.join(SEP)
    }

    function parse(path) {
      var ret = { root: '', dir: '', base: '', ext: '', name: '' }
      if (typeof path !== 'string' || path.length === 0) return ret
      var isAbs = isAbsolute(path)
      var start
      if (isAbs) {
        ret.root = winStyle && path.charCodeAt(0) === 47 ? '\\' : SEP
        start = winStyle && path.charCodeAt(0) === 47 && path.charCodeAt(1) === 47 ? 2 : 1
      } else {
        start = 0
      }
      var dir = dirname(path)
      var base = basename(path)
      ret.dir = dir
      ret.base = base
      ret.name = base
      var ext = extname(path)
      ret.ext = ext
      return ret
    }

    return {
      sep: sep,
      delimiter: delimiter,
      join: join,
      resolve: resolve,
      normalize: normalize,
      isAbsolute: isAbsolute,
      dirname: dirname,
      basename: basename,
      extname: extname,
      relative: relative,
      parse: parse,
      format: function (obj) {
        var dir = obj.dir || obj.root
        var base = obj.base || (obj.name || '') + (obj.ext || '')
        if (!dir) return base
        return dir === obj.root ? dir + base : dir + (winStyle ? '\\' : '/') + base
      },
      toNamespacedPath: function (p) {
        return p
      },
    }
  }

  var pathWin32 = makePathModule(true)
  var pathPosix = makePathModule(false)
  var pathModule = platform === 'win32' ? pathWin32 : pathPosix
  pathModule.win32 = pathWin32
  pathModule.posix = pathPosix

  /* ------------------------------------------------------------------ *
   * os                                                                 *
   * ------------------------------------------------------------------ */

  // Windows releases are semver-compared by some libraries (e.g.
  // windows-versions checks `release >= 10.0.17666` to detect Windows 11),
  // so this must never be an empty string. Default to this machine's real
  // build and refine asynchronously from User-Agent Client Hints where
  // available.
  var osReleaseCache = isWindows
    ? '10.0.26100'
    : isMac
      ? '23.5.0'
      : '6.8.0'

  if (
    isWindows &&
    navigator.userAgentData &&
    typeof navigator.userAgentData.getHighEntropyValues === 'function'
  ) {
    navigator.userAgentData
      .getHighEntropyValues(['platformVersion'])
      .then(function (hints) {
        var major = parseInt(
          String((hints && hints.platformVersion) || '').split('.')[0],
          10
        )
        if (!isNaN(major)) {
          // Chromium reports 15.0+ for Windows 11 and 10.0/13.0 for Windows 10.
          osReleaseCache = major >= 15 ? '10.0.26100' : '10.0.19045'
        }
      })
      .catch(function () {
        /* keep default */
      })
  }

  var osModule = {
    platform: function () {
      return platform
    },
    type: function () {
      return platform === 'win32' ? 'Windows_NT' : platform === 'darwin' ? 'Darwin' : 'Linux'
    },
    arch: function () {
      return proc.arch
    },
    EOL: platform === 'win32' ? '\r\n' : '\n',
    homedir: function () {
      return homedirCache
    },
    tmpdir: function () {
      return tmpdirCache
    },
    hostname: function () {
      return 'localhost'
    },
    release: function () {
      return osReleaseCache
    },
    version: function () {
      return osReleaseCache
    },
    totalmem: function () {
      return 0
    },
    freemem: function () {
      return 0
    },
    uptime: function () {
      return Math.round(performance.now() / 1000)
    },
    cpus: function () {
      return []
    },
    loadavg: function () {
      return [0, 0, 0]
    },
    networkInterfaces: function () {
      return {}
    },
    userInfo: function () {
      return { username: '', homedir: homedirCache, shell: platform === 'win32' ? 'cmd.exe' : '/bin/sh' }
    },
    endianness: function () {
      return 'LE'
    },
    availableParallelism: function () {
      return navigator.hardwareConcurrency || 4
    },
  }

  /* ------------------------------------------------------------------ *
   * crypto (sync hashing)                                              *
   * ------------------------------------------------------------------ */

  function sha1Bytes(msg) {
    var bytes = msg instanceof Uint8Array ? msg : encodeUtf8(String(msg))
    var ml = bytes.length * 8
    var withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
    withOne.set(bytes)
    withOne[bytes.length] = 0x80
    var dv = new DataView(withOne.buffer)
    dv.setUint32(withOne.length - 4, ml >>> 0, false)
    dv.setUint32(withOne.length - 8, Math.floor(ml / 0x100000000), false)

    var h0 = 0x67452301
    var h1 = 0xefcdab89
    var h2 = 0x98badcfe
    var h3 = 0x10325476
    var h4 = 0xc3d2e1f0
    var w = new Int32Array(80)

    for (var i = 0; i < withOne.length; i += 64) {
      for (var t = 0; t < 16; t++) {
        w[t] = dv.getInt32(i + t * 4, false)
      }
      for (t = 16; t < 80; t++) {
        var n = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]
        w[t] = (n << 1) | (n >>> 31)
      }
      var a = h0
      var b = h1
      var c = h2
      var d = h3
      var e = h4
      for (t = 0; t < 80; t++) {
        var f
        var k
        if (t < 20) {
          f = (b & c) | (~b & d)
          k = 0x5a827999
        } else if (t < 40) {
          f = b ^ c ^ d
          k = 0x6ed9eba1
        } else if (t < 60) {
          f = (b & c) | (b & d) | (c & d)
          k = 0x8f1bbcdc
        } else {
          f = b ^ c ^ d
          k = 0xca62c1d6
        }
        var tmp = ((((a << 5) | (a >>> 27)) + f) | 0) + e + k + w[t] | 0
        e = d
        d = c
        c = (b << 30) | (b >>> 2)
        b = a
        a = tmp
      }
      h0 = (h0 + a) | 0
      h1 = (h1 + b) | 0
      h2 = (h2 + c) | 0
      h3 = (h3 + d) | 0
      h4 = (h4 + e) | 0
    }

    return [
      h0 >>> 24, (h0 >>> 16) & 0xff, (h0 >>> 8) & 0xff, h0 & 0xff,
      h1 >>> 24, (h1 >>> 16) & 0xff, (h1 >>> 8) & 0xff, h1 & 0xff,
      h2 >>> 24, (h2 >>> 16) & 0xff, (h2 >>> 8) & 0xff, h2 & 0xff,
      h3 >>> 24, (h3 >>> 16) & 0xff, (h3 >>> 8) & 0xff, h3 & 0xff,
      h4 >>> 24, (h4 >>> 16) & 0xff, (h4 >>> 8) & 0xff, h4 & 0xff,
    ]
  }

  function toBytes(input) {
    if (input instanceof Uint8Array) return input
    if (typeof input === 'string') return encodeUtf8(input)
    if (input && input.__shimBuffer) return input
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    if (input instanceof ArrayBuffer) return new Uint8Array(input)
    return encodeUtf8(String(input))
  }

  function bytesToHex(bytes) {
    var hex = ''
    for (var i = 0; i < bytes.length; i++) {
      hex += (bytes[i] >>> 0).toString(16).padStart(2, '0')
    }
    return hex
  }

  var _sha256K = null
  function sha256Bytes(msg) {
    // Compact SHA-256 implementation
    var K = _sha256K || (_sha256K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ])
    var bytes = toBytes(msg)
    var ml = bytes.length * 8
    var withOne = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6))
    withOne.set(bytes)
    withOne[bytes.length] = 0x80
    var dv = new DataView(withOne.buffer)
    dv.setUint32(withOne.length - 4, ml >>> 0, false)
    dv.setUint32(withOne.length - 8, Math.floor(ml / 0x100000000), false)

    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]
    var w = new Int32Array(64)

    for (var i = 0; i < withOne.length; i += 64) {
      for (var t = 0; t < 16; t++) w[t] = dv.getInt32(i + t * 4, false)
      for (t = 16; t < 64; t++) {
        var s0 = ((w[t-15] >>> 7) | (w[t-15] << 25)) ^ ((w[t-15] >>> 18) | (w[t-15] << 14)) ^ (w[t-15] >>> 3)
        var s1 = ((w[t-2] >>> 17) | (w[t-2] << 15)) ^ ((w[t-2] >>> 19) | (w[t-2] << 13)) ^ (w[t-2] >>> 10)
        w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
        var ch = (e & f) ^ (~e & g)
        var temp1 = (h + S1 + ch + K[t] + w[t]) | 0
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
        var maj = (a & b) ^ (a & c) ^ (b & c)
        var temp2 = (S0 + maj) | 0
        h = g; g = f; f = e; e = (d + temp1) | 0
        d = c; c = b; b = a; a = (temp1 + temp2) | 0
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0
    }
    var out = new Uint8Array(32)
    for (var j = 0; j < 8; j++) {
      out[j * 4] = (H[j] >>> 24) & 0xff
      out[j * 4 + 1] = (H[j] >>> 16) & 0xff
      out[j * 4 + 2] = (H[j] >>> 8) & 0xff
      out[j * 4 + 3] = H[j] & 0xff
    }
    return out
  }

  var _md5Table = null
  function md5Bytes(msg) {
    if (!_md5Table) {
      _md5Table = new Int32Array(64)
      for (var i = 0; i < 64; i++) {
        _md5Table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000)
      }
    }
    var bytes = toBytes(msg)
    var ml = bytes.length * 8
    var withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
    withOne.set(bytes)
    withOne[bytes.length] = 0x80
    var dv = new DataView(withOne.buffer)
    dv.setUint32(withOne.length - 8, ml >>> 0, true)
    dv.setUint32(withOne.length - 4, Math.floor(ml / 0x100000000), true)

    var a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476
    var shift = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
                 5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
                 4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
                 6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21]

    for (var off = 0; off < withOne.length; off += 64) {
      var x = new Int32Array(16)
      for (var k = 0; k < 16; k++) x[k] = dv.getInt32(off + k * 4, true)
      var A = a, B = b, C = c, D = d
      for (var m = 0; m < 64; m++) {
        var f, g
        if (m < 16) { f = (B & C) | (~B & D); g = m }
        else if (m < 32) { f = (D & B) | (~D & C); g = (5 * m + 1) & 15 }
        else if (m < 48) { f = B ^ C ^ D; g = (3 * m + 5) & 15 }
        else { f = C ^ (B | ~D); g = (7 * m) & 15 }
        f = (f + A + _md5Table[m] + x[g]) | 0
        A = D; D = C; C = B
        B = (B + ((f << shift[m]) | (f >>> (32 - shift[m])))) | 0
      }
      a = (a + A) | 0; b = (b + B) | 0; c = (c + C) | 0; d = (d + D) | 0
    }
    var out = new Uint8Array(16)
    var odv = new DataView(out.buffer)
    odv.setUint32(0, a, true)
    odv.setUint32(4, b, true)
    odv.setUint32(8, c, true)
    odv.setUint32(12, d, true)
    return out
  }

  var hashers = {
    sha1: sha1Bytes,
    sha256: sha256Bytes,
    md5: md5Bytes,
    sha512: null, // lazy reject
  }

  function createHash(algorithm) {
    var algo = String(algorithm).toLowerCase().replace('-', '')
    var impl = hashers[algo]
    if (!impl) {
      if (algo === 'sha512') {
        impl = function () {
          throw shimError('createHash(' + algorithm + ')')
        }
      } else {
        throw new Error('[tauri-shim] Unknown hash algorithm: ' + algorithm)
      }
    }
    var chunks = []
    return {
      update: function (data) {
        chunks.push(toBytes(data))
        return this
      },
      digest: function (encoding) {
        var total = chunks.reduce(function (n, c) {
          return n + c.length
        }, 0)
        var joined = new Uint8Array(total)
        var offset = 0
        chunks.forEach(function (c) {
          joined.set(c, offset)
          offset += c.length
        })
        var result = impl(joined)
        if (encoding === 'hex' || encoding === undefined) return bytesToHex(result)
        if (encoding === 'base64') {
          var bin = ''
          for (var i = 0; i < result.length; i++) bin += String.fromCharCode(result[i])
          return btoa(bin)
        }
        return result
      },
    }
  }

  var cryptoModule = {
    createHash: createHash,
    randomBytes: function (size) {
      var bytes = new Uint8Array(size)
      crypto.getRandomValues(bytes)
      var buf = ShimBuffer.from(bytes)
      buf.toString = function (enc) {
        if (enc === 'hex') return bytesToHex(bytes)
        if (enc === 'base64') {
          var bin = ''
          for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
          return btoa(bin)
        }
        return bufferToString.call(bytes, 'utf8')
      }
      return buf
    },
    randomUUID: function () {
      return crypto.randomUUID()
    },
    randomFillSync: function (buf) {
      var view = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
      crypto.getRandomValues(view)
      return buf
    },
    randomFill: function (buf, cb) {
      cryptoModule.randomFillSync(buf)
      cb(null, buf)
    },
    constants: { MAX_STRING_LENGTH: 0x7fffffff },
    timingSafeEqual: function (a, b) {
      a = toBytes(a)
      b = toBytes(b)
      if (a.length !== b.length) return false
      var diff = 0
      for (var i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
      return diff === 0
    },
  }

  /* ------------------------------------------------------------------ *
   * util                                                               *
   * ------------------------------------------------------------------ */

  function formatValue(v) {
    if (typeof v === 'string') return v
    if (v instanceof Error) return v.stack || String(v)
    try {
      return JSON.stringify(v)
    } catch (e) {
      return String(v)
    }
  }

  var utilModule = {
    format: function () {
      var args = Array.prototype.slice.call(arguments)
      if (args.length === 0) return ''
      var first = args[0]
      if (typeof first === 'string' && /%[sdifjoO%]/.test(first)) {
        var out = first
        var idx = 1
        out = out.replace(/%([sdifjoO%])/g, function (match, code) {
          if (code === '%') return '%'
          if (idx >= args.length) return match
          var value = args[idx++]
          if (code === 'd' || code === 'i') return String(Number(value))
          if (code === 'f') return String(Number(value))
          if (code === 'j') {
            try {
              return JSON.stringify(value)
            } catch (e) {
              return String(value)
            }
          }
          if (code === 'O' || code === 'o') {
            try {
              return require$$inspect(value)
            } catch (e) {
              return String(value)
            }
          }
          return formatValue(value)
        })
        var rest = args.slice(idx).map(formatValue)
        return rest.length ? out + ' ' + rest.join(' ') : out
      }
      return args.map(formatValue).join(' ')
    },
    inspect: function (value) {
      return require$$inspect(value)
    },
    promisify: function (fn) {
      if (fn && fn.__promisify__) return fn.__promisify__
      var promisified = function () {
        var args = Array.prototype.slice.call(arguments)
        var self = this
        return new Promise(function (resolve, reject) {
          args.push(function (err, result) {
            if (err) reject(err)
            else resolve(result)
          })
          try {
            fn.apply(self, args)
          } catch (e) {
            reject(e)
          }
        })
      }
      return promisified
    },
    callbackify: function (fn) {
      return function () {
        var args = Array.prototype.slice.call(arguments)
        var cb = args.pop()
        Promise.resolve()
          .then(function () {
            return fn.apply(null, args)
          })
          .then(
            function (result) {
              cb(null, result)
            },
            function (err) {
              cb(err)
            }
          )
      }
    },
    stripVTControlCharacters: function (str) {
      // eslint-disable-next-line no-control-regex
      return String(str).replace(/\x1B\[[0-9;]*[A-Za-z]|\x1B\][^\x07]*(\x07|\x1B\\)/g, '')
    },
    isDeepStrictEqual: function (a, b) {
      try {
        return JSON.stringify(a) === JSON.stringify(b)
      } catch (e) {
        return a === b
      }
    },
    inherits: function (ctor, superCtor) {
      ctor.super_ = superCtor
      Object.setPrototypeOf(ctor.prototype, superCtor.prototype)
    },
    deprecate: function (fn) {
      return fn
    },
    types: {
      isDate: function (v) {
        return v instanceof Date
      },
      isRegExp: function (v) {
        return v instanceof RegExp
      },
      isNativeError: function (v) {
        return v instanceof Error
      },
    },
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
  }

  function require$$inspect(value, depth) {
    depth = depth === undefined ? 2 : depth
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'string') return JSON.stringify(value)
    if (typeof value === 'function') return '[Function: ' + (value.name || 'anonymous') + ']'
    if (value instanceof Error) return value.stack || String(value)
    if (value instanceof Date) return value.toISOString()
    if (value instanceof RegExp) return String(value)
    if (Array.isArray(value)) {
      if (depth <= 0) return '[Array]'
      return '[' + value.map(function (v) {
        return require$$inspect(v, depth - 1)
      }).join(', ') + ']'
    }
    if (typeof value === 'object') {
      if (depth <= 0) return '[Object]'
      var keys = Object.keys(value)
      return '{ ' + keys.map(function (k) {
        return k + ': ' + require$$inspect(value[k], depth - 1)
      }).join(', ') + ' }'
    }
    return String(value)
  }

  /* ------------------------------------------------------------------ *
   * url                                                                *
   * ------------------------------------------------------------------ */

  function urlParse(address) {
    try {
      var u = new URL(address, 'http://localhost/')
      var auth = null
      if (u.username) {
        auth = decodeURIComponent(u.username) + (u.password ? ':' + decodeURIComponent(u.password) : '')
      }
      return {
        protocol: u.protocol,
        slashes: u.protocol !== '',
        auth: auth,
        host: u.host,
        port: u.port,
        hostname: u.hostname,
        hash: u.hash,
        search: u.search,
        query: u.search ? u.search.slice(1) : null,
        pathname: u.pathname,
        path: u.pathname + u.search,
        href: address,
      }
    } catch (e) {
      return { protocol: null, slashes: null, auth: null, host: null, port: null, hostname: null, hash: null, search: null, query: null, pathname: null, path: null, href: String(address) }
    }
  }

  var urlModule = {
    URL: window.URL,
    URLSearchParams: window.URLSearchParams,
    Url: function () {},
    parse: urlParse,
    format: function (obj) {
      if (!obj) return ''
      if (obj.href && !obj.protocol) return obj.href
      var out = (obj.protocol || '') + (obj.slashes ? '//' : '')
      if (obj.auth) out += obj.auth + '@'
      out += obj.hostname || obj.host || ''
      if (obj.port) out += ':' + obj.port
      out += obj.pathname || ''
      if (obj.search) out += obj.search
      else if (obj.query) out += '?' + (typeof obj.query === 'string' ? obj.query : new URLSearchParams(obj.query).toString())
      if (obj.hash) out += obj.hash
      return out
    },
    resolve: function (from, to) {
      try {
        return new URL(to, from).href
      } catch (e) {
        return to
      }
    },
    pathToFileURL: function (p) {
      var normalized = String(p).replace(/\\/g, '/')
      // Collapse repeated leading separators: win32-style joins around the
      // posix asset root ('/\\emoji.json') must never become
      // protocol-relative URLs ('//emoji.json/').
      normalized = normalized.replace(/^\/{2,}/, '/')
      if (!/^\//.test(normalized)) normalized = '/' + normalized
      if (normalized.charAt(0) === '/') {
        // Frontend assets are served from the Tauri asset origin rather than
        // the file system, so map root-relative paths onto that origin
        // (e.g. '/static/x.svg' -> 'http://tauri.localhost/static/x.svg').
        if (/^\/[a-zA-Z]:/.test(normalized)) {
          return new window.URL('file://' + normalized)
        }
        return new window.URL(normalized, location.origin)
      }
      // file:///C:/Users/...
      return new window.URL('file://' + normalized)
    },
    fileURLToPath: function (url) {
      var u = url instanceof window.URL ? url : new window.URL(String(url))
      var p = decodeURIComponent(u.pathname)
      if (u.protocol === 'file:') {
        if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1)
        if (isWindows) p = p.replace(/\//g, '\\')
      }
      return p
    },
    domainToASCII: function () {
      return ''
    },
    urlToHttpOptions: function (u) {
      return { protocol: u.protocol, hostname: u.hostname, hash: u.hash, search: u.search, pathname: u.pathname, path: u.pathname + u.search || '', href: u.href, port: u.port }
    },
  }

  /* ------------------------------------------------------------------ *
   * fs (async via Tauri fs plugin when available, clear errors otherwise) *
   * ------------------------------------------------------------------ */

  function fsUnavailable(name) {
    return function () {
      throw shimError('fs.' + name)
    }
  }

  function fsAsyncUnavailable(name) {
    return function () {
      return Promise.reject(shimError('fs.' + name))
    }
  }

  // Maps a path from the Node-style fs APIs onto the web asset origin.
  // Root-relative paths (e.g. '/emoji.json', '/static/…') resolve inside the
  // embedded frontend assets and are fetchable over the Tauri asset protocol;
  // absolute paths outside the web root cannot be read from a webview.
  function assetUrlFromPath(p) {
    p = String(p)
    if (p.indexOf('file://') === 0) {
      try {
        p = decodeURIComponent(new window.URL(p).pathname)
      } catch (e) {
        return null
      }
    }
    if (/^[a-zA-Z]:[\\/]/.test(p) || p.indexOf('\0') !== -1) return null
    // Normalize win32-flavoured separators (path.join uses '\\' even for
    // posix-rooted inputs) and collapse duplicate leading slashes so the
    // result stays a same-origin absolute path.
    p = p.replace(/\\/g, '/').replace(/^\/{2,}/, '/')
    if (p.charAt(0) !== '/') p = '/' + p
    return p
  }

  function fsReadFileAsync(p, options) {
    var url = assetUrlFromPath(p)
    if (url === null) {
      return Promise.reject(
        shimError('fs.readFile for ' + p + ' (outside the web asset root)')
      )
    }
    var encoding =
      typeof options === 'string'
        ? options
        : (options && options.encoding) || null
    return fetch(url)
      .then(function (res) {
        if (!res.ok) {
          var err = new Error(
            "ENOENT: no such file or directory, open '" + p + "'"
          )
          err.code = 'ENOENT'
          throw err
        }
        return res.arrayBuffer()
      })
      .then(function (ab) {
        if (
          encoding === null ||
          encoding === undefined ||
          encoding === 'buffer'
        ) {
          return ShimBuffer.from(ab)
        }
        return new TextDecoder(String(encoding)).decode(ab)
      })
  }

  function fsReadFileCallback(p, options, cb) {
    if (typeof options === 'function') {
      cb = options
      options = null
    }
    fsReadFileAsync(p, options).then(
      function (data) {
        cb(null, data)
      },
      function (err) {
        cb(err)
      }
    )
  }

  var fsPromises = {
    readFile: fsReadFileAsync,
    writeFile: fsAsyncUnavailable('writeFile'),
    stat: fsAsyncUnavailable('stat'),
    lstat: fsAsyncUnavailable('lstat'),
    readdir: fsAsyncUnavailable('readdir'),
    mkdir: fsAsyncUnavailable('mkdir'),
    rm: fsAsyncUnavailable('rm'),
    rmdir: fsAsyncUnavailable('rmdir'),
    unlink: fsAsyncUnavailable('unlink'),
    rename: fsAsyncUnavailable('rename'),
    copyFile: fsAsyncUnavailable('copyFile'),
    access: fsAsyncUnavailable('access'),
    realpath: fsAsyncUnavailable('realpath'),
  }

  var fsModule = {
    promises: fsPromises,
    // existsSync returning false lets the app take its "fresh start" code
    // paths (e.g. no stored config yet) instead of crashing at startup.
    existsSync: function () {
      return false
    },
    readFileSync: fsUnavailable('readFileSync'),
    writeFileSync: fsUnavailable('writeFileSync'),
    appendFileSync: fsUnavailable('appendFileSync'),
    statSync: fsUnavailable('statSync'),
    lstatSync: fsUnavailable('lstatSync'),
    readdirSync: fsUnavailable('readdirSync'),
    mkdirSync: fsUnavailable('mkdirSync'),
    unlinkSync: fsUnavailable('unlinkSync'),
    openSync: fsUnavailable('openSync'),
    readSync: fsUnavailable('readSync'),
    closeSync: fsUnavailable('closeSync'),
    createReadStream: fsUnavailable('createReadStream'),
    createWriteStream: fsUnavailable('createWriteStream'),
    watch: fsUnavailable('watch'),
    watchFile: fsUnavailable('watchFile'),
    readFile: fsReadFileCallback,
    writeFile: fsAsyncUnavailable('writeFile'),
    stat: fsAsyncUnavailable('stat'),
    readdir: fsAsyncUnavailable('readdir'),
    access: fsAsyncUnavailable('access'),
    constants: {},
  }

  /* ------------------------------------------------------------------ *
   * child_process (git and editor launches go through Rust)            *
   * ------------------------------------------------------------------ */

  function cpUnavailable(name) {
    return function () {
      throw shimError('child_process.' + name)
    }
  }

  function cpAsyncUnavailable(name) {
    return function () {
      return Promise.reject(shimError('child_process.' + name))
    }
  }

  function ChildProcessStub() {
    this.pid = 0
    this.stdout = null
    this.stderr = null
    this.stdin = null
    this.killed = false
    this.exitCode = null
  }
  ChildProcessStub.prototype.on = EventEmitter.prototype.on
  ChildProcessStub.prototype.once = EventEmitter.prototype.once
  ChildProcessStub.prototype.emit = EventEmitter.prototype.emit
  ChildProcessStub.prototype.removeListener = EventEmitter.prototype.removeListener
  ChildProcessStub.prototype.kill = function () {
    return true
  }
  ChildProcessStub.prototype.ref = function () {
    return this
  }
  ChildProcessStub.prototype.unref = function () {
    return this
  }

  var childProcessModule = {
    spawn: function () {
      throw shimError('child_process.spawn')
    },
    exec: cpUnavailable('exec'),
    execFile: function () {
      throw shimError('child_process.execFile')
    },
    fork: cpUnavailable('fork'),
    execFileSync: cpUnavailable('execFileSync'),
    spawnSync: cpUnavailable('spawnSync'),
    execSync: cpUnavailable('execSync'),
    ChildProcess: ChildProcessStub,
    // Async callers get a rejected promise instead of a synchronous throw.
    __execFileAsync: cpAsyncUnavailable('execFile'),
  }

  /* ------------------------------------------------------------------ *
   * stream                                                             *
   * ------------------------------------------------------------------ */

  function ReadableStub(options) {
    EventEmitter.call(this)
    this.readable = true
    this.destroyed = false
    this._readableState = { objectMode: false, ended: false }
    if (options) this.options = options
  }
  Object.setPrototypeOf(ReadableStub.prototype, EventEmitter.prototype)
  ReadableStub.prototype.pipe = function () {
    throw shimError('stream.pipe')
  }
  ReadableStub.prototype.read = function () {
    return null
  }
  ReadableStub.prototype.resume = function () {
    return this
  }
  ReadableStub.prototype.pause = function () {
    return this
  }
  ReadableStub.prototype.destroy = function () {
    this.destroyed = true
    return this
  }

  function WritableStub(options) {
    EventEmitter.call(this)
    this.writable = true
    this.destroyed = false
    this._writableState = { objectMode: false, ended: false }
    if (options) this.options = options
  }
  Object.setPrototypeOf(WritableStub.prototype, EventEmitter.prototype)
  WritableStub.prototype.write = function () {
    throw shimError('stream.write')
  }
  WritableStub.prototype.end = function () {
    return this
  }
  WritableStub.prototype.destroy = function () {
    this.destroyed = true
    return this
  }

  function TransformStub(options) {
    WritableStub.call(this, options)
    this.readable = true
  }
  Object.setPrototypeOf(TransformStub.prototype, WritableStub.prototype)

  function DuplexStub(options) {
    ReadableStub.call(this, options)
    this.writable = true
  }
  Object.setPrototypeOf(DuplexStub.prototype, ReadableStub.prototype)

  var streamModule = {
    Readable: ReadableStub,
    Writable: WritableStub,
    Transform: TransformStub,
    Duplex: DuplexStub,
    PassThrough: TransformStub,
    Stream: ReadableStub,
    pipeline: function () {
      throw shimError('stream.pipeline')
    },
    finished: function (stream, cb) {
      if (typeof cb === 'function') stream.on('end', function () { cb(null) })
      return function () {}
    },
    addListener: function () {},
  }

  var asyncHooksModule = {
    AsyncLocalStorage: function AsyncLocalStorage() {
      this._store = undefined
    },
    AsyncResource: function AsyncResource(type) {
      this.type = type
    },
    createHook: function () {
      return { enable: function () { return this }, disable: function () { return this } }
    },
    executionAsyncId: function () {
      return 0
    },
    executionAsyncResource: function () {
      return {}
    },
    triggerAsyncId: function () {
      return 0
    },
    asyncId: function () {
      return 0
    },
  }

  asyncHooksModule.AsyncLocalStorage.prototype.getStore = function () {
    return this._store
  }
  asyncHooksModule.AsyncLocalStorage.prototype.run = function (store, callback) {
    var args = Array.prototype.slice.call(arguments, 2)
    var prev = this._store
    this._store = store
    var self = this
    function restore() {
      self._store = prev
    }
    try {
      var result = callback.apply(null, args)
      if (result && typeof result.then === 'function') {
        return result.then(
          function (value) {
            restore()
            return value
          },
          function (err) {
            restore()
            throw err
          }
        )
      }
      restore()
      return result
    } catch (e) {
      restore()
      throw e
    }
  }
  asyncHooksModule.AsyncLocalStorage.prototype.enterWith = function (store) {
    this._store = store
  }
  asyncHooksModule.AsyncLocalStorage.prototype.exit = function (callback) {
    var prev = this._store
    this._store = undefined
    try {
      return callback()
    } finally {
      this._store = prev
    }
  }
  asyncHooksModule.AsyncLocalStorage.prototype.disable = function () {
    this._store = undefined
    return this
  }

  asyncHooksModule.AsyncResource.prototype.runInAsyncScope = function (fn) {
    var args = Array.prototype.slice.call(arguments, 1)
    return fn.apply(null, args)
  }
  asyncHooksModule.AsyncResource.prototype.bind = function (fn) {
    var self = this
    return function () {
      return self.runInAsyncScope.apply(
        self,
        [fn].concat(Array.prototype.slice.call(arguments))
      )
    }
  }
  asyncHooksModule.AsyncResource.prototype.emitDestroy = function () {}
  asyncHooksModule.AsyncResource.prototype.asyncId = function () {
    return 0
  }
  asyncHooksModule.AsyncResource.prototype.triggerAsyncId = function () {
    return 0
  }

  var streamWebModule = {
    ReadableStream: window.ReadableStream,
    WritableStream: window.WritableStream,
    TransformStream: window.TransformStream,
    ByteLengthQueuingStrategy: window.ByteLengthQueuingStrategy,
    CountQueuingStrategy: window.CountQueuingStrategy,
    TextEncoderStream: window.TextEncoderStream,
    TextDecoderStream: window.TextDecoderStream,
  }

  var streamConsumersModule = {
    text: function (stream) {
      return new Response(stream).text()
    },
    json: function (stream) {
      return new Response(stream).json()
    },
    arrayBuffer: function (stream) {
      return new Response(stream).arrayBuffer()
    },
    buffer: function (stream) {
      return new Response(stream).arrayBuffer().then(function (ab) {
        return ShimBuffer.from(ab)
      })
    },
    blob: function (stream) {
      return new Response(stream).blob()
    },
  }

  /* ------------------------------------------------------------------ *
   * net / tls / http / misc builtins                                   *
   * ------------------------------------------------------------------ */

  function NetServerStub(connectionListener) {
    EventEmitter.call(this)
    this._listening = false
    if (typeof connectionListener === 'function') {
      this.on('connection', connectionListener)
    }
  }
  Object.setPrototypeOf(NetServerStub.prototype, EventEmitter.prototype)
  NetServerStub.prototype.listen = function (port, host, callback) {
    var self = this
    if (typeof host === 'function') {
      callback = host
      host = undefined
    }
    if (typeof port === 'function') {
      callback = port
      port = undefined
    }
    if (typeof callback === 'function') this.on('listening', callback)
    // Browsers cannot listen on TCP sockets. Report the failure asynchronously
    // so callers (the lazily started trampoline server) surface a normal
    // error instead of hanging on the `listening` callback.
    setTimeout(function () {
      var err = new Error(
        '[tauri-shim] net.Server.listen is not available in the Tauri build ' +
          '(the git trampoline server is disabled)'
      )
      err.code = 'EADDRNOTAVAIL'
      err.syscall = 'listen'
      self.emit('error', err)
    }, 0)
    return this
  }
  NetServerStub.prototype.close = function (callback) {
    this._listening = false
    if (typeof callback === 'function') setTimeout(callback, 0)
    return this
  }
  NetServerStub.prototype.unref = function () {
    return this
  }
  NetServerStub.prototype.ref = function () {
    return this
  }
  NetServerStub.prototype.address = function () {
    return null
  }
  NetServerStub.prototype.getConnections = function (callback) {
    if (typeof callback === 'function') callback(null, 0)
    return this
  }

  function makeTimeoutId(id) {
    return {
      __timeoutId: id,
      unref: function () {
        return this
      },
      ref: function () {
        return this
      },
      refresh: function () {
        return this
      },
      toJSON: function () {
        return this.__timeoutId
      },
      valueOf: function () {
        return this.__timeoutId
      },
    }
  }

  var netModule = {
    isIP: function (input) {
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(input)) return 4
      if (input.includes(':')) return 6
      return 0
    },
    isIPv4: function (input) {
      return netModule.isIP(input) === 4
    },
    isIPv6: function (input) {
      return netModule.isIP(input) === 6
    },
    createServer: function (connectionListener) {
      return new NetServerStub(connectionListener)
    },
    connect: function () {
      throw shimError('net.connect')
    },
    createConnection: function () {
      throw shimError('net.createConnection')
    },
    Socket: function () {
      throw new shimError('net.Socket')
    },
    SocketPair: undefined,
    Server: NetServerStub,
  }

  var httpModule = {
    request: function () {
      throw shimError('http.request')
    },
    get: function () {
      throw shimError('http.get')
    },
    createServer: function () {
      throw shimError('http.createServer')
    },
    IncomingMessage: function () {},
    ServerResponse: function () {},
    STATUS_CODES: { 200: 'OK', 404: 'Not Found', 500: 'Internal Server Error' },
  }
  var httpsModule = Object.assign({}, httpModule, {
    request: function () {
      throw shimError('https.request')
    },
    get: function () {
      throw shimError('https.get')
    },
  })

  var tlsModule = {
    connect: function () {
      throw shimError('tls.connect')
    },
    createServer: function () {
      throw shimError('tls.createServer')
    },
  }

  var zlibModule = {
    gzip: function () {
      throw shimError('zlib.gzip')
    },
    gunzip: function () {
      throw shimError('zlib.gunzip')
    },
    deflate: function () {
      throw shimError('zlib.deflate')
    },
    inflate: function () {
      throw shimError('zlib.inflate')
    },
    createGunzip: function () {
      throw shimError('zlib.createGunzip')
    },
    createGzip: function () {
      throw shimError('zlib.createGzip')
    },
  }

  var stringDecoderModule = {
    StringDecoder: function (encoding) {
      this.encoding = encoding || 'utf8'
      this.write = function (buf) {
        try {
          return bufferToString.call(asBytes(buf), this.encoding)
        } catch (e) {
          return ''
        }
      }
      this.end = function () {
        return ''
      }
    },
  }

  var moduleModule = {
    createRequire: function () {
      return req
    },
    builtinModules: [],
    exports: {},
    builtinMids: [],
    _cache: {},
    Module: function Module() {},
  }

  var ttyModule = {
    isatty: function () {
      return false
    },
    WriteStream: function () {},
  }

  var eventsModule = {
  EventEmitter: EventEmitter,
    once: function (emitter, name) {
      return new Promise(function (resolve, reject) {
        function onEvent() {
          emitter.removeListener(name, onEvent)
          emitter.removeListener('error', onError)
          resolve(Array.prototype.slice.call(arguments))
        }
        function onError(err) {
          emitter.removeListener(name, onEvent)
          reject(err)
        }
        emitter.on(name, onEvent)
        if (name !== 'error') emitter.on('error', onError)
      })
    },
    captureRejectionSymbol: Symbol('captureRejections'),
    EventEmitterAsyncResource: EventEmitter,
  }

  var assertModule = function (value, message) {
    if (!value) throw new Error('Assertion failed' + (message ? ': ' + message : ''))
  }
  assertModule.ok = assertModule
  assertModule.strictEqual = function (a, b, m) {
    if (a !== b) throw new Error('Expected ' + String(a) + ' to be strictly equal to ' + String(b) + (m ? ': ' + m : ''))
  }
  assertModule.deepStrictEqual = function (a, b, m) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error('Expected ' + require$$inspect(a) + ' to be deeply equal to ' + require$$inspect(b) + (m ? ': ' + m : ''))
    }
  }
  assertModule.equal = assertModule.strictEqual
  assertModule.notStrictEqual = function (a, b) {
    if (a === b) throw new Error('Expected values not to be strictly equal')
  }
  assertModule.fail = function (m) {
    throw new Error(m || 'Failed')
  }
  assertModule.throws = function (fn) {
    try {
      fn()
    } catch (e) {
      return
    }
    throw new Error('Missing expected exception')
  }

  /* ------------------------------------------------------------------ *
   * electron                                                           *
   * ------------------------------------------------------------------ */

  var eventSubscriptions = new Map() // channel -> Map(listenerId -> unlisten)

  function subscribeToChannel(channel, listener, once) {
    if (!tauri) {
      logWarn('cannot subscribe to', channel, '- window.__TAURI__ missing')
      return function () {}
    }
    var wrapped = function (event) {
      if (once) {
        var entry = eventSubscriptions.get(channel)
        if (entry) {
          entry.forEach(function (rec) {
            if (rec.wrapped === wrapped && rec.unlisten) rec.unlisten()
          })
        }
      }
      var fakeEvent = {
        sender: null,
        senderFrame: null,
        processId: 0,
        frameId: 0,
        channels: [channel],
        timeStamp: Date.now(),
        preventDefault: function () {},
        reply: function () {},
      }
      var payload = event.payload
      try {
        if (Array.isArray(payload)) {
          listener.apply(null, [fakeEvent].concat(payload))
        } else if (payload === undefined || payload === null) {
          listener(fakeEvent)
        } else {
          listener(fakeEvent, payload)
        }
      } catch (e) {
        logWarn('ipc listener for', channel, 'threw', e)
        console.error(e)
      }
    }

    var record = { wrapped: wrapped, unlisten: null }
    tauri.event
      .listen(channel, wrapped)
      .then(function (unlisten) {
        record.unlisten = unlisten
      })
      .catch(function (e) {
        logWarn('failed to subscribe to', channel, e)
      })

    if (!eventSubscriptions.has(channel)) eventSubscriptions.set(channel, new Map())
    var channelMap = eventSubscriptions.get(channel)
    channelMap.set(listener, record)
    return function () {
      if (record.unlisten) record.unlisten()
      channelMap.delete(listener)
    }
  }

  var ipcRenderer = {
    invoke: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1)
      return desktopInvoke(channel, args).then(function (result) {
        // JSON has no `undefined`: the Rust handler for a channel whose
        // Electron counterpart returns undefined (e.g. 'check-for-updates'
        // meaning "no error") answers null, but callers distinguish
        // `undefined` from null (`if (error !== undefined)`).
        if (channel === 'check-for-updates' && result === null) {
          return undefined
        }
        return result
      })
    },
    send: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1)
      desktopSend(channel, args).catch(function (e) {
        logWarn('ipc send failed for', channel, e)
        console.error(e)
      })
    },
    sendSync: function (channel) {
      // No synchronous IPC in a webview: fire asynchronously and return
      // undefined. Used only for quit-race channels in GitHub Desktop.
      var args = Array.prototype.slice.call(arguments, 1)
      desktopSend(channel, args).catch(function () {})
      return undefined
    },
    sendToHost: function () {},
    postMessage: function () {},
    on: function (channel, listener) {
      subscribeToChannel(channel, listener, false)
      return ipcRenderer
    },
    addListener: function (channel, listener) {
      return ipcRenderer.on(channel, listener)
    },
    once: function (channel, listener) {
      subscribeToChannel(channel, listener, true)
      return ipcRenderer
    },
    removeListener: function (channel, listener) {
      var entry = eventSubscriptions.get(channel)
      if (entry) {
        var rec = entry.get(listener)
        if (rec) {
          if (rec.unlisten) rec.unlisten()
          entry.delete(listener)
        }
      }
      return ipcRenderer
    },
    removeEventListener: function (channel, listener) {
      return ipcRenderer.removeListener(channel, listener)
    },
    removeAllListeners: function (channel) {
      var entry = eventSubscriptions.get(channel)
      if (entry) {
        entry.forEach(function (rec) {
          if (rec.unlisten) rec.unlisten()
        })
        entry.clear()
      }
      return ipcRenderer
    },
    listeners: function (channel) {
      var entry = eventSubscriptions.get(channel)
      return entry ? Array.from(entry.keys()) : []
    },
    listenerCount: function (channel) {
      var entry = eventSubscriptions.get(channel)
      return entry ? entry.size : 0
    },
    isDestroyed: function () {
      return false
    },
    getMaxListeners: function () {
      return 10
    },
    setMaxListeners: function () {},
    eventNames: function () {
      return Array.from(eventSubscriptions.keys())
    },
    getURL: function () {
      return location.href
    },
  }

  var electronModule = {
    ipcRenderer: ipcRenderer,
    webUtils: {
      getPathForFile: function () {
        // Drag & drop file paths are not available inside a webview.
        return ''
      },
      getFileForPath: function () {
        throw shimError('webUtils.getFileForPath')
      },
    },
    shell: {
      beep: function () {
        try {
          desktopSend('beep').catch(function () {})
        } catch (e) {
          /* ignore */
        }
      },
      openPath: function (path) {
        return desktopInvoke('open-external', [path]).then(function () {
          return ''
        }).catch(function (e) {
          return String(e)
        })
      },
      openExternal: function (url) {
        return desktopInvoke('open-external', [url]).then(function () {
          return true
        })
      },
      showItemInFolder: function (path) {
        return desktopInvoke('show-item-in-folder', [path])
      },
      showFolderContents: function (path) {
        return desktopSend('unsafe-open-directory', [path])
      },
      moveItemToTrash: function (path) {
        return desktopInvoke('move-to-trash', [path])
      },
      trashItem: function (path) {
        return desktopInvoke('move-to-trash', [path]).then(function () {
          return { status: 'success' }
        })
      },
    },
    app: {
      getPath: function (name) {
        return pathCache[name] || ''
      },
      getName: function () {
        return 'GitHub Desktop'
      },
      getVersion: function () {
        return '3.6.7'
      },
      getLocale: function () {
        return navigator.language || 'en-US'
      },
      getPreferredSystemLanguages: function () {
        return [navigator.language || 'en-US']
      },
      isPackaged: true,
      isReady: function () {
        return true
      },
      whenReady: function () {
        return Promise.resolve()
      },
      runningUnderARM64Translation: false,
      setLoginItemSettings: function () {},
      getLoginItemSettings: function () {
        return {}
      },
      on: function () {},
      once: function () {},
      off: function () {},
      removeAllListeners: function () {},
      quit: function () {
        desktopSend('quit-app').catch(function () {})
      },
      exit: function () {
        desktopSend('quit-app').catch(function () {})
      },
    },
    webFrame: {
      setZoomFactor: function (factor) {
        desktopSend('set-window-zoom-factor', [factor]).catch(function () {})
      },
      getZoomFactor: function (callback) {
        var p = desktopInvoke('get-current-window-zoom-factor', [])
        if (typeof callback === 'function') {
          p.then(callback).catch(function () {
            callback(1)
          })
          return undefined
        }
        return p.catch(function () {
          return 1
        })
      },
      setZoomLevel: function () {},
      getZoomLevel: function () {
        return 0
      },
      setVisualZoomLevelLimits: function () {},
      layoutZoomLevelLimits: function () {},
      setSpellCheckerEnabled: function () {},
      setAudioMuted: function () {},
      isAudioMuted: function () {
        return false
      },
      insertCSS: function () {
        return Promise.resolve('')
      },
      executeJavaScript: function (code) {
        // eslint-disable-next-line no-eval
        return Promise.resolve(eval(code))
      },
    },
    clipboard: {
      readText: function () {
        return navigator.clipboard.readText().catch(function () {
          return ''
        })
      },
      writeText: function (text) {
        return navigator.clipboard.writeText(text).catch(function () {})
      },
      readHTML: function () {
        return Promise.resolve('')
      },
      writeHTML: function () {
        return Promise.resolve()
      },
    },
    nativeImage: {
      createFromPath: function () {
        return { toDataURL: function () { return '' }, isEmpty: function () { return true } }
      },
      createFromBuffer: function () {
        return { toDataURL: function () { return '' }, isEmpty: function () { return true } }
      },
      createEmpty: function () {
        return { toDataURL: function () { return '' }, isEmpty: function () { return true } }
      },
    },
    screen: {
      getPrimaryDisplay: function () {
        return {
          id: 0,
          bounds: { x: 0, y: 0, width: screen.width, height: screen.height },
          workArea: { x: 0, y: 0, width: screen.availWidth, height: screen.availHeight },
          scaleFactor: window.devicePixelRatio || 1,
        }
      },
      getAllDisplays: function () {
        return [electronModule.screen.getPrimaryDisplay()]
      },
      getCursorScreenPoint: function () {
        return { x: 0, y: 0 }
      },
      getDisplayNearestPoint: function () {
        return electronModule.screen.getPrimaryDisplay()
      },
      getDisplayMatching: function () {
        return electronModule.screen.getPrimaryDisplay()
      },
    },
    contextBridge: {
      exposeInMainWorld: function (key, value) {
        window[key] = value
      },
    },
    webviewTag: {},
    domParser: function () {},
    internetDisconnected: function () {},
    // Type-only placeholders used by some code paths at runtime.
    BrowserWindow: function () {
      throw shimError('BrowserWindow')
    },
    Menu: {
      buildFromTemplate: function () {
        throw shimError('Menu.buildFromTemplate')
      },
    },
    dialog: {
      showOpenDialog: function () {
        return Promise.resolve({ canceled: true, filePaths: [] })
      },
      showSaveDialog: function () {
        return Promise.resolve({ canceled: true, filePath: undefined })
      },
      showMessageBox: function () {
        return Promise.resolve({ response: 0 })
      },
    },
    Notification: function () {
      throw shimError('Notification')
    },
  }

  /* ------------------------------------------------------------------ *
   * require implementation                                             *
   * ------------------------------------------------------------------ */

  var timersModule = {
    setTimeout: function (fn, ms) {
      var args = Array.prototype.slice.call(arguments, 2)
      return makeTimeoutId(
        setTimeout(function () {
          fn.apply(null, args)
        }, ms)
      )
    },
    clearTimeout: function (handle) {
      clearTimeout(
        handle && handle.__timeoutId !== undefined ? handle.__timeoutId : handle
      )
    },
    setInterval: function (fn, ms) {
      var args = Array.prototype.slice.call(arguments, 2)
      return makeTimeoutId(
        setInterval(function () {
          fn.apply(null, args)
        }, ms)
      )
    },
    clearInterval: function (handle) {
      clearInterval(
        handle && handle.__timeoutId !== undefined ? handle.__timeoutId : handle
      )
    },
    setImmediate: function (fn) {
      var args = Array.prototype.slice.call(arguments, 1)
      return makeTimeoutId(
        setTimeout(function () {
          fn.apply(null, args)
        }, 0)
      )
    },
    clearImmediate: function (handle) {
      clearTimeout(
        handle && handle.__timeoutId !== undefined ? handle.__timeoutId : handle
      )
    },
  }

  var timersPromisesModule = {
    setTimeout: function (ms, value) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(value)
        }, ms)
      })
    },
    setImmediate: function (value) {
      return Promise.resolve(value)
    },
    setInterval: function () {
      throw shimError('timers/promises.setInterval')
    },
    clearInterval: function () {},
    clearTimeout: function () {},
  }

  var builtins = {
    electron: electronModule,
    timers: timersModule,
    'timers/promises': timersPromisesModule,
    'node:timers': timersModule,
    'node:timers/promises': timersPromisesModule,
    path: pathModule,
    fs: fsModule,
    'fs/promises': fsPromises,
    os: osModule,
    crypto: cryptoModule,
    util: utilModule,
    events: eventsModule,
    url: urlModule,
    child_process: childProcessModule,
    stream: streamModule,
    'stream/promises': {
      pipeline: function () {
        throw shimError('stream/promises.pipeline')
      },
      finished: function (stream) {
        return new Promise(function (resolve) {
          stream.on('close', resolve)
          stream.on('end', resolve)
          stream.on('error', resolve)
        })
      },
    },
    'node:stream/promises': null,
    buffer: { Buffer: ShimBuffer, kStringMaxLength: 0x7fffffff, constants: { MAX_STRING_LENGTH: 0x7fffffff, MAX_LENGTH: 0x7fffffff } },
    net: netModule,
    http: httpModule,
    https: httpsModule,
    tls: tlsModule,
    zlib: zlibModule,
    string_decoder: stringDecoderModule,
    module: moduleModule,
    tty: ttyModule,
    assert: assertModule,
    querystring: {
      parse: function (str) {
        var out = {}
        String(str).split('&').forEach(function (pair) {
          if (!pair) return
          var idx = pair.indexOf('=')
          var k = idx === -1 ? pair : pair.slice(0, idx)
          var v = idx === -1 ? '' : pair.slice(idx + 1)
          out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '))
        })
        return out
      },
      stringify: function (obj) {
        return Object.keys(obj || {})
          .map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])
          })
          .join('&')
      },
      escape: encodeURIComponent,
      unescape: decodeURIComponent,
    },
    perf_hooks: { performance: performance, now: function () { return performance.now() } },
    worker_threads: { Worker: function () { throw shimError('worker_threads.Worker') }, isMainThread: true },
    v8: { serialize: function () { return new Uint8Array() }, deserialize: function () { return {} } },
    constants: {},
    repl: {},
    inspector: {},
    trace_events: {},
    diagnostics_channel: { channel: function () { return { publish: function () {}, subscribe: function () {} } } },
    async_hooks: asyncHooksModule,
    'node:async_hooks': asyncHooksModule,
    'stream/web': streamWebModule,
    'node:stream/web': streamWebModule,
    'stream/consumers': streamConsumersModule,
    'node:stream/consumers': streamConsumersModule,
    'assert/strict': assertModule,
    'node:assert/strict': assertModule,
    vm: { runInNewContext: function () { throw shimError('vm.runInNewContext') }, Script: function () { throw shimError('vm.Script') } },
    'node:buffer': null,
  }
  builtins['node:buffer'] = builtins.buffer
  builtins['node:path'] = builtins.path
  builtins['node:events'] = builtins.events
  builtins['node:util'] = builtins.util
  builtins['node:fs'] = builtins.fs
  builtins['node:fs/promises'] = builtins['fs/promises']
  builtins['node:crypto'] = builtins.crypto
  builtins['node:os'] = builtins.os
  builtins['node:url'] = builtins.url
  builtins['node:stream'] = builtins.stream
  builtins['node:stream/promises'] = builtins['stream/promises']
  builtins['node:child_process'] = builtins.child_process
  builtins['node:process'] = proc
  builtins['node:net'] = builtins.net
  builtins['node:assert'] = builtins.assert
  builtins['node:util/types'] = utilModule.types

  var warnedModules = Object.create(null)

  function req(name) {
    if (name in builtins && builtins[name]) {
      return builtins[name]
    }

    // Generic `node:` prefix handling so every builtin has both spellings.
    if (typeof name === 'string' && name.lastIndexOf('node:', 0) === 0) {
      var bare = name.slice(5)
      if (bare in builtins && builtins[bare]) {
        return builtins[bare]
      }
    }

    // Native addons cannot run inside a webview.
    if (/\.node$/i.test(name)) {
      throw shimError('native module ' + name)
    }

    // Anything else (npm packages leaking through, node internals we did not
    // model, native addons): warn once and hand back a stub that throws when
    // actually used, so module evaluation can continue.
    if (!warnedModules[name]) {
      warnedModules[name] = true
      logWarn('require(' + JSON.stringify(name) + ') is not available; returning a throwing stub')
    }
    return new Proxy(
      {},
      {
        get: function (target, prop) {
          if (prop === '__esModule') return false
          if (prop === 'default') return target
          if (prop === Symbol.toPrimitive || prop === 'toString') {
            return function () {
              return '[tauri-shim stub for ' + name + ']'
            }
          }
          if (prop in target) return target[prop]
          return function stubbedRequire() {
            throw shimError(name + '.' + String(prop))
          }
        },
        apply: function () {
          throw shimError('require(' + name + ')')
        },
      }
    )
  }

  req.resolve = function (name) {
    return name
  }
  req.cache = Object.create(null)
  req.extensions = { '.js': function () {}, '.json': function () {}, '.node': function () {} }
  req.main = { exports: {}, filename: '', loaded: true }

  /* ------------------------------------------------------------------ *
   * Global exports                                                     *
   * ------------------------------------------------------------------ */

  window.global = window
  window.require = req
  window.module = { exports: {} }
  window.exports = window.module.exports
  window.process = proc
  window.Buffer = ShimBuffer
  window.EventEmitter = EventEmitter
  window.__dirname = '/'
  window.__filename = '/index.html'
  window.setImmediate = function (fn) {
    var args = Array.prototype.slice.call(arguments, 1)
    return setTimeout(function () {
      fn.apply(null, args)
    }, 0)
  }
  window.clearImmediate = function (id) {
    clearTimeout(id)
  }
  if (typeof window.queueMicrotask !== 'function') {
    window.queueMicrotask = function (fn) {
      Promise.resolve().then(fn)
    }
  }
  // Some code paths (and the file URL helpers) consult these.
  window.__TAURI_SHIM__ = {
    pathModule: pathModule,
    platform: platform,
  }

  // Surface unhandled shim problems loudly during bring-up.
  window.addEventListener('unhandledrejection', function (ev) {
    logWarn('unhandled rejection:', ev.reason)
  })

  logWarn(
    'loaded – platform:',
    platform,
    '| tauri:',
    !!tauri,
    '| ua:',
    navigator.userAgent.slice(0, 80)
  )
})()
