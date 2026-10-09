import * as path from 'path'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import webpack from 'webpack'
import merge from 'webpack-merge'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import * as common from './webpack.common'

// Production renderer bundle for the Tauri shell (see src-tauri/).
//
// Differences from the Electron renderer build:
//  1. The HTML template injects the Node/Electron compatibility shim
//     (static/tauri/tauri-shim.js) so the bundle can run inside a WebView2
//     window without Node integration.
//  2. The native `desktop-notifications` addon is replaced with a JS stub
//     because webviews cannot load Node native addons.
//  3. Only the renderer entry is compiled – the main process lives in Rust.

const config: webpack.Configuration = {
  mode: 'production',
  devtool: 'source-map',
}

const rendererConfig = merge({}, common.renderer, config, {
  entry: {
    'tauri-shim': path.resolve(__dirname, 'static', 'tauri', 'tauri-shim.js'),
  },
  module: {
    rules: [
      {
        test: /\.(scss|css)$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'sass-loader'],
      },
    ],
  },
  plugins: [new MiniCssExtractPlugin({ filename: 'renderer.css' })],
  resolve: {
    alias: {
      // Native Node addons cannot load inside a webview; swap them for JS
      // stubs (see app/static/tauri/native-stubs/ for the behaviour each
      // stub degrades to).
      'desktop-notifications$': path.resolve(
        __dirname,
        'static',
        'tauri',
        'desktop-notifications-stub.js'
      ),
      'fs-admin$': path.resolve(
        __dirname,
        'static',
        'tauri',
        'native-stubs',
        'fs-admin.js'
      ),
      'keytar$': path.resolve(
        __dirname,
        'static',
        'tauri',
        'native-stubs',
        'keytar.js'
      ),
      'registry-js$': path.resolve(
        __dirname,
        'static',
        'tauri',
        'native-stubs',
        'registry-js.js'
      ),
      'windows-argv-parser$': path.resolve(
        __dirname,
        'static',
        'tauri',
        'native-stubs',
        'windows-argv-parser.js'
      ),
    },
  },
})

// Swap in the Tauri HTML template (HtmlWebpackPlugin from common.renderer
// would otherwise use the Electron template without the shim).
if (rendererConfig.plugins) {
  rendererConfig.plugins = rendererConfig.plugins.filter(
    p => !(p instanceof HtmlWebpackPlugin)
  )
}

rendererConfig.plugins!.push(
  new HtmlWebpackPlugin({
    template: path.join(__dirname, 'static', 'index.tauri.html'),
    // The shim is loaded by a blocking <script> tag in the template (see
    // app/static/index.tauri.html) so that it runs before the deferred
    // renderer bundle; injecting it here would order the tags wrongly.
    chunks: ['renderer'],
  })
)

export default [rendererConfig]
