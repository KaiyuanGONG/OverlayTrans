use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use crate::models::config::{AppConfig, RemoteProviderId, TranslationMode, TriggerMode};
use crate::models::translation::StatusPayload;
use crate::services::{emit_config_updated, AppState};

#[derive(Debug, Clone, Deserialize)]
pub struct WindowRegionUpdate {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Measured physical-pixel insets from frontend [left, top, right, bottom].
    /// Used for precise OCR cropping; eliminates DPI rounding errors.
    #[serde(default)]
    pub measured_insets: Option<[i32; 4]>,
}

/// Serializable preset for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct PresetInfo {
    pub id: String,
    pub label: String,
    pub base_url: String,
    pub text_models: Vec<String>,
    pub vlm_models: Vec<String>,
    pub default_text_model: String,
    pub default_vlm_model: String,
    pub supports_vision: bool,
    pub qwen_international_base_url: Option<String>,
}

fn emit_generation_reset(app: &tauri::AppHandle, generation: crate::services::Generation) {
    let _ = app.emit(
        "translation-status",
        StatusPayload {
            status: "idle".to_string(),
            generation,
        },
    );
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.lock().await.clone())
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeyScope {
    Text,
    Vision,
}

fn clear_api_key_in_config(config: &mut AppConfig, scope: KeyScope) {
    match scope {
        KeyScope::Text => config.api.api_key.clear(),
        KeyScope::Vision => config.api.vision.api_key.clear(),
    }
}

fn clear_reused_key_on_provider_change(old: &AppConfig, new: &mut AppConfig) {
    if old.api.provider != new.api.provider && old.api.api_key == new.api.api_key {
        new.api.api_key.clear();
    }
    if old.api.vision.provider != new.api.vision.provider
        && old.api.vision.api_key == new.api.vision.api_key
    {
        new.api.vision.api_key.clear();
    }
}

fn build_reset_config(current: &AppConfig) -> AppConfig {
    // A key has no safe meaning without its provider and endpoint. Preserve the
    // complete remote API profile so reset can never route a Qwen/Gemini key to
    // the default DeepSeek endpoint.
    AppConfig {
        api: current.api.clone(),
        onboarding_completed: current.onboarding_completed,
        onboarding_revision: current.onboarding_revision,
        ..AppConfig::default()
    }
}

#[tauri::command]
pub async fn clear_api_key(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    scope: KeyScope,
) -> Result<u64, String> {
    let _update_guard = state.config_update_mutex.lock().await;
    let snapshot = {
        let config = state.config.lock().await;
        let mut updated = config.clone();
        clear_api_key_in_config(&mut updated, scope);
        updated
    };
    state
        .save_config_snapshot(&snapshot)
        .await
        .map_err(|e| format!("Failed to save config: {e}"))?;
    *state.config.lock().await = snapshot.clone();
    let generation = state.next_generation();
    state.clear_translation_state().await;
    emit_generation_reset(&app, generation);
    Ok(emit_config_updated(&app, &state, &snapshot))
}

/// Detect if the new config has semantic changes vs the old one.
fn has_semantic_changes(old: &AppConfig, new: &AppConfig) -> bool {
    let old_vision = old.api.resolved_vision_profile();
    let new_vision = new.api.resolved_vision_profile();
    old.translation.mode != new.translation.mode
        || old.translation.source_lang != new.translation.source_lang
        || old.translation.target_lang != new.translation.target_lang
        || old.api.provider != new.api.provider
        || old.api.effective_base_url() != new.api.effective_base_url()
        || old.api.effective_text_model() != new.api.effective_text_model()
        || old.api.vision.mode != new.api.vision.mode
        || old_vision.semantic_key() != new_vision.semantic_key()
        || old.local != new.local
        || old.translation.context_size != new.translation.context_size
}

