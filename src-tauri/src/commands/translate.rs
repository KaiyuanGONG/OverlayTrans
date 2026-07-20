use serde::Serialize;
use tauri::State;

use crate::models::config::{ApiConfig, SourceLang};
use crate::services::{translate_online::OnlineTranslator, AppState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ApiTestKind {
    Text,
    Vision,
}

#[derive(Debug, Serialize)]
pub struct ApiTestResult {
    pub provider: String,
    pub model: String,
    pub test_type: String,
    pub latency_ms: u64,
    pub output: String,
}

fn validate_explicit_api_config(config: &ApiConfig, kind: ApiTestKind) -> Result<(), String> {
    if config.api_key.trim().is_empty() {
        return Err("API Key 为空；请先在当前页面输入密钥。".to_string());
    }
    if config.effective_base_url().trim().is_empty() {
        return Err("API endpoint 为空。".to_string());
    }
    match kind {
        ApiTestKind::Text if config.effective_text_model().trim().is_empty() => {
            Err("文本模型为空。".to_string())
        }
        ApiTestKind::Vision if !config.supports_vision() => {
            Err(format!("{} 不支持质量模式（VLM）。", config.provider))
        }
        ApiTestKind::Vision if config.effective_vlm_model().trim().is_empty() => {
            Err("VLM 模型为空。".to_string())
        }
        _ => Ok(()),
    }
}

fn resolve_test_api(api: &ApiConfig, kind: ApiTestKind) -> ApiConfig {
    match kind {
        ApiTestKind::Text => api.clone(),
        ApiTestKind::Vision => api.resolved_vision_profile().to_api_config(),
    }
}

fn synthetic_vlm_png() -> anyhow::Result<Vec<u8>> {
    const GLYPHS: [[u8; 7]; 5] = [
        [
            0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ], // H
        [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111,
        ], // E
        [
            0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111,
        ], // L
        [
            0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111,
        ], // L
        [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ], // O
    ];
    let mut image = image::RgbaImage::from_pixel(160, 64, image::Rgba([248, 250, 252, 255]));
    let scale = 5u32;
    let mut origin_x = 10u32;
    for glyph in GLYPHS {
        for (row, bits) in glyph.into_iter().enumerate() {
            for column in 0..5u32 {
                if bits & (1 << (4 - column)) != 0 {
                    for y in 0..scale {
                        for x in 0..scale {
                            image.put_pixel(
                                origin_x + column * scale + x,
                                10 + row as u32 * scale + y,
                                image::Rgba([15, 23, 42, 255]),
                            );
                        }
                    }
                }
            }
        }
        origin_x += 6 * scale;
    }

    let mut png = Vec::new();
    use image::{codecs::png::PngEncoder, ColorType, ImageEncoder};
    PngEncoder::new(&mut png).write_image(image.as_raw(), 160, 64, ColorType::Rgba8)?;
    Ok(png)
}

#[tauri::command]
pub async fn test_api_text(
    state: State<'_, AppState>,
    api: ApiConfig,
) -> Result<ApiTestResult, String> {
    let api = resolve_test_api(&api, ApiTestKind::Text);
    validate_explicit_api_config(&api, ApiTestKind::Text)?;
    let translation = state.config.lock().await.translation.clone();
    let test_text = match translation.source_lang {
        SourceLang::Ja => "こんにちは、お元気ですか？",
        SourceLang::Zh => "你好，最近怎么样？",
        SourceLang::En | SourceLang::Auto => "Hello, how are you?",
    };
    let model = api.effective_text_model();
    let provider = api.provider.to_string();
    let translator = OnlineTranslator::new();
    let (output, latency_ms) = translator
        .translate(test_text, &[], &api, &translation.target_lang)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ApiTestResult {
        provider,
        model,
        test_type: "text".to_string(),
        latency_ms,
        output,
    })
}

#[tauri::command]
pub async fn test_api_vlm(
    state: State<'_, AppState>,
    api: ApiConfig,
) -> Result<ApiTestResult, String> {
    let api = resolve_test_api(&api, ApiTestKind::Vision);
    validate_explicit_api_config(&api, ApiTestKind::Vision)?;
    let target_lang = state.config.lock().await.translation.target_lang.clone();
    let model = api.effective_vlm_model();
    let provider = api.provider.to_string();
    let png = synthetic_vlm_png().map_err(|e| e.to_string())?;
    let translator = OnlineTranslator::new();
    let (output, latency_ms) = translator
        .translate_vlm_uncached(&png, &[], &api, &target_lang)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ApiTestResult {
        provider,
        model,
        test_type: "vlm".to_string(),
        latency_ms,
        output,
    })
}

#[cfg(test)]
mod tests {
    use super::{resolve_test_api, synthetic_vlm_png, validate_explicit_api_config, ApiTestKind};
    use crate::models::config::{ApiConfig, RemoteProviderId, VisionProfileMode};

    #[test]
    fn explicit_api_test_rejects_empty_visible_key() {
        let config = ApiConfig::default();
        assert!(validate_explicit_api_config(&config, ApiTestKind::Text).is_err());
    }

    #[test]
    fn vlm_test_rejects_non_visual_provider_before_network() {
        let config = ApiConfig {
            api_key: "visible-key".to_string(),
            provider: RemoteProviderId::DeepSeek,
            ..ApiConfig::default()
        };
        assert!(validate_explicit_api_config(&config, ApiTestKind::Vision).is_err());
    }

    #[test]
    fn synthetic_vlm_image_is_valid_png_with_visible_content() {
        let png = synthetic_vlm_png().unwrap();
        let decoded = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(decoded.dimensions(), (160, 64));
        assert!(decoded.pixels().any(|pixel| pixel.0[0] < 32));
    }

    #[test]
    fn image_test_uses_independent_key_and_provider() {
        let mut api = ApiConfig::default();
        api.api_key.clear();
        api.vision.mode = VisionProfileMode::Separate;
        api.vision.provider = RemoteProviderId::Qwen;
        api.vision.api_key = "vision-secret".to_string();
        let resolved = resolve_test_api(&api, ApiTestKind::Vision);
        assert_eq!(resolved.provider, RemoteProviderId::Qwen);
        assert_eq!(resolved.api_key, "vision-secret");
        assert!(validate_explicit_api_config(&resolved, ApiTestKind::Vision).is_ok());
    }

    #[test]
    fn text_test_never_uses_independent_image_key() {
        let mut api = ApiConfig::default();
        api.api_key.clear();
        api.vision.api_key = "vision-secret".to_string();
        let resolved = resolve_test_api(&api, ApiTestKind::Text);
        assert!(validate_explicit_api_config(&resolved, ApiTestKind::Text).is_err());
    }
}
