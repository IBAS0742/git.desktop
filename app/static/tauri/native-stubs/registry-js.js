// Tauri build stub: `registry-js` is a Node native addon (Windows Registry
// access) which cannot run inside a webview. Enumeration returns no entries,
// so external editor discovery via the registry simply finds nothing.
'use strict'

exports.HKEY = {
  HKEY_CLASSES_ROOT: 'HKEY_CLASSES_ROOT',
  HKEY_CURRENT_USER: 'HKEY_CURRENT_USER',
  HKEY_LOCAL_MACHINE: 'HKEY_LOCAL_MACHINE',
  HKEY_USERS: 'HKEY_USERS',
  HKEY_CURRENT_CONFIG: 'HKEY_CURRENT_CONFIG',
}

exports.RegistryValueType = {
  REG_NONE: 'REG_NONE',
  REG_SZ: 'REG_SZ',
  REG_EXPAND_SZ: 'REG_EXPAND_SZ',
  REG_BINARY: 'REG_BINARY',
  REG_DWORD: 'REG_DWORD',
  REG_QWORD: 'REG_QWORD',
  REG_MULTI_SZ: 'REG_MULTI_SZ',
  REG_LINK: 'REG_LINK',
}

exports.enumerateKeys = function (hkey, subKey) {
  return []
}

exports.enumerateValues = function (hkey, subKey) {
  return []
}

exports.getValue = function (hkey, subKey, name) {
  return undefined
}

exports.setValue = function () {
  throw new Error(
    '[tauri-shim] registry-js is not available in the Tauri build'
  )
}
