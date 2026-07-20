pub mod change_detector;
pub mod cursor_passthrough;
pub mod hotkey;
pub mod local_model;
pub mod local_process;
pub mod local_runtime;
pub mod ocr_winrt;
pub mod overlay_metrics;
pub mod screen_capture;
pub mod translate_local;
pub mod translate_online;
pub mod windows_shell;

use crate::models::config::AppConfig;
use crate::models::translation::ContextEntry;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{Mutex, Notify};

/// Raw RGBA pixels + dimensions from the most recent capture.
pub type ScreenshotData = (Vec<u8>, u32, u32);

/// Monotonically increasing generation counter.
/// Every config semantic change or reset increments this.
/// All pipeline writes (chunk/result/status/error/cache/context/last_ocr)
/// must verify their generation matches the current one before committing.
pub type Generation = u64;

#[derive(Clone, Serialize)]
pub struct ConfigUpdatedPayload {
    pub revision: u64,
    pub config: AppConfig,
}

/// Shared application state managed by Tauri.
pub struct AppState {
    pub config: Arc<Mutex<AppConfig>>,
    /// Serializes complete config mutations (memory + disk + emitted state).
    /// Frontend writes carry full snapshots, so overlapping commands must not
    /// complete out of order or write the same config file concurrently.
    pub config_update_mutex: Arc<Mutex<()>>,
    /// Monotonic acknowledgement ID for config-updated events. Webviews use it
    /// to reject delayed acknowledgements from older full-snapshot writes.
    pub config_revision: Arc<AtomicU64>,
    /// Translation context history (most recent first)
    pub context: Arc<Mutex<Vec<ContextEntry>>>,
    /// Last perceptual hash for change detection
    pub last_phash: Arc<Mutex<Option<img_hash::ImageHash>>>,
    /// Last OCR source text that produced a translation result
    pub last_ocr_text: Arc<Mutex<Option<String>>>,
    /// Auto-mode cancellation token
    pub auto_mode_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    /// Wakes the auto cadence when its interval changes.
    pub auto_mode_notify: Arc<Notify>,
    /// Raw RGBA pixels from the most recent capture, for settings preview
    pub last_screenshot_raw: Arc<Mutex<Option<ScreenshotData>>>,
    /// Pipeline mutex — prevents concurrent translation runs (§5.5)
    pub pipeline_mutex: Arc<Mutex<()>>,
    /// Generation counter — incremented on config semantic change or reset.
    /// Old pipeline results with stale generation are discarded.
    pub generation: Arc<AtomicU64>,
    /// Local runtime manager for llama.cpp process lifecycle.
    pub local_runtime: Arc<tokio::sync::RwLock<local_runtime::LocalRuntime>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Arc::new(Mutex::new(AppConfig::default())),
            config_update_mutex: Arc::new(Mutex::new(())),
            config_revision: Arc::new(AtomicU64::new(0)),
            context: Arc::new(Mutex::new(Vec::new())),
            last_phash: Arc::new(Mutex::new(None)),
            last_ocr_text: Arc::new(Mutex::new(None)),
            auto_mode_handle: Arc::new(Mutex::new(None)),
            auto_mode_notify: Arc::new(Notify::new()),
            last_screenshot_raw: Arc::new(Mutex::new(None)),
            pipeline_mutex: Arc::new(Mutex::new(())),
            generation: Arc::new(AtomicU64::new(0)),
            local_runtime: Arc::new(tokio::sync::RwLock::new(local_runtime::LocalRuntime::new())),
        }
    }

    /// Get the current generation.
    pub fn current_generation(&self) -> Generation {
        self.generation.load(Ordering::SeqCst)
    }

    /// Increment generation and return the new value.
    /// Called on config semantic change or reset.
    pub fn next_generation(&self) -> Generation {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn next_config_revision(&self) -> u64 {
        self.config_revision.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Load config from the standard app data directory.
    /// Uses load_and_migrate_config for v2→v3 migration.
    pub async fn load_config(&self) -> anyhow::Result<()> {
        let path = config_path()?;
        let (cfg, was_migrated) = if path.exists() {
            let raw = tokio::fs::read_to_string(&path).await?;
            crate::models::config::load_and_migrate_config(&raw)
                .map_err(|e| anyhow::anyhow!("Config parse error: {e}"))?
        } else {
            (AppConfig::default(), false)
        };

        *self.config.lock().await = cfg;

        if was_migrated {
            self.save_config().await?;
        }

        Ok(())
    }

    /// Persist an explicit config snapshot to disk.
    /// Callers that already hold the config lock MUST use this method
    /// to avoid deadlock (save_config re-acquires the lock).
    pub async fn save_config_snapshot(&self, cfg: &AppConfig) -> anyhow::Result<()> {
        let path = config_path()?;
        Self::save_config_snapshot_to_path(&path, cfg).await
    }

    /// Persist a config snapshot to an explicit path.
    /// Kept independent from `self.config` so callers can never re-enter its mutex.
    async fn save_config_snapshot_to_path(
        path: &std::path::Path,
        cfg: &AppConfig,
    ) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let json = serde_json::to_string_pretty(cfg)?;
        tokio::fs::write(path, json).await?;
        Ok(())
    }

    /// Persist the current config to disk.
    /// Only call when NOT holding the config lock.
    pub async fn save_config(&self) -> anyhow::Result<()> {
        let cfg = self.config.lock().await.clone();
        self.save_config_snapshot(&cfg).await
    }

    /// Clear all translation state (cache, context, last_ocr, phash).
    /// Called on semantic config change (§3.3).
    pub async fn clear_translation_state(&self) {
        translate_online::clear_cache().await;
        self.context.lock().await.clear();
        *self.last_ocr_text.lock().await = None;
        *self.last_phash.lock().await = None;
    }
}

