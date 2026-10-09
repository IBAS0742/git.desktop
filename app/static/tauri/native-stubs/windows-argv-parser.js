// Tauri build stub: `windows-argv-parser` is a Node native addon which
// cannot run inside a webview. Parsing a custom integration command line is
// only used right before spawning the external process (also unavailable in
// the webview), so this fails with a descriptive error instead of crashing
// the bundle at load time.
'use strict'

exports.parseCommandLineArgv = function (commandLine) {
  throw new Error(
    '[tauri-shim] windows-argv-parser is not available in the Tauri build ' +
      '(custom integrations that spawn external processes are unsupported)'
  )
}
