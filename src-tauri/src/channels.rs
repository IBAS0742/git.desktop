use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::menu::{ContextMenu, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::plugin::PermissionState;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

use crate::state::DesktopState;

/// Debug trace appended to a file in the repo root so deadlocks and
/// navigation events are observable without a debugger attached.
pub fn trace(msg: &str) {
    use std::io::Write;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join("github-desktop-tauri-auth.log"))
    {
        let _ = writeln!(f, "[{millis}] {msg}");
    }
}

fn arg(args: &[Value], i: usize) -> Result<&Value, String> {
    args.get(i)
        .ok_or_else(|| format!("missing argument at index {i}"))
}

fn arg_str(args: &[Value], i: usize) -> Result<String, String> {
    Ok(arg(args, i)?
        .as_str()
        .ok_or_else(|| format!("argument at index {i} is not a string"))?
        .to_string())
}

fn arg_f64(args: &[Value], i: usize) -> Result<f64, String> {
    arg(args, i)?
        .as_f64()
        .ok_or_else(|| format!("argument at index {i} is not a number"))
}

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())
}

/// True for GitHub's browser OAuth authorization endpoint
/// (`…/login/oauth/authorize`), which should open in the in-app sign-in
/// window rather than the system browser.
fn is_oauth_authorize_url(raw: &str) -> bool {
    tauri::Url::parse(raw)
        .map(|u| {
            (u.scheme() == "https" || u.scheme() == "http")
                && u.path().contains("/login/oauth/authorize")
        })
        .unwrap_or(false)
}

/// Parses the OAuth callback that GitHub redirects to after authorization,
/// mirroring `parseAppURL` in app/src/lib/parse-app-url.ts. Production
/// builds use `x-github-client://oauth`; development client ids (the
/// `devClientId` bundled into local builds) redirect to
/// `x-github-desktop-dev-auth://oauth` instead — both must be captured.
fn parse_oauth_callback(raw: &str) -> Option<Value> {
    let url = tauri::Url::parse(raw).ok()?;
    if url.scheme() != "x-github-client" && url.scheme() != "x-github-desktop-dev-auth" {
        return None;
    }
    if url.host_str()?.to_lowercase() != "oauth" {
        return None;
    }
    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.to_string()),
            "state" => state = Some(value.to_string()),
            _ => {}
        }
    }
    Some(json!({
        "name": "oauth",
        "code": code?,
        "state": state?,
    }))
}

/// Opens (or reuses) the in-app sign-in window for the given authorization
/// URL. The window itself is created once at startup (see
/// `build_auth_window`) because calling `WebviewWindowBuilder::build()`
/// from inside a sync command deadlocks: the main thread blocks waiting on
/// WebView2's async completion callback, which needs the same message pump.
/// `navigate`/`show`/`set_focus` never wait, so the reuse path is safe.
fn open_oauth_window(app: &AppHandle, raw: &str) -> Result<(), String> {
    trace(&format!("open_oauth_window: raw={raw}"));
    let url = tauri::Url::parse(raw).map_err(json_err)?;

    let window = match app.get_webview_window("auth") {
        Some(existing) => existing,
        None => {
            trace("open_oauth_window: auth window missing, building (fallback)");
            build_auth_window(app)?;
            app.get_webview_window("auth")
                .ok_or_else(|| "auth window not found after build".to_string())?
        }
    };

    let r = window.navigate(url).map_err(json_err);
    trace(&format!("open_oauth_window: navigate -> {r:?}"));
    r?;
    let _ = window.show();
    let _ = window.set_focus();
    trace("open_oauth_window: shown + focused");
    Ok(())
}

