//! Local runtime orchestrator — ties model download, process lifecycle, and health (§7).
//!
//! This module manages the complete local mode lifecycle:
//! - Model download with progress/cancel/SHA verification
//! - Process start/stop/health for bundled llama-server
//! - Custom loopback endpoint validation and health
//! - Status reporting to frontend

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::Mutex;

use crate::models::config::{LocalBackend, LocalConfig, LocalModel};
use crate::services::local_model;
use crate::services::local_process::{self, LocalProcessManager, ServerState};
use crate::services::translate_local;

// ══════════════════════════════════════════════════════════════════════════════
// §7.4 Local Status — NOT persisted in config, derived from real state
// ══════════════════════════════════════════════════════════════════════════════

/// Model download/verification state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ModelState {
    /// Model not downloaded
    NotDownloaded,
    /// Download in progress
    Downloading,
    /// Download complete, verifying SHA
    Verifying,
    /// Model ready to use
    Ready,
    /// Download or verification failed
    Failed,
}

/// Full local runtime status exposed to frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalStatus {
    /// Whether the launcher, required DLLs and pinned license are all present.
    pub runtime_packaged: bool,
    /// Model download state
    pub model_state: ModelState,
    /// Model file size in bytes (0 if not downloaded)
    pub model_bytes: u64,
    /// Expected model bytes from manifest
    pub model_expected_bytes: u64,
    /// Download progress (0.0 - 1.0)
    pub download_progress: f64,
    /// Server process state
    pub server_state: ServerState,
    /// Currently active model ID
    pub active_model: Option<String>,
    /// Server endpoint if healthy
    pub endpoint: Option<String>,
    /// Last error message
    pub last_error: Option<String>,
}

/// Download progress event payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalModelProgress {
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub progress: f64,
    pub done: bool,
    pub error: Option<String>,
}

/// Runtime status event payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalRuntimeStatusEvent {
    pub server_state: ServerState,
    pub active_model: Option<String>,
    pub endpoint: Option<String>,
    pub error: Option<String>,
}

/// Manages the complete local runtime lifecycle.
pub struct LocalRuntime {
    process: LocalProcessManager,
    cancel_flag: Arc<AtomicBool>,
    download_lock: Mutex<()>,
    verification_lock: Mutex<()>,
}

const MAX_STARTUP_DIAGNOSTICS: usize = 16;
const MAX_DIAGNOSTIC_CHARS: usize = 400;
const MAX_LOCAL_WORKER_THREADS: usize = 4;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const REQUIRED_RUNTIME_COMPANIONS: &[&str] = &["llama-server-LICENSE.txt"];
const FORBIDDEN_RUNTIME_COMPANIONS: &[&str] = &["libomp140.x86_64.dll"];
const LOCAL_CPU_REQUIREMENT_ERROR: &str =
    "本地模式需要支持 AVX2 的处理器；在线速度/质量模式仍可使用。";

#[derive(Debug, Clone, Copy)]
struct CpuCapabilities {
    avx2: bool,
    fma: bool,
    f16c: bool,
    bmi2: bool,
}

impl CpuCapabilities {
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    fn detect() -> Self {
        Self {
            avx2: std::is_x86_feature_detected!("avx2"),
            fma: std::is_x86_feature_detected!("fma"),
            f16c: std::is_x86_feature_detected!("f16c"),
            bmi2: std::is_x86_feature_detected!("bmi2"),
        }
    }

    #[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
    fn detect() -> Self {
        Self {
            avx2: false,
            fma: false,
            f16c: false,
            bmi2: false,
        }
    }

    fn supports_bundled_runtime(self) -> bool {
        self.avx2 && self.fma && self.f16c && self.bmi2
    }
}

impl LocalRuntime {
    pub fn new() -> Self {
        Self {
            process: LocalProcessManager::new(),
            cancel_flag: Arc::new(AtomicBool::new(false)),
            download_lock: Mutex::new(()),
            verification_lock: Mutex::new(()),
        }
    }

    /// Get the process manager reference.
    #[allow(dead_code)]
    pub fn process(&self) -> &LocalProcessManager {
        &self.process
    }

