/// Image pre-processing utilities for OCR.
use image::{DynamicImage, GenericImageView, GrayImage, RgbaImage};

/// Convert RGBA image to grayscale.
#[allow(dead_code)]
pub fn to_grayscale(img: &RgbaImage) -> GrayImage {
    DynamicImage::ImageRgba8(img.clone()).to_luma8()
}

/// Adaptive binarization (Otsu's method).
/// Returns a black-and-white image where pixels at or above threshold are white.
#[allow(dead_code)]
pub fn binarize_otsu(gray: &GrayImage) -> GrayImage {
    let threshold_val = otsu_threshold(gray);
    let mut result = gray.clone();
    for pixel in result.pixels_mut() {
        pixel.0[0] = if pixel.0[0] >= threshold_val { 255 } else { 0 };
    }
    result
}

#[allow(dead_code)]
fn otsu_threshold(img: &GrayImage) -> u8 {
    let mut histogram = [0u64; 256];
    for p in img.pixels() {
        histogram[p.0[0] as usize] += 1;
    }

    let total = img.width() as f64 * img.height() as f64;
    let mut sum_bg: f64 = 0.0;
    let mut weight_bg: f64 = 0.0;
    let total_sum: f64 = histogram
        .iter()
        .enumerate()
        .map(|(i, &h)| i as f64 * h as f64)
        .sum();

    let mut best_variance: f64 = 0.0;
    let mut best_threshold: u8 = 0;

    for (t, &h) in histogram.iter().enumerate() {
        weight_bg += h as f64;
        if weight_bg == 0.0 {
            continue;
        }
        let weight_fg = total - weight_bg;
        if weight_fg == 0.0 {
            break;
        }
        sum_bg += t as f64 * h as f64;
        let mean_bg = sum_bg / weight_bg;
        let mean_fg = (total_sum - sum_bg) / weight_fg;
        let between = weight_bg * weight_fg * (mean_bg - mean_fg) * (mean_bg - mean_fg);
        if between > best_variance {
            best_variance = between;
            best_threshold = t as u8;
        }
    }

    best_threshold
}

/// Scale image to a target width while preserving aspect ratio.
#[allow(dead_code)]
pub fn scale_to_width(img: &DynamicImage, target_width: u32) -> DynamicImage {
    let w = img.width();
    if w == 0 || w == target_width {
        return img.clone();
    }
    let h = (img.height() as f64 * target_width as f64 / w as f64) as u32;
    img.resize_exact(target_width, h, image::imageops::FilterType::Lanczos3)
}

/// Logical-to-physical pixel coordinate conversion for DPI-aware capture.
#[derive(Debug, Clone, Copy)]
pub struct LogicalRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub struct PhysicalRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[allow(dead_code)]
pub fn logical_to_physical(logical: LogicalRect, scale_factor: f64) -> PhysicalRect {
    PhysicalRect {
        x: (logical.x as f64 * scale_factor) as i32,
        y: (logical.y as f64 * scale_factor) as i32,
        width: (logical.width as f64 * scale_factor) as u32,
        height: (logical.height as f64 * scale_factor) as u32,
    }
}