/// Creates the (initially hidden) sign-in window at startup, wiring the
/// navigation hook that captures the `x-github-client://oauth` callback and
/// forwards it to the main window as the same `url-action` event Electron
/// produced from its protocol handler.
pub fn build_auth_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    trace("build_auth_window: start");
    let handle = app.clone();
    let url = tauri::Url::parse("about:blank").map_err(json_err)?;
    let built = tauri::WebviewWindowBuilder::new(app, "auth", tauri::WebviewUrl::External(url))
        .title("Sign in to GitHub")
        .inner_size(580.0, 780.0)
        .center()
        .visible(false)
        .focused(false)
        .on_navigation(move |nav| {
            trace(&format!("on_navigation: {}", nav.as_str()));
            if let Some(action) = parse_oauth_callback(nav.as_str()) {
                if let Some(main) = handle.get_webview_window("main") {
                    let _ = main.emit("url-action", action);
                }
                // Hide (never destroy) the window outside the navigation
                // callback, reset it to a blank page, and hand focus back to
                // the main window. The window is reused for the next sign-in.
                let finish_handle = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(100));
                    if let Some(auth) = finish_handle.get_webview_window("auth") {
                        let _ = auth.navigate(tauri::Url::parse("about:blank").unwrap());
                        let _ = auth.hide();
                    }
                    if let Some(main) = finish_handle.get_webview_window("main") {
                        let _ = main.set_focus();
                    }
                });
                return false;
            }
            true
        })
        .build()
        .map_err(json_err);
    match &built {
        Ok(_) => trace("build_auth_window: -> Ok"),
        Err(e) => trace(&format!("build_auth_window: -> Err({e})")),
    }
    let window = built?;

    // Clicking the window's close button hides it instead of destroying it,
    // so the next sign-in never has to build a window from a command again.
    let close_handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Some(auth) = close_handle.get_webview_window("auth") {
                let _ = auth.hide();
            }
        }
    });
    Ok(window)
}

fn json_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Resolves an HTTP proxy for the token exchange and labels its source.
/// Env vars win; otherwise the Windows system proxy (IE/WinINET registry
/// settings) is used — the same proxy WebView2 itself picks up, so apps
/// double-clicked from Explorer behave like the built-in browser window.
fn resolve_http_proxy() -> (Option<String>, &'static str) {
    let env_proxy = [
        "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy",
    ]
    .iter()
    .find_map(|k| std::env::var(k).ok())
    .filter(|v| !v.trim().is_empty());
    if env_proxy.is_some() {
        return (env_proxy, "env");
    }
    (system_proxy(), "system")
}

#[cfg(windows)]
fn system_proxy() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .ok()?;
    let enabled: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    if enabled == 0 {
        return None;
    }
    let raw: String = key.get_value("ProxyServer").unwrap_or_default();
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    // ProxyServer is either "host:port" or a per-protocol map such as
    // "http=host:port;https=host:port;socks=host:port".
    let chosen = if raw.contains('=') {
        let mut entries: Vec<(String, String)> = Vec::new();
        for entry in raw.split(';') {
            if let Some((k, v)) = entry.split_once('=') {
                let v = v.trim();
                if !v.is_empty() {
                    entries.push((k.trim().to_ascii_lowercase(), v.to_string()));
                }
            }
        }
        entries
            .iter()
            .find(|(k, _)| k == "https")
            .or_else(|| entries.iter().find(|(k, _)| k == "http"))
            .or_else(|| entries.first())
            .map(|(_, v)| v.clone())?
    } else {
        raw.to_string()
    };
    if chosen.contains("://") {
        Some(chosen)
    } else {
        Some(format!("http://{chosen}"))
    }
}

#[cfg(not(windows))]
fn system_proxy() -> Option<String> {
    None
}

