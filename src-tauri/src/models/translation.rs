use serde::{Deserialize, Serialize};

use crate::services::Generation;

/// Status event payload — carries generation so frontend can discard stale events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusPayload {
    pub status: String,
    pub generation: Generation,
}

/// Chunk event payload — carries generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkPayload {
    pub text: String,
    pub generation: Generation,
}

/// Error event payload — carries generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub error: String,
    pub generation: Generation,
}

/// Warning event payload — carries generation.
/// Used for fallback warnings and non-fatal issues.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WarningPayload {
    pub message: String,
    pub generation: Generation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationResult {
    pub source: String,
    pub target: String,
    pub ocr_engine: String,
    pub translation_engine: String,
    pub provider_label: String,
    pub latency_ms: u64,
    pub generation: Generation,
}

/// Context history entry for LLM-based translation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextEntry {
    pub source: String,
    pub target: String,
}