    fn ensure_bundled_cpu_supported(&self, capabilities: CpuCapabilities) -> Result<(), String> {
        if capabilities.supports_bundled_runtime() {
            Ok(())
        } else {
            Err(LOCAL_CPU_REQUIREMENT_ERROR.to_string())
        }
    }

    /// Get full local status.
    pub async fn status(&self, local: &LocalConfig, app: &tauri::AppHandle) -> LocalStatus {
        self.status_with_runtime(local, bundled_runtime_path(app).is_ok())
            .await
    }

    async fn status_with_runtime(
        &self,
        local: &LocalConfig,
        runtime_packaged: bool,
    ) -> LocalStatus {
        self.status_with_runtime_and_model_path(local, runtime_packaged, None)
            .await
    }

    async fn status_with_runtime_and_model_path(
        &self,
        local: &LocalConfig,
        runtime_packaged: bool,
        model_path: Option<&Path>,
    ) -> LocalStatus {
        let model_id = match local.model {
            LocalModel::Qwen3_4B => "qwen3_4b",
            LocalModel::Qwen3_8B => "qwen3_8b",
            LocalModel::Custom => "custom",
        };

        let (model_state, model_bytes) = if local.backend == LocalBackend::CustomLoopback {
            let config_valid = translate_local::LocalTranslator::effective_endpoint(local).is_ok()
                && translate_local::LocalTranslator::effective_model(local).is_ok();
            (
                if config_valid {
                    ModelState::Ready
                } else {
                    ModelState::Failed
                },
                0,
            )
        } else if local.model == LocalModel::Custom {
            (ModelState::Failed, 0)
        } else {
            let _verification_guard = self.verification_lock.lock().await;
            let downloaded = match model_path {
                Some(path) => local_model::is_model_downloaded_at(model_id, path).await,
                None => local_model::is_model_downloaded(model_id).await,
            };
            match downloaded {
                Ok(true) => {
                    let bytes = match model_path {
                        Some(path) => tokio::fs::metadata(path)
                            .await
                            .map(|metadata| metadata.len())
                            .unwrap_or(0),
                        None => local_model::model_file_size(model_id).await,
                    };
                    (ModelState::Ready, bytes)
                }
                Ok(false) => (ModelState::NotDownloaded, 0),
                Err(_) => (ModelState::Failed, 0),
            }
        };

        let expected_bytes = match local_model::manifest_for_model(model_id) {
            Some(m) => m.bytes,
            None => 0,
        };

        self.process.refresh_if_exited().await;
        let proc_status = self.process.status().await;

        LocalStatus {
            runtime_packaged,
            model_state,
            model_bytes,
            model_expected_bytes: expected_bytes,
            download_progress: 0.0,
            server_state: proc_status.server_state,
            active_model: proc_status.active_model,
            endpoint: proc_status.endpoint,
            last_error: proc_status.last_error,
        }
    }

