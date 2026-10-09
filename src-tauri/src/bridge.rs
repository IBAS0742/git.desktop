use serde_json::Value;
use tauri::AppHandle;

/// Generic request/response bridge. The renderer's `ipc-renderer.ts`
/// `invoke(channel, ...args)` maps onto this command so the existing typed
/// IPC contract in `app/src/lib/ipc-shared.ts` keeps its shape.
/// High-frequency read-only channels are not traced; everything else is
/// logged so deadlocks like the one this log originally caught are visible.
fn should_trace(channel: &str) -> bool {
    !matches!(
        channel,
        "get-path"
            | "get-app-path"
            | "is-window-focused"
            | "get-current-window-state"
            | "get-current-window-zoom-factor"
            | "should-use-dark-colors"
            | "check-for-updates"
    )
}

#[tauri::command]
pub fn desktop_invoke(app: AppHandle, channel: String, args: Vec<Value>) -> Result<Value, String> {
    if should_trace(&channel) {
        crate::channels::trace(&format!("invoke: {channel}"));
    }
    let r = crate::channels::handle_invoke(&app, &channel, args);
    if should_trace(&channel) {
        crate::channels::trace(&format!("invoke done: {channel} ok={}", r.is_ok()));
    }
    r
}

/// Generic simplex (fire-and-forget) bridge matching the renderer's
/// `ipc-renderer.ts` `send(channel, ...args)`.
#[tauri::command]
pub fn desktop_send(app: AppHandle, channel: String, args: Vec<Value>) -> Result<(), String> {
    crate::channels::handle_send(&app, &channel, args)
}

/// OAuth token exchange, mirrored from the renderer's `fetch` to
/// `https://github.com/login/oauth/access_token` (which sends no CORS
/// headers, so the webview's fetch would be blocked). This is a separate
/// async command rather than a `desktop_invoke` channel so the blocking
/// HTTPS request runs on the async runtime pool and never the main thread.
#[tauri::command]
pub async fn oauth_token_exchange(
    url: String,
    body: String,
) -> Result<serde_json::Value, String> {
    crate::channels::exchange_oauth_token(&url, &body)
}

/// Test helper used by the smoke-test page to create a temp file that can
/// then be exercised with `move-to-trash`.
#[tauri::command]
pub fn smoke_create_temp_file() -> Result<String, String> {
    let path = std::env::temp_dir().join(format!("ghd-smoke-{}.txt", std::process::id()));
    std::fs::write(&path, "GitHub Desktop Tauri smoke test\n").map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