/// Exchanges an OAuth authorization code (or refreshes a token) against
/// GitHub's HTML token endpoint. The renderer cannot do this itself: GitHub
/// responds without `Access-Control-Allow-Origin`, so the webview's fetch is
/// blocked. Called from the async `oauth_token_exchange` command so the
/// blocking request never runs on the main thread.
pub fn exchange_oauth_token(raw_url: &str, body: &str) -> Result<Value, String> {
    let url = tauri::Url::parse(raw_url).map_err(json_err)?;
    if url.scheme() != "https" || !url.path().ends_with("/login/oauth/access_token") {
        return Err("oauth token exchange url not allowed".to_string());
    }
    trace("oauth-token-exchange: POST");
    let mut builder = ureq::AgentBuilder::new().timeout(Duration::from_secs(20));

    // Standard env proxy vars first, then the Windows system proxy — the
    // same sources curl/git/WebView2 honour, so Explorer double-click
    // launches (no env vars) still reach github.com on proxied networks.
    // NO_PROXY entries bypass it so intranet Enterprise endpoints work.
    let (proxy_url, proxy_source) = resolve_http_proxy();
    let host = url.host_str().unwrap_or_default().to_string();
    let no_proxy = std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .unwrap_or_default();
    let bypasses = no_proxy
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .any(|p| {
            if p == "*" {
                return true;
            }
            let host_l = host.to_ascii_lowercase();
            let p_l = p.to_ascii_lowercase();
            let p_l = p_l.trim_start_matches('.');
            host_l == p_l || host_l.ends_with(&format!(".{p_l}"))
        });
    if let Some(proxy_url) = proxy_url {
        if bypasses {
            trace("oauth-token-exchange: NO_PROXY matched, direct");
        } else {
            match ureq::Proxy::new(&proxy_url) {
                Ok(proxy) => {
                    trace(&format!("oauth-token-exchange: using {proxy_source} proxy"));
                    builder = builder.proxy(proxy);
                }
                Err(e) => trace(&format!("oauth-token-exchange: bad proxy url: {e}")),
            }
        }
    }
    let agent = builder.build();
    let result = agent
        .post(url.as_str())
        .set("Accept", "application/json")
        .set("Content-Type", "application/json")
        .set("User-Agent", "GitHubDesktop/3.6.7")
        .send_string(body);
    let (status, text) = match result {
        Ok(resp) => (resp.status(), resp.into_string().unwrap_or_default()),
        // ureq reports non-2xx as an error carrying the response.
        Err(ureq::Error::Status(code, resp)) => (code, resp.into_string().unwrap_or_default()),
        Err(e) => {
            trace(&format!("oauth-token-exchange: transport error {e}"));
            return Err(format!("The OAuth token request failed: {e}"));
        }
    };
    trace(&format!("oauth-token-exchange: status {status}"));
    Ok(json!({ "status": status, "body": text }))
}

fn current_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}

/// Handles every request/response channel declared in
/// `app/src/lib/ipc-shared.ts` (`RequestResponseChannels`).
pub fn handle_invoke(app: &AppHandle, channel: &str, args: Vec<Value>) -> Result<Value, String> {
    match channel {
        "get-path" => get_path(app, &arg_str(&args, 0)?),
        "get-app-architecture" => Ok(json!(current_arch())),
        // The renderer's "app path" is the web asset root: frontend assets
        // are embedded in the Tauri binary and served over the asset
        // protocol rather than read from disk, so paths such as
        // `<appPath>/emoji.json` must resolve to `/emoji.json` for fetch()
        // to find them.
        "get-app-path" => Ok(json!("/")),
        "get-exec-path" => Ok(json!(
            std::env::current_exe().map_err(json_err)?.to_string_lossy()
        )),
        "is-running-under-arm64-translation" => Ok(json!(false)),
        "move-to-trash" => {
            trash::delete(arg_str(&args, 0)?).map_err(json_err)?;
            Ok(Value::Null)
        }
        "show-item-in-folder" => {
            let path = arg_str(&args, 0)?;
            app.opener().reveal_item_in_dir(path).map_err(json_err)?;
            Ok(Value::Null)
        }
        "write-clipboard-text" => {
            let text = arg_str(&args, 0)?;
            app.clipboard().write_text(text).map_err(json_err)?;
            Ok(Value::Null)
        }
        "confirm-reveal-directory" => Ok(json!(true)),
        "show-contextual-menu" => show_contextual_menu(app, arg(&args, 0)?),
        "is-window-focused" => Ok(json!(main_window(app)?.is_focused().map_err(json_err)?)),
        "open-external" => {
            let path = arg_str(&args, 0)?;
            trace(&format!("open-external: {path}"));
            if is_oauth_authorize_url(&path) {
                // Browser-based OAuth sign-in: show an in-app window so the
                // x-github-client:// callback can be captured here instead of
                // relying on a system protocol handler that is not
                // registered for the Tauri build.
                open_oauth_window(app, &path)?;
                Ok(json!(true))
            } else {
                app.opener().open_url(path, None::<&str>).map_err(json_err)?;
                Ok(json!(true))
            }
        }
        // Only meaningful on macOS; on Windows/Linux Electron returns null.
        "is-in-application-folder" => Ok(Value::Null),
        "move-to-applications-folder" => Ok(Value::Null),
        // Auto-updater is not wired up yet; report "no update available".
        "check-for-updates" => Ok(Value::Null),
        "get-current-window-state" => window_state(&main_window(app)?),
        "get-current-window-zoom-factor" => {
            let state = app.state::<DesktopState>();
            let factor = *state.zoom_factor.lock().unwrap();
            Ok(json!(factor))
        }
        // No system proxy resolution yet; direct connection like Electron's
        // default when no proxy is configured.
        "resolve-proxy" => Ok(json!("direct://")),
        "show-open-dialog" => show_open_dialog(app, args.first()),
        "show-save-dialog" => show_save_dialog(app, args.first()),
        "is-window-maximized" => Ok(json!(main_window(app)?.is_maximized().map_err(json_err)?)),
        "get-apple-action-on-double-click" => Ok(json!("zoom")),
        "should-use-dark-colors" => Ok(json!(matches!(
            main_window(app)?.theme().map_err(json_err)?,
            tauri::Theme::Dark
        ))),
        "save-guid" => {
            let guid = arg_str(&args, 0)?;
            let state = app.state::<DesktopState>();
            *state.guid.lock().unwrap() = Some(guid);
            Ok(Value::Null)
        }
        "get-guid" => {
            let state = app.state::<DesktopState>();
            Ok(json!(state.get_or_create_guid()))
        }
        "show-notification" => show_notification(app, &args),
        "get-notifications-permission" => {
            let permission = app.notification().permission_state().map_err(json_err)?;
            Ok(json!(match permission {
                PermissionState::Granted => "granted",
                PermissionState::Denied => "denied",
                PermissionState::Prompt | PermissionState::PromptWithRationale => "default",
            }))
        }
        "request-notifications-permission" => {
            let permission = app.notification().request_permission().map_err(json_err)?;
            Ok(json!(permission == PermissionState::Granted))
        }
        _ => Err(format!("unknown invoke channel: {channel}")),
    }
}