pub fn emit_config_updated(app: &tauri::AppHandle, state: &AppState, config: &AppConfig) -> u64 {
    let revision = state.next_config_revision();
    let _ = app.emit(
        "config-updated",
        ConfigUpdatedPayload {
            revision,
            config: config.clone(),
        },
    );
    revision
}

pub fn config_path() -> anyhow::Result<std::path::PathBuf> {
    let base = dirs_next::data_dir()
        .or_else(dirs_next::config_dir)
        .ok_or_else(|| anyhow::anyhow!("Cannot find app data directory"))?;
    Ok(base.join("OverlayTrans").join("config.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn generation_starts_at_zero() {
        let state = AppState::new();
        assert_eq!(state.current_generation(), 0);
    }

    #[test]
    fn generation_increments() {
        let state = AppState::new();
        let g1 = state.next_generation();
        assert_eq!(g1, 1);
        let g2 = state.next_generation();
        assert_eq!(g2, 2);
        assert_eq!(state.current_generation(), 2);
    }

    #[test]
    fn config_revisions_are_monotonic() {
        let state = AppState::new();
        assert_eq!(state.next_config_revision(), 1);
        assert_eq!(state.next_config_revision(), 2);
    }

    #[test]
    fn config_updated_payload_serializes_revision_and_config() {
        let payload = ConfigUpdatedPayload {
            revision: 7,
            config: AppConfig::default(),
        };
        let value = serde_json::to_value(payload).unwrap();
        assert_eq!(value["revision"], 7);
        assert_eq!(value["config"]["version"], 3);
    }

    #[tokio::test]
    async fn pipeline_mutex_rejects_overlapping_runs() {
        let state = AppState::new();
        let first = state.pipeline_mutex.try_lock().unwrap();
        assert!(state.pipeline_mutex.try_lock().is_err());
        drop(first);
        assert!(state.pipeline_mutex.try_lock().is_ok());
    }

    #[tokio::test]
    async fn snapshot_save_does_not_reenter_config_mutex() {
        let state = AppState::new();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let guard = state.config.lock().await;

        tokio::time::timeout(
            Duration::from_secs(1),
            AppState::save_config_snapshot_to_path(&path, &guard),
        )
        .await
        .expect("snapshot save must not wait on the config mutex")
        .unwrap();

        let saved = tokio::fs::read_to_string(path).await.unwrap();
        let parsed: AppConfig = serde_json::from_str(&saved).unwrap();
        assert_eq!(parsed.version, 3);
    }

    #[tokio::test]
    async fn clear_translation_state_resets_context_ocr_and_phash() {
        let state = AppState::new();
        state.context.lock().await.push(ContextEntry {
            source: "hello".to_string(),
            target: "你好".to_string(),
        });
        *state.last_ocr_text.lock().await = Some("hello".to_string());
        let image = image::RgbaImage::from_pixel(8, 8, image::Rgba([0, 0, 0, 255]));
        {
            let mut phash = state.last_phash.lock().await;
            change_detector::has_changed(&image, &mut phash, 4);
        }

        state.clear_translation_state().await;

        assert!(state.context.lock().await.is_empty());
        assert!(state.last_ocr_text.lock().await.is_none());
        assert!(state.last_phash.lock().await.is_none());
    }
}
