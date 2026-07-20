//! Local llama-server process lifecycle management (§7.3, §7.5).
//!
//! State machine: Stopped → Starting → Healthy → Stopping → Stopped
//! Handles model switching, health checks, and cleanup on exit.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

// ══════════════════════════════════════════════════════════════════════════════
// §7.5 Process State Machine
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ServerState {
    /// No process running
    Stopped,
    /// Process starting, waiting for health
    Starting,
    /// Process healthy and ready to serve
    Healthy,
    /// Process is being stopped
    Stopping,
    /// Process failed to start or crashed
    Failed,
}

/// Runtime status exposed to the frontend via commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalRuntimeStatus {
    pub server_state: ServerState,
    pub active_model: Option<String>,
    pub endpoint: Option<String>,
    pub port: Option<u16>,
    pub last_error: Option<String>,
}

impl Default for LocalRuntimeStatus {
    fn default() -> Self {
        Self {
            server_state: ServerState::Stopped,
            active_model: None,
            endpoint: None,
            port: None,
            last_error: None,
        }
    }
}

/// Manages the llama-server child process.
pub struct LocalProcessManager {
    status: Arc<Mutex<LocalRuntimeStatus>>,
    child: Arc<Mutex<Option<tokio::process::Child>>>,
}

impl LocalProcessManager {
    pub fn new() -> Self {
        Self {
            status: Arc::new(Mutex::new(LocalRuntimeStatus::default())),
            child: Arc::new(Mutex::new(None)),
        }
    }

    /// Get current runtime status.
    pub async fn status(&self) -> LocalRuntimeStatus {
        self.status.lock().await.clone()
    }

    /// Stop the running process if any.
    pub async fn stop(&self) {
        let mut status = self.status.lock().await;
        status.server_state = ServerState::Stopping;
        drop(status);

        let mut child = self.child.lock().await;
        if let Some(mut c) = child.take() {
            let _ = c.kill().await;
        }

        let mut status = self.status.lock().await;
        status.server_state = ServerState::Stopped;
        status.active_model = None;
        status.endpoint = None;
        status.port = None;
        status.last_error = None;
    }

    /// Mark a spawned or about-to-spawn process as starting. This prevents a
    /// concurrent stop request from mistaking it for an idle runtime.
    pub async fn mark_starting(&self, model: String) {
        let mut status = self.status.lock().await;
        status.server_state = ServerState::Starting;
        status.active_model = Some(model);
        status.endpoint = None;
        status.port = None;
        status.last_error = None;
    }

    /// Check if the process is healthy.
    #[allow(dead_code)]
    pub async fn is_healthy(&self) -> bool {
        let status = self.status.lock().await;
        status.server_state == ServerState::Healthy
    }

    /// Get the current endpoint URL if healthy.
    pub async fn endpoint(&self) -> Option<String> {
        let status = self.status.lock().await;
        if status.server_state == ServerState::Healthy {
            status.endpoint.clone()
        } else {
            None
        }
    }

    /// Mark the process as failed with an error message.
    pub async fn mark_failed(&self, error: String) {
        let mut status = self.status.lock().await;
        status.server_state = ServerState::Failed;
        status.last_error = Some(error);
    }

    /// Mark startup healthy only if a concurrent stop has not cancelled it.
    pub async fn mark_healthy(&self, endpoint: String, port: u16, model: String) -> bool {
        let mut status = self.status.lock().await;
        if status.server_state != ServerState::Starting {
            return false;
        }
        status.server_state = ServerState::Healthy;
        status.endpoint = Some(endpoint);
        status.port = Some(port);
        status.active_model = Some(model);
        status.last_error = None;
        true
    }

    /// Fail an in-progress startup and terminate its child. A concurrent stop
    /// wins cleanly instead of being overwritten with a stale Failed state.
    pub async fn fail_startup(&self, error: String) -> bool {
        {
            let mut status = self.status.lock().await;
            if status.server_state != ServerState::Starting {
                return false;
            }
            status.server_state = ServerState::Failed;
            status.endpoint = None;
            status.port = None;
            status.last_error = Some(error);
        }

        let mut slot = self.child.lock().await;
        if let Some(mut child) = slot.take() {
            let _ = child.kill().await;
        }
        true
    }

    /// Install the child process handle unless a concurrent stop request has
    /// already cancelled startup. Returns false when the child was killed.
    pub async fn set_child_if_starting(&self, child: tokio::process::Child) -> bool {
        {
            let mut slot = self.child.lock().await;
            *slot = Some(child);
        }

        let keep_running = self.status.lock().await.server_state == ServerState::Starting;
        if !keep_running {
            let mut slot = self.child.lock().await;
            if let Some(mut child) = slot.take() {
                let _ = child.kill().await;
            }
        }
        keep_running
    }

    /// Check if the child process is still running.
    #[allow(dead_code)]
    pub async fn check_child_alive(&self) -> bool {
        let mut child = self.child.lock().await;
        if let Some(ref mut c) = *child {
            match c.try_wait() {
                Ok(Some(_)) => {
                    // Process exited
                    false
                }
                Ok(None) => true,
                Err(_) => false,
            }
        } else {
            false
        }
    }

    /// Refresh state after an unexpected child exit.
    pub async fn refresh_if_exited(&self) {
        let exit = {
            let mut child = self.child.lock().await;
            match child.as_mut().map(tokio::process::Child::try_wait) {
                Some(Ok(Some(status))) => {
                    child.take();
                    Some(format!("llama-server exited unexpectedly ({status})"))
                }
                Some(Err(e)) => Some(format!("Failed to inspect llama-server process: {e}")),
                _ => None,
            }
        };
        if let Some(error) = exit {
            self.mark_failed(error).await;
        }
    }
}

