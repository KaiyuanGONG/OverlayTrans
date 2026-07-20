/// Cursor pass-through polling for the capture overlay window.
///
/// Tauri 2.0 + WebView2 does not support region-based selective mouse
/// interception. We implement it by polling the cursor position and
/// dynamically calling set_ignore_cursor_events() based on whether the cursor
/// is in the "border zone" (should intercept) or "center zone" (pass through).
///
/// Reliability rules (the toggle must win the race against a mouse press):
/// - The interception zone is *pre-armed*: it extends `ARM_MARGIN_PX` beyond
///   every visible handle (including slightly outside the window), so
///   interception is already enabled by the time the cursor lands on a handle.
/// - While any mouse button is held the state is frozen — toggling
///   WS_EX_TRANSPARENT mid-gesture would break an in-flight drag/resize.
/// - Polling runs at ~120 fps to keep the arming latency below one frame of
///   typical mouse motion.
///
/// Constants come from `overlay_metrics` — the single source of truth.
use std::time::Duration;
use tauri::{AppHandle, Manager};

use super::overlay_metrics::{BORDER_PX, EDGE_PX, HANDLE_PX, TITLE_H};

const POLL_INTERVAL_MS: u64 = 8; // ~120fps
/// Extra CSS pixels around every interactive zone where interception is
/// armed early. Clicks in this ring are swallowed instead of passed to the
/// game — a deliberate trade for reliable resize grabs.
const ARM_MARGIN_PX: f64 = 12.0;

/// Hit-test the interactive (intercepting) region, inflated by `margin_px`
/// CSS pixels. `margin_px = 0.0` describes the exact visible handles; the
/// poller passes `ARM_MARGIN_PX` to pre-arm interception. Coordinates may lie
/// outside the client area (negative or beyond the size) when a margin is used.
fn should_intercept_at(
    rel_x: i32,
    rel_y: i32,
    win_w: i32,
    win_h: i32,
    scale: f64,
    margin_px: f64,
) -> bool {
    let margin = (margin_px * scale).round() as i32;
    if rel_x < -margin || rel_y < -margin || rel_x >= win_w + margin || rel_y >= win_h + margin {
        return false;
    }

    let title_h = (TITLE_H * scale).round() as i32 + margin;
    let handle_px = (HANDLE_PX * scale).round() as i32 + margin;
    let edge_px = (BORDER_PX.max(EDGE_PX) * scale).round() as i32 + margin;

    let in_corner = (rel_x < handle_px && rel_y < handle_px)
        || (rel_x >= win_w - handle_px && rel_y < handle_px)
        || (rel_x < handle_px && rel_y >= win_h - handle_px)
        || (rel_x >= win_w - handle_px && rel_y >= win_h - handle_px);

    let in_title = rel_y < title_h;
    let in_resize_edge = rel_x < edge_px || rel_x >= win_w - edge_px || rel_y >= win_h - edge_px;

    in_title || in_resize_edge || in_corner
}

fn should_apply_ignore_state(previous: Option<bool>, desired: bool) -> bool {
    previous != Some(desired)
}

pub async fn start_polling(app: AppHandle) {
    let mut last_ignore_state = None;
    loop {
        tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;

        let Some(win) = app.get_webview_window("capture") else {
            last_ignore_state = None;
            continue;
        };

        // Never flip interception while a drag/resize (or any press) is in
        // progress; the state present at button-down must persist until release.
        if mouse_button_down() {
            continue;
        }

        // Get current cursor position (physical pixels, virtual screen coords)
        let cursor_physical = match get_cursor_pos() {
            Some(p) => p,
            None => continue,
        };

        // CSS resize handles live in the WebView client area, so hit testing
        // must use the matching physical client origin and size.
        let Ok(pos) = win.inner_position() else {
            continue;
        };
        let Ok(size) = win.inner_size() else { continue };

        let scale = win.scale_factor().unwrap_or(1.0);
        let should_intercept = should_intercept_at(
            cursor_physical.0 - pos.x,
            cursor_physical.1 - pos.y,
            size.width as i32,
            size.height as i32,
            scale,
            ARM_MARGIN_PX,
        );

        // If in border → intercept (allow dragging/resizing/button clicks)
        // If in center → pass-through to game window below
        let ignore = !should_intercept;
        if should_apply_ignore_state(last_ignore_state, ignore)
            && win.set_ignore_cursor_events(ignore).is_ok()
        {
            last_ignore_state = Some(ignore);
        }
    }
}