    /// Download a GGUF model with progress and cancellation support.
    pub async fn download_model(
        &self,
        model_id: &str,
        app: &tauri::AppHandle,
    ) -> Result<(), String> {
        let _guard = self.download_lock.lock().await;
        self.cancel_flag.store(false, Ordering::Relaxed);

        let manifest = local_model::manifest_for_model(model_id)
            .ok_or_else(|| format!("Unknown model: {model_id}"))?;

        let dest = local_model::model_path(model_id)
            .map_err(|e| format!("Failed to get model path: {e}"))?;

        let model_id_owned = model_id.to_string();
        let cancel = self.cancel_flag.clone();
        let app_clone = app.clone();
        let url = manifest.download_url();
        let expected_sha = manifest.sha256.to_string();
        let expected_bytes = manifest.bytes;

        // Create only the directory, then fail before opening a network
        // connection if the temporary GGUF plus safety reserve will not fit.
        let parent = dest
            .parent()
            .ok_or_else(|| "Model destination has no parent directory".to_string())?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create model directory: {e}"))?;
        local_model::ensure_download_space(parent, expected_bytes)
            .map_err(|e| format!("Cannot download model: {e}"))?;

        // Emit initial progress
        let _ = app.emit(
            "local-model-progress",
            LocalModelProgress {
                model_id: model_id_owned.clone(),
                downloaded: 0,
                total: expected_bytes,
                progress: 0.0,
                done: false,
                error: None,
            },
        );

        let result =
            crate::utils::download::download_file(crate::utils::download::DownloadOptions {
                url: &url,
                dest: &dest,
                expected_sha256: Some(&expected_sha),
                cancel_flag: Some(cancel),
                on_progress: Some(Box::new(move |downloaded, total| {
                    let total = if total > 0 { total } else { expected_bytes };
                    let progress = if total > 0 {
                        (downloaded as f64 / total as f64).min(1.0)
                    } else {
                        0.0
                    };
                    let _ = app_clone.emit(
                        "local-model-progress",
                        LocalModelProgress {
                            model_id: model_id_owned.clone(),
                            downloaded,
                            total,
                            progress,
                            done: false,
                            error: None,
                        },
                    );
                })),
            })
            .await;

        match result {
            Ok(()) => {
                // download_file already verified the streaming SHA before its
                // atomic rename. Persist only a lightweight file-bound stamp.
                if let Err(e) = local_model::mark_model_verified(model_id).await {
                    // The GGUF itself already passed SHA verification. A
                    // missing performance stamp is recoverable: the next
                    // status check streams one verification pass.
                    log::warn!("Failed to write local model verification stamp: {e}");
                }
                let _ = app.emit(
                    "local-model-progress",
                    LocalModelProgress {
                        model_id: model_id.to_string(),
                        downloaded: expected_bytes,
                        total: expected_bytes,
                        progress: 1.0,
                        done: true,
                        error: None,
                    },
                );
                Ok(())
            }
            Err(crate::utils::download::DownloadError::Cancelled) => {
                let _ = app.emit(
                    "local-model-progress",
                    LocalModelProgress {
                        model_id: model_id.to_string(),
                        downloaded: 0,
                        total: expected_bytes,
                        progress: 0.0,
                        done: true,
                        error: Some("Download cancelled".to_string()),
                    },
                );
                Err("Download cancelled".to_string())
            }
            Err(e) => {
                let msg = format!("Download failed: {e}");
                let _ = app.emit(
                    "local-model-progress",
                    LocalModelProgress {
                        model_id: model_id.to_string(),
                        downloaded: 0,
                        total: expected_bytes,
                        progress: 0.0,
                        done: true,
                        error: Some(msg.clone()),
                    },
                );
                Err(msg)
            }
        }
    }

    /// Cancel an in-progress download.
    pub fn cancel_download(&self) {
        self.cancel_flag.store(true, Ordering::Relaxed);
    }

    /// Delete a downloaded model.
    pub async fn delete_model(
        &self,
        model_id: &str,
        app: &tauri::AppHandle,
    ) -> Result<bool, String> {
        // Stop the process if it's using this model
        let status = self.process.status().await;
        if status.active_model.as_deref() == Some(model_id) {
            self.stop(app).await;
        }

        let _verification_guard = self.verification_lock.lock().await;
        local_model::delete_model(model_id)
            .await
            .map_err(|e| format!("Failed to delete model: {e}"))
    }

