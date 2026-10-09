use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager};

/// Builds the application menu bar and wires each command item to the
/// renderer's `menu-event` channel, mirroring the Electron default menu in
/// `app/src/main-process/menu/build-default-menu.ts`.
pub fn build_app_menu(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = Menu::new(app)?;

    menu.append(&build_file_menu(app)?)?;
    menu.append(&build_edit_menu(app)?)?;
    menu.append(&build_view_menu(app)?)?;
    menu.append(&build_repository_menu(app)?)?;
    menu.append(&build_branch_menu(app)?)?;
    menu.append(&build_help_menu(app)?)?;

    // Menu item clicks are handled by the app-wide handler in `main.rs`,
    // which forwards ids over the renderer's `menu-event` channel.
    #[cfg(target_os = "macos")]
    app.set_menu(menu)?;

    #[cfg(not(target_os = "macos"))]
    if let Some(window) = app.get_webview_window("main") {
        window.set_menu(menu)?;
    }

    Ok(())
}

fn cmd_item(
    app: &AppHandle,
    id: &str,
    label: &str,
    accelerator: Option<&str>,
) -> Result<MenuItem<tauri::Wry>, Box<dyn std::error::Error>> {
    Ok(MenuItem::with_id(app, id, label, true, accelerator)?)
}

fn separator(app: &AppHandle) -> Result<PredefinedMenuItem<tauri::Wry>, Box<dyn std::error::Error>>
{
    Ok(PredefinedMenuItem::separator(app)?)
}

/// Exit quits the process directly from the menu handler in `main.rs`.
fn exit_item(app: &AppHandle) -> Result<MenuItem<tauri::Wry>, Box<dyn std::error::Error>> {
    Ok(MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?)
}

fn build_file_menu(app: &AppHandle) -> Result<Submenu<tauri::Wry>, Box<dyn std::error::Error>> {
    Ok(Submenu::with_items(
        app,
        "File",
        true,
        &[
            &cmd_item(app, "new-repository", "New Repository", Some("Ctrl+N"))?,
            &cmd_item(
                app,
                "add-local-repository",
                "Add Local Repository…",
                Some("Ctrl+O"),
            )?,
            &cmd_item(
                app,
                "clone-repository",
                "Clone Repository…",
                Some("Ctrl+Shift+O"),
            )?,
            &separator(app)?,
            &cmd_item(app, "preferences", "Preferences…", Some("Ctrl+,"))?,
            &separator(app)?,
            &exit_item(app)?,
        ],
    )?)
}

fn build_edit_menu(app: &AppHandle) -> Result<Submenu<tauri::Wry>, Box<dyn std::error::Error>> {
    Ok(Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &cmd_item(app, "undo", "Undo", Some("Ctrl+Z"))?,
            &cmd_item(app, "redo", "Redo", Some("Ctrl+Y"))?,
            &separator(app)?,
            &cmd_item(app, "cut", "Cut", Some("Ctrl+X"))?,
            &cmd_item(app, "copy", "Copy", Some("Ctrl+C"))?,
            &cmd_item(app, "paste", "Paste", Some("Ctrl+V"))?,
            &cmd_item(app, "select-all", "Select All", Some("Ctrl+A"))?,
        ],
    )?)
}

fn build_view_menu(app: &AppHandle) -> Result<Submenu<tauri::Wry>, Box<dyn std::error::Error>> {
    Ok(Submenu::with_items(
        app,
        "View",
        true,
        &[
            &cmd_item(app, "show-repository-list", "Go to Repository List", Some("Ctrl+T"))?,
            &cmd_item(app, "show-changes", "Show Changes", Some("Ctrl+1"))?,
            &cmd_item(app, "show-history", "Show History", Some("Ctrl+2"))?,
            &cmd_item(app, "show-branches-list", "Branches Overview", Some("Ctrl+Shift+B"))?,
            &separator(app)?,
            &cmd_item(app, "zoom-in", "Zoom In", Some("Ctrl+="))?,
            &cmd_item(app, "zoom-out", "Zoom Out", Some("Ctrl+-"))?,
            &cmd_item(app, "reset-zoom", "Reset Zoom", Some("Ctrl+0"))?,
            &separator(app)?,
            &cmd_item(app, "reload", "Reload", Some("Ctrl+R"))?,
            &cmd_item(app, "toggle-dev-tools", "Toggle Developer Tools", Some("Ctrl+Shift+I"))?,
        ],
    )?)
}

fn build_repository_menu(
    app: &AppHandle,
) -> Result<Submenu<tauri::Wry>, Box<dyn std::error::Error>> {
    Ok(Submenu::with_items(
        app,
        "Repository",
        true,
        &[
            &cmd_item(app, "push", "Push", Some("Ctrl+Shift+P"))?,
            &cmd_item(app, "pull", "Pull", None)?,
            &cmd_item(app, "fetch", "Fetch", None)?,
            &separator(app)?,
            &cmd_item(app, "discard-all-changes", "Discard All Changes…", None)?,
            &cmd_item(app, "stash-all-changes", "Stash All Changes…", None)?,
            &separator(app)?,
            &cmd_item(app, "open-in-shell", "Open in Command Prompt", None)?,
            &cmd_item(app, "open-working-directory", "Show in Explorer", None)?,
            &cmd_item(app, "remove-repository", "Remove Repository…", None)?,
        ],
    )?)
}

fn build_branch_menu(app: &AppHandle) -> Result<Submenu<tauri::Wry>, Box<dyn std::error::Error>> {
    Ok(Submenu::with_items(
        app,
        "Branch",
        true,
        &[
            &cmd_item(app, "create-branch", "New Branch…", Some("Ctrl+Shift+N"))?,
            &cmd_item(app, "rename-branch", "Rename Branch…", None)?,
            &cmd_item(app, "delete-branch", "Delete Branch…", None)?,
            &separator(app)?,
            &cmd_item(app, "merge-branch", "Merge into Current Branch…", None)?,
            &cmd_item(app, "rebase-branch", "Rebase Current Branch on Branch…", None)?,
            &cmd_item(app, "compare-to-branch", "Compare to Branch…", None)?,
        ],
    )?)
}

fn build_help_menu(app: &AppHandle) -> Result<Submenu<tauri::Wry>, Box<dyn std::error::Error>> {
    // "learn-more" opens the docs directly from the menu handler in main.rs.
    let about = cmd_item(app, "about", "About GitHub Desktop", None)?;
    let learn_more = cmd_item(app, "learn-more", "Learn More", None)?;

    Ok(Submenu::with_items(
        app,
        "Help",
        true,
        &[&about, &separator(app)?, &learn_more],
    )?)
}
