// Tauri build stub: `keytar` (OS keychain access) is a Node native addon
// which cannot run inside a webview. The app starts signed out; tokens are
// neither read nor written. On Tauri this should eventually be replaced by
// the safe-storage / keychain plugin on the Rust side.
'use strict'

exports.getPassword = function (service, account) {
  return Promise.resolve(null)
}

exports.setPassword = function (service, account, password) {
  return Promise.resolve()
}

exports.deletePassword = function (service, account) {
  return Promise.resolve(true)
}

exports.findCredentials = function (service) {
  return Promise.resolve([])
}

exports.findPassword = function (service) {
  return Promise.resolve(null)
}