    /// Start the bundled llama-server process.
    pub async fn start_bundled(
        &self,
        local: &LocalConfig,
        app: &tauri::AppHandle,
    ) -> Result<(), String> {
        self.ensure_bundled_cpu_supported(CpuCapabilities::detect())?;

        // Stop existing process
        self.process.stop().await;

        let model_id = match local.model {
            LocalModel::Qwen3_4B => "qwen3_4b",
            LocalModel::Qwen3_8B => "qwen3_8b",
            LocalModel::Custom => {
                return Err("Custom GGUF not supported with bundled backend".to_string());
            }
        };

        // Verify model is downloaded
        let _verification_guard = self.verification_lock.lock().await;
        if !local_model::is_model_downloaded(model_id)
            .await
            .map_err(|e| format!("Failed to check model: {e}"))?
        {
            return Err("Model not downloaded. Please download it first.".to_string());
        }
        drop(_verification_guard);

        let model_path = local_model::model_path(model_id)
            .map_err(|e| format!("Failed to get model path: {e}"))?;

        let port = local_process::find_available_port()
            .map_err(|e| format!("Failed to find available port: {e}"))?;

        let endpoint = format!("http://127.0.0.1:{port}/v1");

        // Find the sidecar binary
        let sidecar_path = bundled_runtime_path(app)?;

        self.process.mark_starting(model_id.to_string()).await;
        let _ = app.emit(
            "local-runtime-status",
            LocalRuntimeStatusEvent {
                server_state: ServerState::Starting,
                active_model: Some(model_id.to_string()),
                endpoint: None,
                error: None,
            },
        );

        // Start the process
        let worker_threads = local_worker_threads();
        let mut cmd = tokio::process::Command::new(&sidecar_path);
        cmd.arg("--model")
            .arg(&model_path)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--ctx-size")
            .arg("2048")
            .arg("--threads")
            .arg(worker_threads.to_string())
            .arg("--threads-batch")
            .arg(worker_threads.to_string())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // llama-server is an implementation detail of the desktop app. A
        // Windows console window would be both distracting and easy to close
        // accidentally; stdout/stderr remain available through the pipes.
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => {
                let message = format!("Failed to start llama-server: {e}");
                self.process.fail_startup(message.clone()).await;
                return Err(message);
            }
        };

        // Capture only bounded startup diagnostics, before the endpoint is
        // exposed to translation requests. After health succeeds, continue
        // draining without retaining or logging any line.
        let capture_diagnostics = Arc::new(AtomicBool::new(true));
        let diagnostics = Arc::new(Mutex::new(VecDeque::new()));
        let redactions = vec![model_path.to_string_lossy().into_owned()];
        if let Some(stdout) = child.stdout.take() {
            spawn_output_drain(
                stdout,
                capture_diagnostics.clone(),
                diagnostics.clone(),
                redactions.clone(),
            );
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_output_drain(
                stderr,
                capture_diagnostics.clone(),
                diagnostics.clone(),
                redactions,
            );
        }

        if !self.process.set_child_if_starting(child).await {
            capture_diagnostics.store(false, Ordering::Relaxed);
            return Err("Local runtime startup was cancelled".to_string());
        }

        // Wait for health
        let health_endpoint = format!("http://127.0.0.1:{port}");
        match local_process::wait_for_health(&health_endpoint, std::time::Duration::from_secs(30))
            .await
        {
            Ok(()) => {
                capture_diagnostics.store(false, Ordering::Relaxed);
                if !self
                    .process
                    .mark_healthy(endpoint, port, model_id.to_string())
                    .await
                {
                    return Err("Local runtime startup was cancelled".to_string());
                }
                let _ = app.emit(
                    "local-runtime-status",
                    LocalRuntimeStatusEvent {
                        server_state: ServerState::Healthy,
                        active_model: Some(model_id.to_string()),
                        endpoint: Some(format!("http://127.0.0.1:{port}/v1")),
                        error: None,
                    },
                );
                Ok(())
            }
            Err(e) => {
                capture_diagnostics.store(false, Ordering::Relaxed);
                let startup_details = diagnostics
                    .lock()
                    .await
                    .iter()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" | ");
                let e = if startup_details.is_empty() {
                    e
                } else {
                    format!("{e}. Sanitized startup diagnostics: {startup_details}")
                };
                if !self.process.fail_startup(e.clone()).await {
                    return Err("Local runtime startup was cancelled".to_string());
                }
                let _ = app.emit(
                    "local-runtime-status",
                    LocalRuntimeStatusEvent {
                        server_state: ServerState::Failed,
                        active_model: None,
                        endpoint: None,
                        error: Some(e.clone()),
                    },
                );
                Err(e)
            }
        }
    }

    /// Stop the running process.
    pub async fn stop(&self, app: &tauri::AppHandle) {
        self.process.stop().await;
        let _ = app.emit(
            "local-runtime-status",
            LocalRuntimeStatusEvent {
                server_state: ServerState::Stopped,
                active_model: None,
                endpoint: None,
                error: None,
            },
        );
    }

    /// Get the current endpoint for translation.
    pub async fn translation_endpoint(&self, local: &LocalConfig) -> Result<String, String> {
        match local.backend {
            LocalBackend::BundledLlamaCpp => self
                .process
                .endpoint()
                .await
                .ok_or_else(|| "Bundled llama-server is not running.".to_string()),
            LocalBackend::CustomLoopback => {
                translate_local::LocalTranslator::effective_endpoint(local)
                    .map_err(|e| e.to_string())
            }
        }
    }
}