/// Handles every simplex channel declared in `app/src/lib/ipc-shared.ts`
/// (`RequestChannels`). Channels whose behavior only exists in Electron
/// (auto-updater, crash reporting, ...) are accepted and logged so the
/// renderer never breaks over a missing handler.
pub fn handle_send(app: &AppHandle, channel: &str, args: Vec<Value>) -> Result<(), String> {
    match channel {
        "log" => {
            let level = arg_str(&args, 0).unwrap_or_else(|_| "info".into());
            let message = arg_str(&args, 1).unwrap_or_default();
            let line = format!("[renderer] {message}");
            match level.as_str() {
                "error" => log::error!("{line}"),
                "warn" => log::warn!("{line}"),
                "debug" => log::debug!("{line}"),
                _ => log::info!("{line}"),
            }
        }
        "quit-app" | "will-quit" | "will-quit-even-if-updating"
        | "quit-and-install-updates" => {
            app.exit(0);
        }
        "cancel-quitting" => {}
        "minimize-window" => main_window(app)?.minimize().map_err(json_err)?,
        "maximize-window" => {
            let window = main_window(app)?;
            if !window.is_maximized().map_err(json_err)? {
                window.maximize().map_err(json_err)?;
            }
        }
        "unmaximize-window" => {
            let window = main_window(app)?;
            if window.is_maximized().map_err(json_err)? {
                window.unmaximize().map_err(json_err)?;
            }
        }
        "close-window" => main_window(app)?.close().map_err(json_err)?,
        "focus-window" => main_window(app)?.set_focus().map_err(json_err)?,
        "set-window-zoom-factor" => {
            let factor = arg_f64(&args, 0).unwrap_or(1.0);
            let state = app.state::<DesktopState>();
            *state.zoom_factor.lock().unwrap() = factor;
            main_window(app)?.set_zoom(factor).map_err(json_err)?;
        }
        "select-all-window-contents" => {
            main_window(app)?
                .eval("document.execCommand('selectAll')")
                .map_err(json_err)?;
        }
        "execute-menu-item-by-id" => {
            // Menu commands in GitHub Desktop dispatch back to the renderer
            // over `menu-event`, so route the id the same way a native click
            // would.
            let id = arg_str(&args, 0)?;
            emit_menu_event(app, &id);
        }
        "update-menu-state" => {
            let state = app.state::<DesktopState>();
            *state.menu_state.lock().unwrap() = args.first().cloned().unwrap_or(Value::Null);
            // TODO: enable/disable native menu items to match.
        }
        "update-window-background-color" | "set-native-theme-source"
        | "zoom-factor-changed" | "window-state-changed" | "dialog-did-open"
        | "renderer-ready" | "get-app-menu" | "update-preferred-app-menu-item-labels"
        | "crash-ready" | "crash-quit" | "show-installing-update"
        | "install-windows-cli" | "uninstall-windows-cli" | "launch-timing-stats"
        | "update-accounts" | "resolve-image-token" | "app-menu" | "menu-event"
        | "focus" | "blur" | "native-theme-updated" | "url-action" | "cli-action"
        | "certificate-error" | "notification-event" | "resolved-image-token"
        | "auto-updater-error" | "auto-updater-checking-for-update"
        | "auto-updater-update-available" | "auto-updater-update-not-available"
        | "auto-updater-update-downloaded" => {
            log::debug!("unhandled simplex channel from renderer: {channel}");
        }
        "uncaught-exception" | "send-error-report" | "error" => {
            log::error!("renderer reported an error on '{channel}': {args:?}");
        }
        "show-certificate-trust-dialog" => {
            log::warn!("show-certificate-trust-dialog is not supported yet");
        }
        "unsafe-open-directory" => {
            let path = arg_str(&args, 0)?;
            app.opener().open_path(path, None::<&str>).map_err(json_err)?;
        }
        _ => {
            log::warn!("unknown simplex channel from renderer: {channel}");
        }
    }
    Ok(())
}

