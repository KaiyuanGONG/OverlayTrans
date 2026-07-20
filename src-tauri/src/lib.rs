use tauri::{Emitter, Manager};

mod commands;
mod models;
mod services;
mod utils;

use commands::{capture, config, local, ocr, translate};
use services::{emit_config_updated, AppState};

// Reading the fingerprint that build.rs derives from icons/icon.ico ties this
// crate's compilation to the ICO bytes, so `generate_context!` re-embeds the
// window/tray icon whenever the brand assets are regenerated.
const _: &str = env!("OVERLAYTRANS_ICON_FINGERPRINT");
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/32x32.png");

fn load_tray_icon() -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(TRAY_ICON_BYTES)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first so a second launch exits before it can
        // create duplicate windows, tray icons, hotkeys or local runtimes.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_existing_instance(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::set_config,
            config::reset_config,
            config::clear_api_key,
            config::set_capture_region,
            config::set_display_region,
            config::set_onboarding_completed,
            config::get_presets,
            config::apply_startup_mode,
            config::set_trigger_mode,
            capture::trigger_translation_manual,
            capture::start_auto_mode,
            capture::stop_auto_mode,
            capture::get_last_screenshot,
            services::overlay_metrics::get_overlay_metrics,
            ocr::test_ocr_engine,
            ocr::check_ocr_language,
            translate::test_api_text,
            translate::test_api_vlm,
            local::get_local_status,
            local::download_local_model,
            local::cancel_local_model_download,
            local::delete_local_model,
            local::test_local_runtime,
            local::stop_local_runtime,
            local::start_local_runtime,
            show_settings_window,
            show_main_windows,
            hide_main_windows,
            show_onboarding_window,
            reset_window_layout,
            quit_app,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            apply_runtime_icons(&handle);
            services::windows_shell::refresh_owned_shortcuts(&handle);
            match setup_tray(&handle) {
                Ok(tray) => {
                    // Keep tray handle alive for the whole process lifetime.
                    let _ = Box::leak(Box::new(tray));
                }
                Err(e) => log::warn!("Failed to setup tray icon: {e}"),
            }

            // Load config once on startup and read initial UI/runtime state.
            let (onboarding_needed, cfg) = tauri::async_runtime::block_on(async {
                let state = handle.state::<AppState>();
                state.load_config().await.unwrap_or_else(|e| {
                    log::warn!("Failed to load config, using defaults: {e}");
                });
                let cfg = state.config.lock().await.clone();
                (crate::models::config::onboarding_needed(&cfg), cfg)
            });

            services::hotkey::register_hotkey(&handle, &cfg.trigger.hotkey);

            // Apply persisted geometry to overlay windows.
            apply_window_layout(&handle, &cfg);

            // Show the right windows
            if onboarding_needed {
                if let Some(w) = handle.get_webview_window("onboarding") {
                    let _ = w.show();
                } else {
                    // Fallback: onboarding window not found, show main windows
                    show_windows(&handle);
                }
            } else {
                show_windows(&handle);
            }

            let cursor_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                services::cursor_passthrough::start_polling(cursor_handle).await;
            });

            // Ensure runtime auto/manual state matches persisted config.
            if !onboarding_needed {
                let _ = tauri::async_runtime::block_on(async {
                    let state = handle.state::<AppState>();
                    config::apply_startup_mode(state, handle.clone()).await
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running OverlayTrans")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                // Covers tray exit, command exit and OS shutdown paths. Block
                // briefly so the bundled child cannot outlive the app.
                tauri::async_runtime::block_on(async {
                    let state = app_handle.state::<AppState>();
                    let runtime = state.local_runtime.read().await;
                    runtime.stop(app_handle).await;
                });
            }
        });
}

fn focus_existing_instance(handle: &tauri::AppHandle) {
    // Preserve the user's current workflow when a dedicated window is open.
    for label in ["onboarding", "settings"] {
        if let Some(window) = handle.get_webview_window(label) {
            if window.is_visible().unwrap_or(false) {
                let _ = window.unminimize();
                let _ = window.set_focus();
                return;
            }
        }
    }

    show_windows(handle);
    if let Some(window) = handle.get_webview_window("translation") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn apply_runtime_icons(handle: &tauri::AppHandle) {
    let Some(icon) = handle.default_window_icon().cloned() else {
        return;
    };
    for label in ["settings", "onboarding", "capture", "translation"] {
        if let Some(window) = handle.get_webview_window(label) {
            let _ = window.set_icon(icon.clone());
        }
    }
}

fn show_windows(handle: &tauri::AppHandle) {
    for label in &["capture", "translation"] {
        if let Some(w) = handle.get_webview_window(label) {
            let _ = w.show();
        }
    }
}

fn hide_windows(handle: &tauri::AppHandle) {
    for label in &["capture", "translation"] {
        if let Some(w) = handle.get_webview_window(label) {
            let _ = w.hide();
        }
    }
}

fn any_main_window_visible(handle: &tauri::AppHandle) -> bool {
    ["capture", "translation"].iter().any(|label| {
        handle
            .get_webview_window(label)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false)
    })
}

fn toggle_main_windows(handle: &tauri::AppHandle) {
    if any_main_window_visible(handle) {
        hide_windows(handle);
    } else {
        show_windows(handle);
    }
}

