use tauri::{AppHandle, State};

use crate::services::{ocr_winrt, AppState};

/// Check if the WinRT OCR engine is available for a given BCP-47 language tag.
/// Returns true if the language pack is installed and OCR is supported.
#[tauri::command]
pub fn check_ocr_language(lang: String) -> bool {
    ocr_winrt::is_available_for(&lang)
}

/// Test the currently configured OCR engine against a small region.
/// Returns the recognized text, or an error string.
#[tauri::command]
pub async fn test_ocr_engine(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let cfg = state.config.lock().await.clone();

    use crate::services::screen_capture;
    let region = super::capture::compute_ocr_region(&app, &cfg.capture_region)?;

    let img = screen_capture::capture_region(region)
        .await
        .map_err(|e| format!("Capture failed: {e}"))?;

    let lang_tag = cfg
        .translation
        .source_lang
        .validate_for_ocr()
        .map_err(|e| format!("Invalid source language: {e}"))?;

    if !ocr_winrt::is_available_for(lang_tag) {
        return Err(format!(
            "Windows Native OCR is not available for language '{lang_tag}'. \
             Please install the corresponding Windows language pack."
        ));
    }

    let result = ocr_winrt::recognize(&img, lang_tag)
        .await
        .map_err(|e| format!("WinRT OCR error: {e}"))?;

    if result.is_empty() {
        Ok("(No text detected in capture region)".to_string())
    } else {
        Ok(result.text)
    }
}