#[cfg(windows)]
fn get_cursor_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut pt = POINT::default();
    let ok = unsafe { GetCursorPos(&mut pt) };
    if ok.is_ok() {
        Some((pt.x, pt.y))
    } else {
        None
    }
}

#[cfg(not(windows))]
fn get_cursor_pos() -> Option<(i32, i32)> {
    None
}

#[cfg(windows)]
fn mouse_button_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

    // VK_LBUTTON / VK_RBUTTON report the physical buttons regardless of the
    // primary-button swap setting; either one held means a gesture may be
    // in flight.
    unsafe {
        (GetAsyncKeyState(0x01) as u16 & 0x8000) != 0
            || (GetAsyncKeyState(0x02) as u16 & 0x8000) != 0
    }
}

#[cfg(not(windows))]
fn mouse_button_down() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::{should_apply_ignore_state, should_intercept_at, ARM_MARGIN_PX};
    use crate::services::overlay_metrics::{BORDER_PX, EDGE_PX, HANDLE_PX, TITLE_H};

    #[test]
    fn cursor_passthrough_uses_overlay_metrics_constants() {
        // Verify that the constants used by cursor_passthrough match the
        // single source of truth in overlay_metrics.
        assert_eq!(BORDER_PX, 6.0);
        assert_eq!(TITLE_H, 24.0);
        assert_eq!(HANDLE_PX, 16.0);
        assert_eq!(EDGE_PX, 8.0);
    }

    #[test]
    fn visible_edge_handle_is_fully_interactive() {
        assert!(should_intercept_at(7, 80, 200, 120, 1.0, 0.0));
        assert!(!should_intercept_at(8, 80, 200, 120, 1.0, 0.0));
    }

    #[test]
    fn corner_handles_are_anchored_to_window_corners() {
        assert!(should_intercept_at(15, 15, 200, 120, 1.0, 0.0));
        assert!(should_intercept_at(184, 104, 200, 120, 1.0, 0.0));
    }

    #[test]
    fn arm_margin_extends_interception_around_handles() {
        // Just inside the arming ring next to the west edge handle.
        assert!(should_intercept_at(19, 80, 200, 120, 1.0, ARM_MARGIN_PX));
        // The window center stays pass-through even with the margin applied.
        assert!(!should_intercept_at(100, 80, 200, 120, 1.0, ARM_MARGIN_PX));
    }

    #[test]
    fn arm_margin_covers_the_approach_from_outside_the_window() {
        // Slightly outside the south-east corner: interception pre-arms so a
        // fast click on the corner handle cannot fall through to the game.
        assert!(should_intercept_at(205, 125, 200, 120, 1.0, ARM_MARGIN_PX));
        // Far outside stays pass-through.
        assert!(!should_intercept_at(220, 140, 200, 120, 1.0, ARM_MARGIN_PX));
        assert!(!should_intercept_at(-20, 60, 200, 120, 1.0, ARM_MARGIN_PX));
    }

    #[test]
    fn strict_zone_rejects_coordinates_outside_the_client_area() {
        assert!(!should_intercept_at(-1, 50, 200, 120, 1.0, 0.0));
        assert!(!should_intercept_at(200, 50, 200, 120, 1.0, 0.0));
    }

    #[test]
    fn ignore_state_changes_are_applied_once() {
        assert!(should_apply_ignore_state(None, true));
        assert!(!should_apply_ignore_state(Some(true), true));
        assert!(should_apply_ignore_state(Some(true), false));
    }
}
