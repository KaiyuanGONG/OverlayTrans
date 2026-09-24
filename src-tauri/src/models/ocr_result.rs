use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBox {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrResult {
    /// Concatenated recognized text (all lines joined by space)
    pub text: String,
    /// Per-line confidence scores (0.0 - 1.0)
    pub confidences: Vec<f32>,
    /// Bounding boxes for each recognized text region
    pub boxes: Vec<BoundingBox>,
    /// Which OCR engine produced this result
    pub engine: String,
    /// Time taken for OCR in milliseconds
    pub latency_ms: u64,
}

impl OcrResult {
    pub fn is_empty(&self) -> bool {
        self.text.trim().is_empty()
    }
}
