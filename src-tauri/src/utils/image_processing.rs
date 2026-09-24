//! Capture geometry shared by the capture command and the GDI capture service.

/// Screen rectangle of a capture. Despite the historical name, the values are
/// physical desktop pixels: the capture command converts window geometry
/// (and the measured overlay insets) before calling the capture service.
#[derive(Debug, Clone, Copy)]
pub struct LogicalRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