fn worker_threads_for(available_parallelism: usize) -> usize {
    (available_parallelism / 2).clamp(1, MAX_LOCAL_WORKER_THREADS)
}

fn local_worker_threads() -> usize {
    std::thread::available_parallelism()
        .map(usize::from)
        .map(worker_threads_for)
        .unwrap_or(2)
}

fn sanitize_startup_diagnostic(line: &str, redactions: &[String]) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    if [
        "authorization",
        "bearer ",
        "api_key",
        "api key",
        "prompt",
        "request content",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return None;
    }

    let mut clean: String = line
        .chars()
        .filter(|ch| !ch.is_control() || ch.is_whitespace())
        .collect();
    for value in redactions {
        if !value.is_empty() {
            clean = clean.replace(value, "<model>");
        }
    }
    clean = clean.trim().chars().take(MAX_DIAGNOSTIC_CHARS).collect();
    (!clean.is_empty()).then_some(clean)
}

fn spawn_output_drain<R>(
    reader: R,
    capture: Arc<AtomicBool>,
    diagnostics: Arc<Mutex<VecDeque<String>>>,
    redactions: Vec<String>,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !capture.load(Ordering::Relaxed) {
                continue;
            }
            if let Some(line) = sanitize_startup_diagnostic(&line, &redactions) {
                let mut diagnostics = diagnostics.lock().await;
                if diagnostics.len() == MAX_STARTUP_DIAGNOSTICS {
                    diagnostics.pop_front();
                }
                diagnostics.push_back(line);
            }
        }
    });
}

