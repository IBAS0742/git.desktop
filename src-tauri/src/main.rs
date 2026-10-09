#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod channels;
mod menu;
mod state;

use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::state::DesktopState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state::DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            bridge::desktop_invoke,
            bridge::desktop_send,
            bridge::oauth_token_exchange,
            bridge::smoke_create_temp_file
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            menu::build_app_menu(&handle)?;
            register_menu_event_handler(&handle);

            if let Some(window) = app.get_webview_window("main") {
                register_window_event_forwarding(window);
            }

            // The sign-in window is created here (before the event loop
            // serves IPC) rather than on demand: building a window from a
            // sync command deadlocks the main thread. It starts hidden and
            // is navigated on each GitHub sign-in attempt.
            channels::build_auth_window(&handle)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}

/// Routes native menu clicks to the renderer's `menu-event` channel, mirroring
/// the Electron default menu behavior. Ids prefixed with `ctx:` come from a
/// context menu built by `show-contextual-menu` and are handed back to the
/// waiting invoke instead.
fn register_menu_event_handler(handle: &tauri::AppHandle) {
    handle.on_menu_event(|app, event| {
        let id = event.id.0.clone();

        if let Some(rest) = id.strip_prefix("ctx:") {
            let indices: Vec<usize> = rest
                .split(':')
                .filter_map(|part| part.parse::<usize>().ok())
                .collect();
            let state = app.state::<DesktopState>();
            if let Some(sender) = state.context_menu_tx.lock().unwrap().take() {
                let _ = sender.send(indices);
            }
            return;
        }

        match id.as_str() {
            "exit" => app.exit(0),
            "learn-more" => {
                let _ = app
                    .opener()
                    .open_url("https://docs.github.com/desktop", None::<&str>);
            }
            _ => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("menu-event", id);
                }
            }
        }
    });
}

/// Forwards native window events to the renderer over the same channel names
/// the Electron main process used (`focus`, `blur`, `window-state-changed`,
/// `native-theme-updated`) so the shared renderer code keeps working unchanged.
fn register_window_event_forwarding(window: tauri::WebviewWindow) {
    let emitter = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(true) => {
            let _ = emitter.emit("focus", ());
        }
        tauri::WindowEvent::Focused(false) => {
            let _ = emitter.emit("blur", ());
        }
        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
            let state = if emitter.is_fullscreen().unwrap_or(false) {
                "full-screen"
            } else if emitter.is_minimized().unwrap_or(false) {
                "minimized"
            } else if emitter.is_maximized().unwrap_or(false) {
                "maximized"
            } else {
                "normal"
            };
            let _ = emitter.emit("window-state-changed", state);
        }
        tauri::WindowEvent::ThemeChanged(_) => {
            let _ = emitter.emit("native-theme-updated", ());
        }
        _ => {}
    });
}