fn ensure_settings_window(handle: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(w) = handle.get_webview_window("settings") {
        return Ok(w);
    }

    tauri::WebviewWindowBuilder::new(
        handle,
        "settings",
        tauri::WebviewUrl::App("/#/settings".into()),
    )
    .title("OverlayTrans - Settings")
    .inner_size(720.0, 600.0)
    .resizable(false)
    .decorations(true)
    .transparent(false)
    .always_on_top(false)
    .skip_taskbar(false)
    .visible(false)
    .build()
}

fn ensure_onboarding_window(handle: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(window) = handle.get_webview_window("onboarding") {
        return Ok(window);
    }

    tauri::WebviewWindowBuilder::new(
        handle,
        "onboarding",
        tauri::WebviewUrl::App("/#/onboarding".into()),
    )
    .title("OverlayTrans - Welcome")
    .inner_size(680.0, 480.0)
    .center()
    .resizable(false)
    .decorations(true)
    .transparent(false)
    .always_on_top(true)
    .skip_taskbar(false)
    .visible(false)
    .build()
}

fn show_settings_window_impl(handle: &tauri::AppHandle) -> tauri::Result<()> {
    let w = ensure_settings_window(handle)?;
    if let Some(icon) = handle.default_window_icon().cloned() {
        let _ = w.set_icon(icon);
    }
    w.show()?;
    // Restore from minimized state — show() alone is a no-op on minimized windows.
    let _ = w.unminimize();
    w.set_focus()?;
    Ok(())
}

fn setup_tray(handle: &tauri::AppHandle) -> tauri::Result<tauri::tray::TrayIcon> {
    use tauri::menu::MenuBuilder;
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let menu = MenuBuilder::new(handle)
        .text("tray_show_main", "显示主窗口")
        .text("tray_open_settings", "打开设置")
        .separator()
        .text("tray_quit", "退出")
        .build()?;

    let mut tray_builder = TrayIconBuilder::with_id("overlaytrans-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show_main" => show_windows(app),
            "tray_open_settings" => {
                if let Err(e) = show_settings_window_impl(app) {
                    log::warn!("Failed to open settings window from tray: {e}");
                }
            }
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_main_windows(app);
            }
        });

    // Tauri's default Windows icon is decoded from the first ICO frame (the
    // detailed 256 px artwork). Use the approved compact 32 px asset directly
    // so the tray does not downsample the large mark into an illegible glyph.
    tray_builder = tray_builder.icon(load_tray_icon()?);

    tray_builder.build(handle)
}

fn apply_window_layout(handle: &tauri::AppHandle, cfg: &crate::models::config::AppConfig) {
    if let Some(w) = handle.get_webview_window("capture") {
        let _ = w.set_position(tauri::PhysicalPosition::new(
            cfg.capture_region.x,
            cfg.capture_region.y,
        ));
        let _ = w.set_size(tauri::PhysicalSize::new(
            cfg.capture_region.width,
            cfg.capture_region.height,
        ));
    }

    if let Some(w) = handle.get_webview_window("translation") {
        let _ = w.set_position(tauri::PhysicalPosition::new(cfg.display.x, cfg.display.y));
        let _ = w.set_size(tauri::PhysicalSize::new(
            cfg.display.width,
            cfg.display.height,
        ));
    }
}

#[tauri::command]
async fn show_settings_window(handle: tauri::AppHandle) -> Result<(), String> {
    show_settings_window_impl(&handle).map_err(|e| e.to_string())
}

#[tauri::command]
async fn show_main_windows(handle: tauri::AppHandle) -> Result<(), String> {
    show_windows(&handle);
    Ok(())
}

#[tauri::command]
async fn hide_main_windows(handle: tauri::AppHandle) -> Result<(), String> {
    hide_windows(&handle);
    Ok(())
}

#[tauri::command]
async fn show_onboarding_window(handle: tauri::AppHandle) -> Result<(), String> {
    let window = ensure_onboarding_window(&handle).map_err(|e| e.to_string())?;
    if let Some(icon) = handle.default_window_icon().cloned() {
        let _ = window.set_icon(icon);
    }
    window.show().map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    let _ = window.emit("onboarding-replay-requested", ());
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn reset_window_layout(
    state: tauri::State<'_, AppState>,
    handle: tauri::AppHandle,
) -> Result<(), String> {
    let _update_guard = state.config_update_mutex.lock().await;
    use crate::models::config::{CaptureRegion, DisplayConfig};
    let dc = CaptureRegion::default();
    let dd = DisplayConfig::default();
    {
        let mut cfg = state.config.lock().await;
        cfg.capture_region.x = dc.x;
        cfg.capture_region.y = dc.y;
        cfg.capture_region.width = dc.width;
        cfg.capture_region.height = dc.height;
        cfg.display.x = dd.x;
        cfg.display.y = dd.y;
        cfg.display.width = dd.width;
        cfg.display.height = dd.height;
    }
    state.save_config().await.map_err(|e| e.to_string())?;
    let cfg = state.config.lock().await.clone();
    apply_window_layout(&handle, &cfg);
    show_windows(&handle);
    emit_config_updated(&handle, &state, &cfg);
    Ok(())
}

#[tauri::command]
async fn quit_app(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    // Stop local runtime before exiting
    let runtime = state.local_runtime.read().await;
    runtime.stop(&app).await;
    drop(runtime);
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::TRAY_ICON_BYTES;
    use image::GenericImageView;

    #[test]
    fn tray_uses_a_real_compact_32px_png() {
        let image = image::load_from_memory(TRAY_ICON_BYTES).expect("decode tray icon");
        assert_eq!((image.width(), image.height()), (32, 32));
    }
}