/// Find an available TCP port on localhost.
pub fn find_available_port() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    Ok(port)
}

/// Health check: poll the /health endpoint.
pub async fn check_health(endpoint: &str) -> bool {
    let url = format!("{endpoint}/health");
    match reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

/// Wait for the server to become healthy with timeout.
pub async fn wait_for_health(endpoint: &str, timeout: std::time::Duration) -> Result<(), String> {
    let start = std::time::Instant::now();
    loop {
        if check_health(endpoint).await {
            return Ok(());
        }
        if start.elapsed() >= timeout {
            return Err(format!(
                "llama-server health check timed out after {}s",
                timeout.as_secs()
            ));
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn process_manager_starts_stopped() {
        let mgr = LocalProcessManager::new();
        let status = mgr.status().await;
        assert_eq!(status.server_state, ServerState::Stopped);
        assert!(status.active_model.is_none());
        assert!(status.endpoint.is_none());
    }

    #[tokio::test]
    async fn process_manager_mark_healthy() {
        let mgr = LocalProcessManager::new();
        mgr.mark_starting("qwen3-4b".to_string()).await;
        assert!(
            mgr.mark_healthy(
                "http://127.0.0.1:8080/v1".to_string(),
                8080,
                "qwen3-4b".to_string(),
            )
            .await
        );
        let status = mgr.status().await;
        assert_eq!(status.server_state, ServerState::Healthy);
        assert_eq!(status.endpoint.as_deref(), Some("http://127.0.0.1:8080/v1"));
        assert_eq!(status.port, Some(8080));
        assert_eq!(status.active_model.as_deref(), Some("qwen3-4b"));
    }

    #[tokio::test]
    async fn process_manager_marks_starting_before_health() {
        let mgr = LocalProcessManager::new();
        mgr.mark_starting("qwen3_4b".to_string()).await;
        let status = mgr.status().await;
        assert_eq!(status.server_state, ServerState::Starting);
        assert_eq!(status.active_model.as_deref(), Some("qwen3_4b"));

        mgr.stop().await;
        assert_eq!(mgr.status().await.server_state, ServerState::Stopped);
    }

    #[tokio::test]
    async fn process_manager_mark_failed() {
        let mgr = LocalProcessManager::new();
        mgr.mark_failed("startup timeout".to_string()).await;
        let status = mgr.status().await;
        assert_eq!(status.server_state, ServerState::Failed);
        assert_eq!(status.last_error.as_deref(), Some("startup timeout"));
    }

    #[tokio::test]
    async fn fail_startup_preserves_failed_state_and_error() {
        let mgr = LocalProcessManager::new();
        mgr.mark_starting("qwen3_4b".to_string()).await;
        assert!(mgr.fail_startup("health timeout".to_string()).await);

        let status = mgr.status().await;
        assert_eq!(status.server_state, ServerState::Failed);
        assert_eq!(status.active_model.as_deref(), Some("qwen3_4b"));
        assert_eq!(status.last_error.as_deref(), Some("health timeout"));
        assert!(!mgr.check_child_alive().await);
    }

    #[tokio::test]
    async fn process_manager_stop_transitions() {
        let mgr = LocalProcessManager::new();
        mgr.mark_starting("model".to_string()).await;
        assert!(
            mgr.mark_healthy(
                "http://127.0.0.1:8080/v1".to_string(),
                8080,
                "model".to_string(),
            )
            .await
        );
        assert!(mgr.is_healthy().await);

        mgr.stop().await;
        assert!(!mgr.is_healthy().await);
        assert_eq!(mgr.status().await.server_state, ServerState::Stopped);
    }

    #[tokio::test]
    async fn stopped_startup_cannot_be_resurrected_as_healthy_or_failed() {
        let mgr = LocalProcessManager::new();
        mgr.mark_starting("qwen3_4b".to_string()).await;
        mgr.stop().await;

        assert!(
            !mgr.mark_healthy(
                "http://127.0.0.1:1234/v1".to_string(),
                1234,
                "qwen3_4b".to_string(),
            )
            .await
        );
        assert!(!mgr.fail_startup("stale failure".to_string()).await);
        assert_eq!(mgr.status().await.server_state, ServerState::Stopped);
    }

    #[tokio::test]
    async fn process_manager_stop_is_idempotent() {
        let mgr = LocalProcessManager::new();
        mgr.stop().await;
        mgr.stop().await;
        assert_eq!(mgr.status().await.server_state, ServerState::Stopped);
    }

    #[test]
    fn find_available_port_returns_valid_port() {
        let port = find_available_port().unwrap();
        assert!(port > 0);
    }

    #[test]
    fn server_state_serializes_correctly() {
        assert_eq!(
            serde_json::to_string(&ServerState::Stopped).unwrap(),
            "\"stopped\""
        );
        assert_eq!(
            serde_json::to_string(&ServerState::Healthy).unwrap(),
            "\"healthy\""
        );
        assert_eq!(
            serde_json::to_string(&ServerState::Failed).unwrap(),
            "\"failed\""
        );
    }

    #[test]
    fn local_runtime_status_default_is_stopped() {
        let status = LocalRuntimeStatus::default();
        assert_eq!(status.server_state, ServerState::Stopped);
        assert!(status.active_model.is_none());
    }
}