fn window_state(window: &tauri::WebviewWindow) -> Result<Value, String> {
    Ok(if window.is_fullscreen().map_err(json_err)? {
        json!("full-screen")
    } else if window.is_minimized().map_err(json_err)? {
        json!("minimized")
    } else if window.is_maximized().map_err(json_err)? {
        json!("maximized")
    } else {
        json!("normal")
    })
}

fn emit_menu_event(app: &AppHandle, id: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("menu-event", id.to_string());
    }
}

fn get_path(app: &AppHandle, kind: &str) -> Result<Value, String> {
    let resolver = app.path();
    let path: PathBuf = match kind {
        "home" | "recent" => resolver.home_dir().map_err(json_err),
        "appData" | "userData" | "sessionData" => resolver.app_data_dir().map_err(json_err),
        "temp" => Ok(std::env::temp_dir()),
        "exe" | "module" => std::env::current_exe().map_err(json_err),
        "desktop" => resolver.desktop_dir().map_err(json_err),
        "documents" => resolver.document_dir().map_err(json_err),
        "downloads" => resolver.download_dir().map_err(json_err),
        "music" => resolver.audio_dir().map_err(json_err),
        "pictures" => resolver.picture_dir().map_err(json_err),
        "videos" => resolver.video_dir().map_err(json_err),
        "logs" => resolver.app_log_dir().map_err(json_err),
        "crashDumps" => resolver.app_cache_dir().map_err(json_err),
        _ => Err(format!("unknown path type: {kind}")),
    }?;
    Ok(json!(path.to_string_lossy()))
}

fn show_open_dialog(app: &AppHandle, options: Option<&Value>) -> Result<Value, String> {
    let mut builder = app.dialog().file();

    if let Some(title) = options
        .and_then(|o| o.get("title"))
        .and_then(|v| v.as_str())
    {
        builder = builder.set_title(title.to_string());
    }

    if let Some(default_path) = options
        .and_then(|o| o.get("defaultPath"))
        .and_then(|v| v.as_str())
    {
        builder = builder.set_directory(default_path.to_string());
    }

    let wants_directories = options
        .and_then(|o| o.get("properties"))
        .and_then(|v| v.as_array())
        .map(|props| {
            props
                .iter()
                .any(|p| p.as_str() == Some("openDirectory"))
        })
        .unwrap_or(false);

    let picked = if wants_directories {
        builder
            .blocking_pick_folders()
            .and_then(|paths| paths.into_iter().next())
    } else {
        builder
            .blocking_pick_files()
            .and_then(|paths| paths.into_iter().next())
    };

    Ok(match picked {
        Some(path) => json!(path.into_path().map_err(json_err)?.to_string_lossy()),
        None => Value::Null,
    })
}

