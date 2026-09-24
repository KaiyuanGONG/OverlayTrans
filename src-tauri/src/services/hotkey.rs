/// Global hotkey registration via tauri-plugin-global-shortcut.
///
/// On hotkey press, emits a Tauri event "hotkey-triggered" to all windows,
/// which the capture window listens for to trigger a translation.
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Register the global hotkey from config.
/// Calling this again re-registers (unregisters old first).
pub fn register_hotkey(app: &AppHandle, hotkey: &str) {
    // Unregister all existing shortcuts first
    let _ = app.global_shortcut().unregister_all();

    if hotkey.is_empty() {
        return;
    }

    // Parse the string (e.g. "F8", "Ctrl+Shift+T") into a Shortcut
    let shortcut: Shortcut = match hotkey.parse() {
        Ok(s) => s,
        Err(e) => {
            log::warn!("Invalid hotkey string '{hotkey}': {e}");
            return;
        }
    };

    let app_clone = app.clone();

    match app
        .global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                // Emit to all windows via app handle
                let _ = app_clone.emit("hotkey-triggered", ());
            }
        }) {
        Ok(_) => {
            log::info!("Registered global hotkey: {hotkey}");
        }
        Err(e) => {
            log::warn!("Failed to register hotkey '{hotkey}': {e}");
        }
    }
}

/// Unregister all global shortcuts.
#[allow(dead_code)]
pub fn unregister_all(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}
