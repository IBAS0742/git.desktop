use std::sync::mpsc;
use std::sync::Mutex;

use serde_json::Value;

/// Shared app state standing in for the pieces of state the Electron main
/// process kept (guid persistence, zoom factor, menu state).
#[derive(Default)]
pub struct DesktopState {
    /// Replacement for Electron's `save-guid` / `get-guid` channels.
    pub guid: Mutex<Option<String>>,
    /// Last known renderer zoom factor (`set-window-zoom-factor`).
    pub zoom_factor: Mutex<f64>,
    /// Payload of the most recent `update-menu-state` message.
    pub menu_state: Mutex<Value>,
    /// Receiver handshake for an in-flight `show-contextual-menu` request.
    pub context_menu_tx: Mutex<Option<mpsc::Sender<Vec<usize>>>>,
}

impl DesktopState {
    pub fn get_or_create_guid(&self) -> String {
        let mut guard = self.guid.lock().unwrap();
        if guard.is_none() {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let pid = std::process::id();
            *guard = Some(format!("{}-{:x}", pid, nanos));
        }
        guard.clone().unwrap()
    }
}
