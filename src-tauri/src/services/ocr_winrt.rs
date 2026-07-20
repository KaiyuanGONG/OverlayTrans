/// Windows Native OCR via WinRT Windows.Media.Ocr.OcrEngine.
///
/// Advantages:
/// - Zero additional download (uses system-built-in engine)
/// - Very fast: typically < 100ms on modern hardware
///
/// Supported languages (requires corresponding Windows language pack):
/// - English  ("en-US")
/// - Japanese ("ja-JP")
/// - Simplified Chinese ("zh-Hans")
///
/// Limitations:
/// - Requires the relevant language pack installed
/// - Struggles with artistic/styled fonts (Galgame art fonts)
use anyhow::{Context, Result};
use image::RgbaImage;
use std::time::Instant;

use crate::models::ocr_result::OcrResult;

/// Recognize text in the given image using the WinRT OCR engine for `lang_tag`.
/// `lang_tag` is a BCP-47 tag e.g. `"en-US"`, `"ja-JP"`, `"zh-Hans"`.
pub async fn recognize(img: &RgbaImage, lang_tag: &str) -> Result<OcrResult> {
    let img = img.clone();
    let lang_tag = lang_tag.to_string();
    tokio::task::spawn_blocking(move || recognize_sync(&img, &lang_tag))
        .await
        .context("spawn_blocking panicked in ocr_winrt::recognize")?
}

/// Check if the WinRT OCR engine is available for the given BCP-47 language tag.
#[cfg(windows)]
pub fn is_available_for(lang_tag: &str) -> bool {
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Media::Ocr::OcrEngine;

    let Ok(lang) = Language::CreateLanguage(&HSTRING::from(lang_tag)) else {
        return false;
    };
    OcrEngine::IsLanguageSupported(&lang).unwrap_or(false)
}

#[cfg(not(windows))]
pub fn is_available_for(_lang_tag: &str) -> bool {
    false
}

#[cfg(windows)]
fn recognize_sync(img: &RgbaImage, lang_tag: &str) -> Result<OcrResult> {
    use image::{codecs::png::PngEncoder, ImageEncoder};
    use windows::{
        core::HSTRING,
        Globalization::Language,
        Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap},
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };

    let start = Instant::now();

    // PNG-encode the captured frame into memory — avoids all disk I/O.
    let mut png_bytes: Vec<u8> = Vec::new();
    PngEncoder::new(&mut png_bytes)
        .write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ColorType::Rgba8,
        )
        .context("Failed to PNG-encode image for WinRT OCR")?;

    // Feed PNG bytes into a WinRT in-memory stream.
    let stream = InMemoryRandomAccessStream::new()?;
    {
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(&png_bytes)?;
        writer.StoreAsync()?.get()?;
        let _ = writer.DetachStream();
    }
    stream.Seek(0)?;

    // Decode SoftwareBitmap from the in-memory stream.
    let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
    let bitmap = decoder.GetSoftwareBitmapAsync()?.get()?;

    // WinRT OCR requires Bgra8 pixel format.
    let bitmap = if bitmap.BitmapPixelFormat()? != BitmapPixelFormat::Bgra8 {
        SoftwareBitmap::Convert(&bitmap, BitmapPixelFormat::Bgra8)?
    } else {
        bitmap
    };

    // Run OCR recognition with the requested language.
    let lang = Language::CreateLanguage(&HSTRING::from(lang_tag))?;
    let engine = OcrEngine::TryCreateFromLanguage(&lang)
        .context("Failed to create WinRT OCR engine — language pack may not be installed")?;
    let ocr_result = engine.RecognizeAsync(&bitmap)?.get()?;
    let text = crate::utils::text::normalize_ocr_spacing(&ocr_result.Text()?.to_string());

    let latency_ms = start.elapsed().as_millis() as u64;

    Ok(OcrResult {
        text,
        confidences: Vec::new(), // WinRT doesn't expose per-word confidence
        boxes: Vec::new(),
        engine: format!("winrt-{lang_tag}"),
        latency_ms,
    })
}

#[cfg(not(windows))]
fn recognize_sync(_img: &RgbaImage, _lang_tag: &str) -> Result<OcrResult> {
    anyhow::bail!("WinRT OCR is only available on Windows")
}
