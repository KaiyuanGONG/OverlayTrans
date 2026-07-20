/// Shared overlay geometry constants — single source of truth.
///
/// These logical-pixel values define the capture overlay's border, title bar,
/// and resize handle dimensions. They are used by:
///   - `cursor_passthrough.rs` (mouse interception zone)
///   - `commands/capture.rs` (OCR crop geometry fallback)
///   - The frontend `CaptureOverlay.tsx` (via `get_overlay_metrics` command)
///
/// Changing these values here automatically keeps all three in sync.
///
/// Border width in logical pixels.
pub const BORDER_PX: f64 = 6.0;

/// Title bar height in logical pixels.
pub const TITLE_H: f64 = 24.0;

/// Corner handle size in logical pixels (square).
/// Handles are anchored at the window corners, overlapping the border area.
pub const HANDLE_PX: f64 = 16.0;

/// Edge handle thickness in logical pixels (for non-corner edge resize).
pub const EDGE_PX: f64 = 8.0;

/// DTO returned by the `get_overlay_metrics` command.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OverlayMetrics {
    pub border_px: f64,
    pub title_h: f64,
    pub handle_px: f64,
    pub edge_px: f64,
}

/// Tauri command: return overlay metrics to the frontend.
#[tauri::command]
pub fn get_overlay_metrics() -> OverlayMetrics {
    OverlayMetrics {
        border_px: BORDER_PX,
        title_h: TITLE_H,
        handle_px: HANDLE_PX,
        edge_px: EDGE_PX,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metrics_command_returns_correct_values() {
        let m = get_overlay_metrics();
        assert_eq!(m.border_px, 6.0);
        assert_eq!(m.title_h, 24.0);
        assert_eq!(m.handle_px, 16.0);
        assert_eq!(m.edge_px, 8.0);
    }

    #[test]
    fn constants_are_consistent_with_command() {
        let m = get_overlay_metrics();
        assert_eq!(m.border_px, BORDER_PX);
        assert_eq!(m.title_h, TITLE_H);
        assert_eq!(m.handle_px, HANDLE_PX);
        assert_eq!(m.edge_px, EDGE_PX);
    }
}