fn show_save_dialog(app: &AppHandle, options: Option<&Value>) -> Result<Value, String> {
    let mut builder = app.dialog().file();

    if let Some(title) = options
        .and_then(|o| o.get("title"))
        .and_then(|v| v.as_str())
    {
        builder = builder.set_title(title.to_string());
    }

    if let Some(default_path) = options
        .and_then(|o| o.get("defaultPath"))
        .and_then(|v| v.as_str())
    {
        let path = PathBuf::from(default_path);
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                builder = builder.set_directory(parent.to_string_lossy().to_string());
            }
        }
        if let Some(file_name) = path.file_name() {
            builder = builder.set_file_name(file_name.to_string_lossy().to_string());
        }
    }

    let picked = builder.blocking_save_file();
    Ok(match picked {
        Some(path) => json!(path.into_path().map_err(json_err)?.to_string_lossy()),
        None => Value::Null,
    })
}

fn show_notification(app: &AppHandle, args: &[Value]) -> Result<Value, String> {
    let title = arg_str(args, 0)?;
    let body = args
        .get(1)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let id = std::process::id() as i32;
    app.notification()
        .builder()
        .id(id)
        .title(title)
        .body(body)
        .show()
        .map_err(json_err)?;

    Ok(json!(id.to_string()))
}

/// Anything a context menu item can be appended to.
trait AppendableMenu {
    fn append_item(&self, item: &dyn IsMenuItem<tauri::Wry>) -> tauri::Result<()>;
}

impl AppendableMenu for Menu<tauri::Wry> {
    fn append_item(&self, item: &dyn IsMenuItem<tauri::Wry>) -> tauri::Result<()> {
        self.append(item)
    }
}

impl AppendableMenu for Submenu<tauri::Wry> {
    fn append_item(&self, item: &dyn IsMenuItem<tauri::Wry>) -> tauri::Result<()> {
        self.append(item)
    }
}

/// Builds and pops up a native context menu from the serializable menu item
/// structure the renderer sends, returning the path of indices of the item
/// the user chose (or null when nothing was selected).
///
/// Clicks are observed through the app-wide menu event handler in `main.rs`,
/// which routes ids prefixed with `ctx:` into `DesktopState::context_menu_tx`.
fn show_contextual_menu(app: &AppHandle, items: &Value) -> Result<Value, String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let (sender, receiver) = mpsc::channel::<Vec<usize>>();

    {
        let state = app.state::<DesktopState>();
        *state.context_menu_tx.lock().unwrap() = Some(sender);
    }

    let menu = build_context_menu(app, items, &[])?;

    // On Windows this runs a modal track-popup loop, so the selection is
    // usually already recorded when this returns; otherwise the timeout
    // bounds the wait after a dismiss-without-selection.
    menu.popup(window).map_err(json_err)?;
    let selection = receiver.recv_timeout(Duration::from_secs(10)).ok();

    let state = app.state::<DesktopState>();
    *state.context_menu_tx.lock().unwrap() = None;

    Ok(match selection {
        Some(path) => json!(path),
        None => Value::Null,
    })
}

fn build_context_menu(
    app: &AppHandle,
    items: &Value,
    prefix: &[usize],
) -> Result<Menu<tauri::Wry>, String> {
    let menu = Menu::new(app).map_err(json_err)?;
    append_context_items(app, &menu, items, prefix)?;
    Ok(menu)
}

fn append_context_items(
    app: &AppHandle,
    container: &dyn AppendableMenu,
    items: &Value,
    prefix: &[usize],
) -> Result<(), String> {
    let entries = items
        .as_array()
        .ok_or_else(|| "show-contextual-menu expects an array of items".to_string())?;

    for (index, item) in entries.iter().enumerate() {
        let mut path = prefix.to_vec();
        path.push(index);

        let item_type = item
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("normal");

        if item_type == "separator" {
            container
                .append_item(&PredefinedMenuItem::separator(app).map_err(json_err)?)
                .map_err(json_err)?;
            continue;
        }

        let label = item
            .get("label")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let enabled = item
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        if item.get("submenu").and_then(|v| v.as_array()).is_some() {
            let submenu = Submenu::new(app, &label, enabled).map_err(json_err)?;
            append_context_items(app, &submenu, item.get("submenu").unwrap(), &path)?;
            container.append_item(&submenu).map_err(json_err)?;
        } else {
            let id = format!(
                "ctx:{}",
                path.iter()
                    .map(|i| i.to_string())
                    .collect::<Vec<_>>()
                    .join(":")
            );
            let entry = MenuItem::with_id(app, id, &label, enabled, None::<&str>)
                .map_err(json_err)?;
            container.append_item(&entry).map_err(json_err)?;
        }
    }

    Ok(())
}