#[tauri::command]
pub async fn set_config(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    mut config: AppConfig,
) -> Result<u64, String> {
    let _update_guard = state.config_update_mutex.lock().await;
    {
        let current = state.config.lock().await;
        clear_reused_key_on_provider_change(&current, &mut config);
    }
    // Validate mode — reject unimplemented modes
    crate::models::config::validate_mode(&config.translation.mode)?;

    // Snapshot old config for comparison (lock released after this block)
    let (old_hotkey, old_mode, old_interval_ms, old_translation_mode, old_local, semantic_changed) = {
        let cfg = state.config.lock().await;
        let sem = has_semantic_changes(&cfg, &config);
        (
            cfg.trigger.hotkey.clone(),
            cfg.trigger.mode.clone(),
            cfg.trigger.auto_interval_ms,
            cfg.translation.mode.clone(),
            cfg.local.clone(),
            sem,
        )
    };

    let new_mode = config.trigger.mode.clone();
    let new_interval_ms = config.trigger.auto_interval_ms;
    let new_hotkey = config.trigger.hotkey.clone();
    let new_translation_mode = config.translation.mode.clone();
    let new_local = config.local.clone();

    // Atomic: save snapshot FIRST (no lock held), then write to memory.
    // If save fails, both memory and external runtime state remain unchanged.
    if let Err(e) = state.save_config_snapshot(&config).await {
        return Err(format!("Failed to save config: {e}"));
    }

    // Now write to memory (save succeeded)
    {
        let mut cfg_lock = state.config.lock().await;
        *cfg_lock = config;
    }

    // A bundled process belongs to the exact Local configuration that started
    // it. Leaving Local mode or changing backend/model/endpoint must stop it.
    if (old_translation_mode == TranslationMode::Local
        && new_translation_mode != TranslationMode::Local)
        || old_local != new_local
    {
        let runtime = state.local_runtime.read().await;
        runtime.stop(&app).await;
    }

    if new_hotkey != old_hotkey {
        crate::services::hotkey::register_hotkey(&app, &new_hotkey);
    }

    // Clear translation state + bump generation on semantic change
    if semantic_changed {
        let generation = state.next_generation();
        state.clear_translation_state().await;
        emit_generation_reset(&app, generation);
    }

    // Trigger mode change — reject Auto for unimplemented modes
    if new_mode != old_mode {
        match new_mode {
            TriggerMode::Auto => {
                // Reject auto mode when translation mode is not implemented
                let current_mode = state.config.lock().await.translation.mode.clone();
                crate::models::config::validate_mode(&current_mode)?;
                super::capture::start_auto_mode_internal(&app, &state).await?;
            }
            TriggerMode::Manual => {
                super::capture::stop_auto_mode_internal(&app, &state).await?;
            }
        }
    } else if matches!(new_mode, TriggerMode::Auto) && new_interval_ms != old_interval_ms {
        state.auto_mode_notify.notify_one();
    }

    let updated = state.config.lock().await.clone();
    Ok(emit_config_updated(&app, &state, &updated))
}

#[tauri::command]
pub async fn reset_config(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    let _update_guard = state.config_update_mutex.lock().await;
    let reset = {
        let current = state.config.lock().await;
        build_reset_config(&current)
    };
    let hotkey = reset.trigger.hotkey.clone();

    // Save first (no lock held), then write to memory
    if let Err(e) = state.save_config_snapshot(&reset).await {
        return Err(format!("Failed to save config: {e}"));
    }
    {
        let mut cfg_lock = state.config.lock().await;
        *cfg_lock = reset;
    }

    // Reset returns to Speed mode and must not leave a bundled child running.
    {
        let runtime = state.local_runtime.read().await;
        runtime.stop(&app).await;
    }

    // Reset always clears state + bumps generation
    let generation = state.next_generation();
    state.clear_translation_state().await;
    emit_generation_reset(&app, generation);

    crate::services::hotkey::register_hotkey(&app, &hotkey);
    super::capture::stop_auto_mode_internal(&app, &state).await?;
    let updated = state.config.lock().await.clone();
    Ok(emit_config_updated(&app, &state, &updated))
}

fn apply_capture_region_update(cfg: &mut AppConfig, region: WindowRegionUpdate) {
    cfg.capture_region.x = region.x;
    cfg.capture_region.y = region.y;
    cfg.capture_region.width = region.width;
    cfg.capture_region.height = region.height;
    cfg.capture_region.measured_insets = region.measured_insets;
}

