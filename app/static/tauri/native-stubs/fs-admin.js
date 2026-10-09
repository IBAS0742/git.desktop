// Tauri build stub: `fs-admin` is a Node native addon (elevated file
// operations) which cannot run inside a webview. CLI installation therefore
// fails gracefully with an error instead of crashing the app.
'use strict'

function unsupported(callback) {
  var error = new Error(
    '[tauri-shim] fs-admin is not available in the Tauri build (CLI installation is unsupported)'
  )
  if (typeof callback === 'function') {
    callback(error)
    return
  }
  throw error
}

exports.unlink = function (path, callback) {
  unsupported(callback)
}

exports.makeTree = function (path, callback) {
  unsupported(callback)
}

exports.symlink = function (source, destination, callback) {
  unsupported(callback)
}

exports.exists = function (path, callback) {
  unsupported(callback)
}