/// Resolve a complete packaged runtime, not merely the launcher executable.
fn bundled_runtime_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?;

    // The target triple exists only on the build input. Tauri strips it when
    // copying an external binary beside the packaged application executable.
    let sidecar_name = packaged_sidecar_name();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(std::path::Path::to_path_buf));
    let mut candidates = vec![resource_dir];
    if let Some(exe_dir) = exe_dir {
        if !candidates.contains(&exe_dir) {
            candidates.push(exe_dir);
        }
    }

    for directory in &candidates {
        if runtime_directory_complete(directory) {
            return Ok(directory.join(sidecar_name));
        }
    }

    Err(format!(
        "Bundled llama-server runtime is incomplete. Checked: {}",
        candidates
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn runtime_directory_complete(directory: &std::path::Path) -> bool {
    directory.join(packaged_sidecar_name()).is_file()
        && REQUIRED_RUNTIME_COMPANIONS
            .iter()
            .all(|name| directory.join(name).is_file())
        && FORBIDDEN_RUNTIME_COMPANIONS
            .iter()
            .all(|name| !directory.join(name).exists())
}

fn packaged_sidecar_name() -> &'static str {
    if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_runtime_starts_with_default_status() {
        let runtime = LocalRuntime::new();
        let local = LocalConfig::default();
        let directory = tempfile::tempdir().expect("temp model directory");
        let model_path = directory.path().join(local_model::QWEN3_4B.file);
        let status = runtime
            .status_with_runtime_and_model_path(&local, false, Some(&model_path))
            .await;
        assert_eq!(status.server_state, ServerState::Stopped);
        assert_eq!(status.model_state, ModelState::NotDownloaded);
        assert!(!status.runtime_packaged);
        assert!(status.active_model.is_none());
    }

    #[tokio::test]
    async fn cancel_download_sets_flag() {
        let runtime = LocalRuntime::new();
        assert!(!runtime.cancel_flag.load(Ordering::Relaxed));
        runtime.cancel_download();
        assert!(runtime.cancel_flag.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn stop_is_idempotent() {
        let runtime = LocalRuntime::new();
        // Stop on already-stopped runtime should be no-op
        runtime.process.stop().await;
        runtime.process.stop().await;
        assert_eq!(
            runtime.process.status().await.server_state,
            ServerState::Stopped
        );
    }

    #[test]
    fn packaged_sidecar_uses_final_tauri_name() {
        #[cfg(target_os = "windows")]
        assert_eq!(packaged_sidecar_name(), "llama-server.exe");
        #[cfg(not(target_os = "windows"))]
        assert_eq!(packaged_sidecar_name(), "llama-server");
    }

    #[test]
    fn startup_diagnostics_redact_model_and_drop_sensitive_lines() {
        let model = r"C:\Users\test\model.gguf".to_string();
        assert_eq!(
            sanitize_startup_diagnostic(
                r"loading model C:\Users\test\model.gguf",
                std::slice::from_ref(&model)
            )
            .as_deref(),
            Some("loading model <model>")
        );
        assert!(
            sanitize_startup_diagnostic("request content prompt=secret subtitle", &[]).is_none()
        );
        assert!(sanitize_startup_diagnostic("Authorization: Bearer secret", &[]).is_none());
    }

    #[test]
    fn local_worker_threads_are_background_friendly() {
        assert_eq!(worker_threads_for(1), 1);
        assert_eq!(worker_threads_for(4), 2);
        assert_eq!(worker_threads_for(8), 4);
        assert_eq!(worker_threads_for(32), 4);
    }

    #[test]
    fn bundled_runtime_accepts_injected_required_cpu_features() {
        let runtime = LocalRuntime::new();
        let capabilities = CpuCapabilities {
            avx2: true,
            fma: true,
            f16c: true,
            bmi2: true,
        };

        assert!(runtime.ensure_bundled_cpu_supported(capabilities).is_ok());
    }

    #[test]
    fn bundled_runtime_rejects_each_missing_injected_cpu_feature() {
        let runtime = LocalRuntime::new();
        let missing_feature_cases = [
            CpuCapabilities {
                avx2: false,
                fma: true,
                f16c: true,
                bmi2: true,
            },
            CpuCapabilities {
                avx2: true,
                fma: false,
                f16c: true,
                bmi2: true,
            },
            CpuCapabilities {
                avx2: true,
                fma: true,
                f16c: false,
                bmi2: true,
            },
            CpuCapabilities {
                avx2: true,
                fma: true,
                f16c: true,
                bmi2: false,
            },
        ];

        for capabilities in missing_feature_cases {
            assert_eq!(
                runtime
                    .ensure_bundled_cpu_supported(capabilities)
                    .unwrap_err(),
                "本地模式需要支持 AVX2 的处理器；在线速度/质量模式仍可使用。"
            );
        }
    }

    #[tokio::test]
    async fn rejected_cpu_does_not_enter_starting_state() {
        let runtime = LocalRuntime::new();
        let result = runtime.ensure_bundled_cpu_supported(CpuCapabilities {
            avx2: true,
            fma: true,
            f16c: true,
            bmi2: false,
        });

        assert!(result.is_err());
        assert_eq!(
            runtime.process.status().await.server_state,
            ServerState::Stopped
        );
    }

    #[test]
    fn runtime_readiness_requires_static_launcher_and_license_without_libomp() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join(packaged_sidecar_name()), b"exe").unwrap();
        std::fs::write(
            directory.path().join("llama-server-LICENSE.txt"),
            b"fixture",
        )
        .unwrap();
        assert!(runtime_directory_complete(directory.path()));

        std::fs::write(directory.path().join("libomp140.x86_64.dll"), b"forbidden").unwrap();
        assert!(!runtime_directory_complete(directory.path()));

        std::fs::remove_file(directory.path().join("libomp140.x86_64.dll")).unwrap();
        std::fs::remove_file(directory.path().join("llama-server-LICENSE.txt")).unwrap();
        assert!(!runtime_directory_complete(directory.path()));
    }
}
