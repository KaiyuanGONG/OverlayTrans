//! Tauri commands for local mode management (§10).
//!
//! Commands: get_local_status, download_local_model, cancel_local_model_download,
//!           delete_local_model, test_local_runtime, stop_local_runtime

use tauri::{AppHandle, State};

use crate::services::local_runtime::LocalStatus;
use crate::services::AppState;

/// Get the current local runtime status.
#[tauri::command]
pub async fn get_local_status(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<LocalStatus, String> {
    let local = state.config.lock().await.local.clone();
    let runtime = state.local_runtime.read().await;
    Ok(runtime.status(&local, &app).await)
}

/// Download a GGUF model by model ID (qwen3_4b or qwen3_8b).
#[tauri::command]
pub async fn download_local_model(
    state: State<'_, AppState>,
    app: AppHandle,
    model_id: String,
) -> Result<(), String> {
    let runtime = state.local_runtime.read().await;
    runtime.download_model(&model_id, &app).await
}

/// Cancel an in-progress model download.
#[tauri::command]
pub async fn cancel_local_model_download(state: State<'_, AppState>) -> Result<(), String> {
    let runtime = state.local_runtime.read().await;
    runtime.cancel_download();
    Ok(())
}

/// Delete a downloaded model.
#[tauri::command]
pub async fn delete_local_model(
    state: State<'_, AppState>,
    app: AppHandle,
    model_id: String,
) -> Result<bool, String> {
    let runtime = state.local_runtime.read().await;
    runtime.delete_model(&model_id, &app).await
}

/// Test the local runtime: check health of current endpoint.
#[tauri::command]
pub async fn test_local_runtime(state: State<'_, AppState>) -> Result<String, String> {
    let local = state.config.lock().await.local.clone();
    let runtime = state.local_runtime.read().await;

    match local.backend {
        crate::models::config::LocalBackend::BundledLlamaCpp => {
            let endpoint = runtime
                .translation_endpoint(&local)
                .await
                .map_err(|e| format!("Local runtime not running: {e}"))?;
            let health_base = health_base_url(&endpoint)?;
            let healthy = crate::services::local_process::check_health(&health_base).await;
            if healthy {
                Ok(format!("Local runtime healthy at {endpoint}"))
            } else {
                Err(format!("Local runtime at {endpoint} is not responding"))
            }
        }
        crate::models::config::LocalBackend::CustomLoopback => {
            let endpoint =
                crate::services::translate_local::LocalTranslator::effective_endpoint(&local)
                    .map_err(|e| e.to_string())?;
            let health_base = health_base_url(&endpoint)?;
            let healthy = crate::services::local_process::check_health(&health_base).await;
            if healthy {
                Ok(format!("Custom loopback healthy at {endpoint}"))
            } else {
                Err(format!("Custom loopback at {endpoint} is not responding"))
            }
        }
    }
}

fn health_base_url(endpoint: &str) -> Result<String, String> {
    let mut url = url::Url::parse(endpoint).map_err(|e| format!("Invalid local endpoint: {e}"))?;
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// Stop the running local runtime process.
#[tauri::command]
pub async fn stop_local_runtime(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let runtime = state.local_runtime.read().await;
    runtime.stop(&app).await;
    Ok(())
}

/// Start the bundled llama-server with the configured model.
#[tauri::command]
pub async fn start_local_runtime(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let local = state.config.lock().await.local.clone();
    let runtime = state.local_runtime.read().await;
    runtime.start_bundled(&local, &app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_base_uses_origin_without_brittle_v1_replacement() {
        assert_eq!(
            health_base_url("http://127.0.0.1:8080/api/v1?token=ignored").unwrap(),
            "http://127.0.0.1:8080"
        );
        assert_eq!(
            health_base_url("http://localhost:9000/v1beta").unwrap(),
            "http://localhost:9000"
        );
    }
}
