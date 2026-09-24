/// Screen capture service.
///
/// Uses GDI BitBlt (reliable and simple). Windows Graphics Capture could
/// handle some hardware-accelerated windows better; it is not implemented.
use anyhow::{Context, Result};
use image::RgbaImage;

use crate::utils::image_processing::LogicalRect;

/// Capture a region of the screen and return it as an RGBA image.
/// `region` is treated as physical desktop pixels.
pub async fn capture_region(region: LogicalRect) -> Result<RgbaImage> {
    tokio::task::spawn_blocking(move || capture_gdi(region))
        .await
        .context("spawn_blocking panicked")?
}

#[cfg(windows)]
fn capture_gdi(region: LogicalRect) -> Result<RgbaImage> {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetDesktopWindow;

    // Coordinates are already physical desktop pixels.
    let phys_x = region.x;
    let phys_y = region.y;
    let phys_w = region.width as i32;
    let phys_h = region.height as i32;

    if phys_w <= 0 || phys_h <= 0 {
        anyhow::bail!("Capture region has zero size");
    }

    unsafe {
        let hwnd = GetDesktopWindow();
        let src_dc = GetDC(hwnd);
        let mem_dc = CreateCompatibleDC(src_dc);
        let bitmap = CreateCompatibleBitmap(src_dc, phys_w, phys_h);
        let old_bmp = SelectObject(mem_dc, bitmap);

        // Copy from screen into our in-memory bitmap
        BitBlt(
            mem_dc, 0, 0, phys_w, phys_h, src_dc, phys_x, phys_y, SRCCOPY,
        )
        .context("BitBlt failed")?;

        // Prepare to read pixel data (BGRA top-down DIB)
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: phys_w,
                biHeight: -phys_h, // negative = top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0, // BI_RGB
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default()],
        };

        let mut pixels = vec![0u8; (phys_w * phys_h * 4) as usize];
        windows::Win32::Graphics::Gdi::GetDIBits(
            mem_dc,
            bitmap,
            0,
            phys_h as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &bmi as *const _ as *mut _,
            DIB_RGB_COLORS,
        );

        // Cleanup
        SelectObject(mem_dc, old_bmp);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(mem_dc);
        ReleaseDC(hwnd, src_dc);

        // GDI gives us BGRA — swap B and R for RGBA
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2); // B ↔ R
        }

        RgbaImage::from_raw(phys_w as u32, phys_h as u32, pixels)
            .context("Failed to create RgbaImage from GDI pixels")
    }
}

#[cfg(not(windows))]
fn capture_gdi(_region: LogicalRect) -> Result<RgbaImage> {
    anyhow::bail!("Screen capture is only available on Windows")
}