#[tauri::command]
pub async fn set_capture_region(
    state: State<'_, AppState>,
    region: WindowRegionUpdate,
) -> Result<(), String> {
    let _update_guard = state.config_update_mutex.lock().await;
    {
        let mut cfg = state.config.lock().await;
        apply_capture_region_update(&mut cfg, region);
    }
    state.save_config().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_display_region(
    state: State<'_, AppState>,
    region: WindowRegionUpdate,
) -> Result<(), String> {
    let _update_guard = state.config_update_mutex.lock().await;
    {
        let mut cfg = state.config.lock().await;
        cfg.display.x = region.x;
        cfg.display.y = region.y;
        cfg.display.width = region.width;
        cfg.display.height = region.height;
    }
    state.save_config().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_onboarding_completed(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    completed: bool,
) -> Result<(), String> {
    let _update_guard = state.config_update_mutex.lock().await;
    {
        let mut cfg = state.config.lock().await;
        if completed {
            crate::models::config::mark_onboarding_completed(&mut cfg);
        } else {
            cfg.onboarding_completed = false;
        }
    }
    state.save_config().await.map_err(|e| e.to_string())?;
    let updated = state.config.lock().await.clone();
    emit_config_updated(&app, &state, &updated);
    Ok(())
}

/// Get all provider presets for the frontend.
/// Uses serde wire name for the `id` field (e.g. "deepseek", "openai").
#[tauri::command]
pub async fn get_presets() -> Result<Vec<PresetInfo>, String> {
    Ok(RemoteProviderId::all_presets()
        .iter()
        .map(|p| {
            let id = serde_json::to_value(&p.id)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            PresetInfo {
                id,
                label: p.label.to_string(),
                base_url: p.base_url.to_string(),
                text_models: p.text_models.iter().map(|s| s.to_string()).collect(),
                vlm_models: p.vlm_models.iter().map(|s| s.to_string()).collect(),
                default_text_model: p.default_text_model.to_string(),
                default_vlm_model: p.default_vlm_model.to_string(),
                supports_vision: p.supports_vision,
                qwen_international_base_url: p.qwen_international_base_url.map(String::from),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn apply_startup_mode(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let (trigger_mode, trans_mode) = {
        let cfg = state.config.lock().await;
        (cfg.trigger.mode.clone(), cfg.translation.mode.clone())
    };
    match trigger_mode {
        TriggerMode::Auto => {
            // Reject auto if translation mode not implemented
            crate::models::config::validate_mode(&trans_mode)?;
            super::capture::start_auto_mode_internal(&app, &state).await?;
            Ok(true)
        }
        TriggerMode::Manual => {
            super::capture::stop_auto_mode_internal(&app, &state).await?;
            Ok(false)
        }
    }
}

#[tauri::command]
pub async fn set_trigger_mode(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    mode: String,
) -> Result<(), String> {
    let _update_guard = state.config_update_mutex.lock().await;
    let trigger_mode = match mode.as_str() {
        "manual" => TriggerMode::Manual,
        "auto" => TriggerMode::Auto,
        other => return Err(format!("Invalid trigger mode: {other}")),
    };

    let mut updated = state.config.lock().await.clone();
    if matches!(trigger_mode, TriggerMode::Auto) {
        crate::models::config::validate_mode(&updated.translation.mode)?;
    }
    updated.trigger.mode = trigger_mode.clone();
    state
        .save_config_snapshot(&updated)
        .await
        .map_err(|e| e.to_string())?;
    *state.config.lock().await = updated;

    match trigger_mode {
        TriggerMode::Auto => {
            super::capture::start_auto_mode_internal(&app, &state).await?;
        }
        TriggerMode::Manual => {
            super::capture::stop_auto_mode_internal(&app, &state).await?;
        }
    }

    let updated = state.config.lock().await.clone();
    emit_config_updated(&app, &state, &updated);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_capture_region_update, build_reset_config, clear_api_key_in_config,
        clear_reused_key_on_provider_change, get_presets, has_semantic_changes, KeyScope,
        WindowRegionUpdate,
    };
    use crate::models::config::{AppConfig, LocalModel, RemoteProviderId, VisionProfileMode};

    #[tokio::test]
    async fn preset_dto_exposes_canonical_ids_capability_and_qwen_regions() {
        let presets = get_presets().await.unwrap();
        assert!(presets.iter().all(|preset| !preset.id.contains('_')));

        let qwen = presets
            .iter()
            .find(|preset| preset.id == "qwen")
            .expect("Qwen preset");
        assert!(qwen.supports_vision);
        assert_eq!(
            qwen.qwen_international_base_url.as_deref(),
            Some("https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
        );

        let deepseek = presets
            .iter()
            .find(|preset| preset.id == "deepseek")
            .expect("DeepSeek preset");
        assert!(!deepseek.supports_vision);
    }

    #[test]
    fn vlm_and_local_model_changes_are_semantic() {
        let original = AppConfig::default();

        let mut changed = original.clone();
        changed.api.vlm_model = "vision-model".to_string();
        assert!(has_semantic_changes(&original, &changed));

        let mut changed = original.clone();
        changed.local.model = LocalModel::Qwen3_8B;
        assert!(has_semantic_changes(&original, &changed));
    }

    #[test]
    fn theme_change_does_not_trigger_semantic_change() {
        // Theme is a UI preference; changing it must NOT advance
        // generation or clear caches.
        use crate::models::config::ThemeMode;

        let mut old = AppConfig::default();
        let mut new_cfg = AppConfig::default();

        old.ui.theme = ThemeMode::Light;
        new_cfg.ui.theme = ThemeMode::Dark;

        assert!(
            !has_semantic_changes(&old, &new_cfg),
            "Theme change must not be semantic"
        );
    }

    #[test]
    fn clearing_measured_insets_restores_formula_fallback() {
        let mut cfg = AppConfig::default();
        cfg.capture_region.measured_insets = Some([6, 24, 6, 6]);

        apply_capture_region_update(
            &mut cfg,
            WindowRegionUpdate {
                x: 10,
                y: 20,
                width: 640,
                height: 160,
                measured_insets: None,
            },
        );

        assert_eq!(cfg.capture_region.measured_insets, None);
    }

    #[test]
    fn clearing_api_key_does_not_change_provider_or_models() {
        let mut config = AppConfig::default();
        config.api.api_key = "secret".to_string();
        let provider = config.api.provider.clone();
        let text_model = config.api.text_model.clone();
        clear_api_key_in_config(&mut config, KeyScope::Text);
        assert!(config.api.api_key.is_empty());
        assert_eq!(config.api.provider, provider);
        assert_eq!(config.api.text_model, text_model);
    }

    #[test]
    fn provider_change_cannot_reuse_the_previous_provider_key() {
        let mut old = AppConfig::default();
        old.api.api_key = "deepseek-secret".to_string();
        let mut reused = old.clone();
        reused.api.provider = crate::models::config::RemoteProviderId::Qwen;
        clear_reused_key_on_provider_change(&old, &mut reused);
        assert!(reused.api.api_key.is_empty());

        let mut newly_entered = old.clone();
        newly_entered.api.provider = crate::models::config::RemoteProviderId::Gemini;
        newly_entered.api.api_key = "new-gemini-secret".to_string();
        clear_reused_key_on_provider_change(&old, &mut newly_entered);
        assert_eq!(newly_entered.api.api_key, "new-gemini-secret");
    }

    #[test]
    fn scoped_key_clear_never_clears_the_other_profile() {
        let mut cfg = AppConfig::default();
        cfg.api.api_key = "text-secret".to_string();
        cfg.api.vision.api_key = "vision-secret".to_string();
        clear_api_key_in_config(&mut cfg, KeyScope::Vision);
        assert_eq!(cfg.api.api_key, "text-secret");
        assert!(cfg.api.vision.api_key.is_empty());
    }

    #[test]
    fn image_provider_change_cannot_reuse_previous_image_key() {
        let mut old = AppConfig::default();
        old.api.vision.mode = VisionProfileMode::Separate;
        old.api.vision.api_key = "qwen-secret".to_string();
        let mut next = old.clone();
        next.api.vision.provider = RemoteProviderId::Gemini;
        clear_reused_key_on_provider_change(&old, &mut next);
        assert!(next.api.vision.api_key.is_empty());
        assert_eq!(next.api.api_key, old.api.api_key);
    }

    #[test]
    fn resolved_image_profile_changes_are_semantic() {
        let old = AppConfig::default();
        let mut next = old.clone();
        next.api.vision.mode = VisionProfileMode::Separate;
        next.api.vision.provider = old.api.provider.clone();
        next.api.vision.qwen_region = old.api.qwen_region.clone();
        next.api.vision.model = old.api.effective_vlm_model();
        assert!(has_semantic_changes(&old, &next));

        let mut changed_model = next.clone();
        changed_model.api.vision.model = "qwen3.7-plus".to_string();
        assert!(has_semantic_changes(&next, &changed_model));
    }

    #[test]
    fn reset_preserves_complete_api_profile_instead_of_retargeting_key() {
        for provider in [
            crate::models::config::RemoteProviderId::Qwen,
            crate::models::config::RemoteProviderId::Gemini,
        ] {
            let mut current = AppConfig::default();
            current.api.provider = provider.clone();
            current.api.qwen_region = Some(crate::models::config::QwenRegion::International);
            current.api.base_url = "https://provider.example/v1".to_string();
            current.api.api_key = "provider-secret".to_string();
            current.api.text_model = "provider-text".to_string();
            current.api.vlm_model = "provider-vlm".to_string();
            current.api.custom_supports_vision = true;
            current.api.vision.mode = VisionProfileMode::Separate;
            current.api.vision.provider = RemoteProviderId::Gemini;
            current.api.vision.api_key = "vision-secret".to_string();
            current.api.vision.base_url = "https://vision.example/v1".to_string();
            current.api.vision.model = "vision-model".to_string();
            current.api.vision.custom_supports_vision = true;

            let reset = build_reset_config(&current);
            assert_eq!(reset.api.provider, provider);
            assert_eq!(reset.api.qwen_region, current.api.qwen_region);
            assert_eq!(reset.api.base_url, current.api.base_url);
            assert_eq!(reset.api.api_key, current.api.api_key);
            assert_eq!(reset.api.text_model, current.api.text_model);
            assert_eq!(reset.api.vlm_model, current.api.vlm_model);
            assert_eq!(
                reset.api.custom_supports_vision,
                current.api.custom_supports_vision
            );
            assert_eq!(reset.api.vision, current.api.vision);
        }
    }
}
