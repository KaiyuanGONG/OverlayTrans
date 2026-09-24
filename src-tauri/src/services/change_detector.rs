/// Perceptual hash-based change detection.
///
/// Uses an 8×8 DoubleGradient image hash (img_hash) to compare consecutive frames.
/// Only triggers OCR/translation when the screen content meaningfully changes.
use image::RgbaImage;
use img_hash::{HasherConfig, ImageHash};

/// Returns true if the image is significantly different from the cached hash.
///
/// `threshold` is the maximum Hamming distance to consider "same" (typically 4).
pub fn has_changed(img: &RgbaImage, last_hash: &mut Option<ImageHash>, threshold: u32) -> bool {
    let hasher = HasherConfig::new()
        .hash_alg(img_hash::HashAlg::DoubleGradient)
        .hash_size(8, 8)
        .to_hasher();

    let current = hasher.hash_image(img);

    match last_hash.take() {
        None => {
            // First frame — always "changed"
            *last_hash = Some(current);
            true
        }
        Some(prev) => {
            let dist = prev.dist(&current);
            *last_hash = Some(current);
            dist > threshold
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_images_not_changed() {
        let img = RgbaImage::from_pixel(64, 64, image::Rgba([128, 64, 32, 255]));
        let mut last = None;
        assert!(has_changed(&img, &mut last, 4)); // first call always true
        assert!(!has_changed(&img, &mut last, 4)); // same image → not changed
    }

    #[test]
    fn clearly_different_images_are_changed() {
        let img_a = RgbaImage::from_pixel(64, 64, image::Rgba([0, 0, 0, 255]));
        let mut img_b = img_a.clone();
        for y in 24..40 {
            for x in 24..40 {
                img_b.put_pixel(x, y, image::Rgba([255, 255, 255, 255]));
            }
        }
        let mut last = None;
        assert!(has_changed(&img_a, &mut last, 4));
        assert!(has_changed(&img_b, &mut last, 0));
    }
}
