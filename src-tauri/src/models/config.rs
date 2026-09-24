use serde::{Deserialize, Serialize};

// ══════════════════════════════════════════════════════════════════════════════
// Canonical runtime schema — NO legacy fields
// ══════════════════════════════════════════════════════════════════════════════

// ── RemoteProviderId — deepseek/qwen/gemini/groq/openai/custom ────────────
// "local" is NOT a remote provider; it belongs to LocalConfig.

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RemoteProviderId {
    #[serde(rename = "deepseek", alias = "deep_seek")]
    #[default]
    DeepSeek,
    #[serde(rename = "qwen")]
    Qwen,
    #[serde(rename = "gemini")]
    Gemini,
    #[serde(rename = "groq")]
    Groq,
    #[serde(rename = "openai", alias = "open_ai")]
    OpenAI,
    #[serde(rename = "custom")]
    Custom,
}

// Keep `ProviderId` as an alias for backward compat in code that still uses it.
pub type ProviderId = RemoteProviderId;

impl std::fmt::Display for RemoteProviderId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DeepSeek => write!(f, "DeepSeek"),
            Self::Qwen => write!(f, "Qwen"),
            Self::Gemini => write!(f, "Gemini"),
            Self::Groq => write!(f, "Groq"),
            Self::OpenAI => write!(f, "OpenAI"),
            Self::Custom => write!(f, "自定义"),
        }
    }
}

/// Static preset data for a remote provider.
pub struct ProviderPreset {
    pub id: RemoteProviderId,
    pub label: &'static str,
    pub base_url: &'static str,
    pub text_models: &'static [&'static str],
    pub vlm_models: &'static [&'static str],
    pub default_text_model: &'static str,
    pub default_vlm_model: &'static str,
    pub supports_vision: bool,
    pub qwen_international_base_url: Option<&'static str>,
}

impl RemoteProviderId {
    pub fn as_wire_id(&self) -> &'static str {
        match self {
            Self::DeepSeek => "deepseek",
            Self::Qwen => "qwen",
            Self::Gemini => "gemini",
            Self::Groq => "groq",
            Self::OpenAI => "openai",
            Self::Custom => "custom",
        }
    }

    /// All presets in display order.
    /// Model presets are time-sensitive (last checked 2026-07-18);
    /// re-verify them before a release (see docs/PACKAGING_WINDOWS.md).
    pub fn all_presets() -> &'static [ProviderPreset] {
        &[
            ProviderPreset {
                id: RemoteProviderId::DeepSeek,
                label: "DeepSeek",
                base_url: "https://api.deepseek.com",
                text_models: &["deepseek-v4-flash", "deepseek-v4-pro"],
                vlm_models: &[],
                default_text_model: "deepseek-v4-flash",
                default_vlm_model: "",
                supports_vision: false,
                qwen_international_base_url: None,
            },
            ProviderPreset {
                id: RemoteProviderId::Qwen,
                label: "Qwen (通义千问)",
                base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                text_models: &["qwen3.6-flash", "qwen3.6-plus", "qwen3.7-plus"],
                vlm_models: &["qwen3.6-flash", "qwen3.6-plus", "qwen3.7-plus"],
                default_text_model: "qwen3.6-flash",
                default_vlm_model: "qwen3.6-flash",
                supports_vision: true,
                qwen_international_base_url: Some(
                    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
                ),
            },
            ProviderPreset {
                id: RemoteProviderId::Gemini,
                label: "Gemini (Google)",
                base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
                text_models: &["gemini-3.1-flash-lite", "gemini-3.5-flash"],
                vlm_models: &["gemini-3.1-flash-lite", "gemini-3.5-flash"],
                default_text_model: "gemini-3.1-flash-lite",
                default_vlm_model: "gemini-3.5-flash",
                supports_vision: true,
                qwen_international_base_url: None,
            },
            ProviderPreset {
                id: RemoteProviderId::Groq,
                label: "Groq (快速推理)",
                base_url: "https://api.groq.com/openai/v1",
                text_models: &[
                    "openai/gpt-oss-20b",
                    "qwen/qwen3.6-27b",
                    "openai/gpt-oss-120b",
                ],
                vlm_models: &[],
                default_text_model: "openai/gpt-oss-20b",
                default_vlm_model: "",
                supports_vision: false,
                qwen_international_base_url: None,
            },
            ProviderPreset {
                id: RemoteProviderId::OpenAI,
                label: "OpenAI",
                base_url: "https://api.openai.com",
                text_models: &["gpt-5.4-nano", "gpt-5.4-mini"],
                vlm_models: &["gpt-5.4-mini"],
                default_text_model: "gpt-5.4-nano",
                default_vlm_model: "gpt-5.4-mini",
                supports_vision: true,
                qwen_international_base_url: None,
            },
        ]
    }

    /// Look up a preset by provider id.
    pub fn preset(&self) -> Option<&'static ProviderPreset> {
        Self::all_presets().iter().find(|p| p.id == *self)
    }

    /// Find the provider id that matches a given base_url (for UI display).
    pub fn from_base_url(url: &str) -> Option<RemoteProviderId> {
        let trimmed = url.trim_end_matches('/');
        if trimmed == QwenRegion::International.base_url().trim_end_matches('/') {
            return Some(RemoteProviderId::Qwen);
        }
        Self::all_presets()
            .iter()
            .find(|p| p.base_url.trim_end_matches('/') == trimmed)
            .map(|p| p.id.clone())
    }
}

// ── Language enums ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub enum SourceLang {
    #[serde(rename = "auto")]
    Auto,
    #[default]
    #[serde(rename = "en")]
    En,
    #[serde(rename = "ja")]
    Ja,
    #[serde(rename = "zh")]
    Zh,
}

impl SourceLang {
    /// BCP-47 tag for WinRT OCR.
    /// Returns None for Auto — caller must validate and return an error.
    pub fn winrt_tag(&self) -> Option<&'static str> {
        match self {
            Self::Auto => None,
            Self::En => Some("en-US"),
            Self::Ja => Some("ja-JP"),
            Self::Zh => Some("zh-Hans"),
        }
    }

    /// Validate that this source language is usable for OCR.
    /// Auto is not allowed — user must pick a specific language.
    pub fn validate_for_ocr(&self) -> Result<&'static str, String> {
        self.winrt_tag().ok_or_else(|| {
            "自动检测语言不支持 OCR，请手动选择源语言。\
             Auto-detect is not supported for OCR, please select a source language."
                .to_string()
        })
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub enum TargetLang {
    #[default]
    #[serde(rename = "zh")]
    Zh,
    #[serde(rename = "en")]
    En,
    #[serde(rename = "ja")]
    Ja,
}

impl TargetLang {
    /// Human-readable name for LLM prompts.
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Zh => "Simplified Chinese",
            Self::En => "English",
            Self::Ja => "日本語",
        }
    }

    /// Canonical wire id — matches the serde rename. Use this anywhere the
    /// value participates in a protocol/key; never derive it from `Debug`.
    pub fn wire_id(&self) -> &'static str {
        match self {
            Self::Zh => "zh",
            Self::En => "en",
            Self::Ja => "ja",
        }
    }
}

// ── Translation mode ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub enum TranslationMode {
    #[default]
    #[serde(rename = "speed")]
    Speed,
    #[serde(rename = "quality")]
    Quality,
    #[serde(rename = "local")]
    Local,
}

/// Validate that the translation mode is implemented.
/// Returns Ok(()) for Speed, Quality, and Local.
pub fn validate_mode(mode: &TranslationMode) -> Result<(), String> {
    match mode {
        TranslationMode::Speed | TranslationMode::Quality | TranslationMode::Local => Ok(()),
    }
}

// ── Trigger mode ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub enum TriggerMode {
    #[default]
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "auto")]
    Auto,
}

// ── Qwen region ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub enum QwenRegion {
    #[default]
    #[serde(rename = "domestic")]
    Domestic,
    #[serde(rename = "international")]
    International,
}

impl QwenRegion {
    pub fn base_url(&self) -> &'static str {
        match self {
            Self::Domestic => "https://dashscope.aliyuncs.com/compatible-mode/v1",
            Self::International => "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        }
    }
}

// ── Local config ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub enum LocalBackend {
    #[default]
    #[serde(rename = "bundled_llama_cpp")]
    BundledLlamaCpp,
    #[serde(rename = "custom_loopback")]
    CustomLoopback,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub enum LocalModel {
    /// Default Qwen3-4B Q4_K_M
    #[default]
    #[serde(rename = "qwen3_4b", alias = "qwen3_4_b")]
    Qwen3_4B,
    /// High-quality Qwen3-8B Q4_K_M
    #[serde(rename = "qwen3_8b", alias = "qwen3_8_b")]
    Qwen3_8B,
    /// User-provided GGUF path
    #[serde(rename = "custom")]
    Custom,
}

/// Local-only configuration, kept separate from the remote ApiConfig.
/// Never reads remote API keys; never falls back to remote services.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct LocalConfig {
    #[serde(default)]
    pub backend: LocalBackend,
    #[serde(default)]
    pub model: LocalModel,
    #[serde(default)]
    pub custom_base_url: Option<String>,
    #[serde(default)]
    pub custom_model: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// Canonical config structs — NO legacy fields
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VisionProfileMode {
    #[default]
    FollowText,
    Separate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisionApiConfig {
    #[serde(default)]
    pub mode: VisionProfileMode,
    #[serde(default = "default_vision_provider")]
    pub provider: RemoteProviderId,
    #[serde(default = "default_vision_qwen_region")]
    pub qwen_region: Option<QwenRegion>,
    #[serde(default)]
    pub base_url: String,
    #[serde(default = "default_vision_model")]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub custom_supports_vision: bool,
}

fn default_vision_provider() -> RemoteProviderId {
    RemoteProviderId::Qwen
}

fn default_vision_qwen_region() -> Option<QwenRegion> {
    Some(QwenRegion::Domestic)
}

fn default_vision_model() -> String {
    "qwen3.6-flash".to_string()
}

impl Default for VisionApiConfig {
    fn default() -> Self {
        Self {
            mode: VisionProfileMode::FollowText,
            provider: default_vision_provider(),
            qwen_region: default_vision_qwen_region(),
            base_url: String::new(),
            model: default_vision_model(),
            api_key: String::new(),
            custom_supports_vision: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedVisionProfile {
    pub provider: RemoteProviderId,
    pub qwen_region: Option<QwenRegion>,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub custom_supports_vision: bool,
}

impl ResolvedVisionProfile {
    pub fn supports_vision(&self) -> bool {
        if self.provider == RemoteProviderId::Custom {
            return self.custom_supports_vision;
        }
        self.provider
            .preset()
            .is_some_and(|preset| preset.supports_vision)
    }

    pub fn semantic_key(&self) -> (RemoteProviderId, String, String, bool) {
        (
            self.provider.clone(),
            self.base_url.clone(),
            self.model.clone(),
            self.custom_supports_vision,
        )
    }

    pub fn to_api_config(&self) -> ApiConfig {
        ApiConfig {
            provider: self.provider.clone(),
            qwen_region: self.qwen_region.clone(),
            base_url: self.base_url.clone(),
            api_key: self.api_key.clone(),
            text_model: String::new(),
            vlm_model: self.model.clone(),
            custom_supports_vision: self.custom_supports_vision,
            vision: VisionApiConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConfig {
    #[serde(default)]
    pub provider: RemoteProviderId,
    #[serde(default)]
    pub qwen_region: Option<QwenRegion>,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub text_model: String,
    #[serde(default)]
    pub vlm_model: String,
    #[serde(default)]
    pub custom_supports_vision: bool,
    #[serde(default)]
    pub vision: VisionApiConfig,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            provider: RemoteProviderId::default(),
            qwen_region: None,
            base_url: String::new(),
            api_key: String::new(),
            text_model: "deepseek-v4-flash".to_string(),
            vlm_model: String::new(),
            custom_supports_vision: false,
            vision: VisionApiConfig::default(),
        }
    }
}

impl ApiConfig {
    /// Effective base_url — resolves preset URL when user hasn't overridden.
    pub fn effective_base_url(&self) -> String {
        let configured = self.base_url.trim();
        if self.provider == RemoteProviderId::Qwen {
            let is_known_qwen_endpoint = configured.is_empty()
                || [QwenRegion::Domestic, QwenRegion::International]
                    .iter()
                    .any(|region| {
                        configured.trim_end_matches('/') == region.base_url().trim_end_matches('/')
                    });
            if is_known_qwen_endpoint {
                let inferred_region = if configured.trim_end_matches('/')
                    == QwenRegion::International.base_url().trim_end_matches('/')
                {
                    QwenRegion::International
                } else {
                    QwenRegion::Domestic
                };
                return self
                    .qwen_region
                    .as_ref()
                    .unwrap_or(&inferred_region)
                    .base_url()
                    .to_string();
            }
        }
        if !configured.is_empty() {
            return configured.trim_end_matches('/').to_string();
        }
        self.provider
            .preset()
            .map(|p| p.base_url.trim_end_matches('/').to_string())
            .unwrap_or_default()
    }

    pub fn effective_text_model(&self) -> String {
        let configured = self.text_model.trim();
        if !configured.is_empty() {
            return configured.to_string();
        }
        self.provider
            .preset()
            .map(|p| p.default_text_model.to_string())
            .unwrap_or_else(|| "deepseek-v4-flash".to_string())
    }

    /// Effective VLM model — returns vlm_model if non-empty, else preset default.
    /// Returns empty string if no VLM model is available.
    pub fn effective_vlm_model(&self) -> String {
        let configured = self.vlm_model.trim();
        if !configured.is_empty() {
            return configured.to_string();
        }
        self.provider
            .preset()
            .map(|p| p.default_vlm_model.to_string())
            .unwrap_or_default()
    }

    /// Whether this provider configuration supports vision (VLM) input.
    /// For known providers: uses preset.supports_vision.
    /// For Custom: requires custom_supports_vision AND effective_vlm_model non-empty.
    pub fn supports_vision(&self) -> bool {
        if self.provider == RemoteProviderId::Custom {
            return self.custom_supports_vision && !self.effective_vlm_model().is_empty();
        }
        self.provider.preset().is_some_and(|p| p.supports_vision)
    }

    pub fn resolved_vision_profile(&self) -> ResolvedVisionProfile {
        let request = if self.vision.mode == VisionProfileMode::Separate {
            ApiConfig {
                provider: self.vision.provider.clone(),
                qwen_region: self.vision.qwen_region.clone(),
                base_url: self.vision.base_url.clone(),
                api_key: self.vision.api_key.clone(),
                text_model: String::new(),
                vlm_model: self.vision.model.clone(),
                custom_supports_vision: self.vision.custom_supports_vision,
                vision: VisionApiConfig::default(),
            }
        } else {
            self.clone()
        };
        ResolvedVisionProfile {
            provider: request.provider.clone(),
            qwen_region: request.qwen_region.clone(),
            base_url: request.effective_base_url(),
            api_key: request.api_key.clone(),
            model: request.effective_vlm_model(),
            custom_supports_vision: request.custom_supports_vision,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationConfig {
    #[serde(default)]
    pub mode: TranslationMode,
    #[serde(default)]
    pub source_lang: SourceLang,
    #[serde(default)]
    pub target_lang: TargetLang,
    #[serde(default = "default_context_size")]
    pub context_size: usize,
}

fn default_context_size() -> usize {
    5
}

impl Default for TranslationConfig {
    fn default() -> Self {
        Self {
            mode: TranslationMode::default(),
            source_lang: SourceLang::default(),
            target_lang: TargetLang::default(),
            context_size: default_context_size(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerConfig {
    pub mode: TriggerMode,
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default = "default_auto_interval")]
    pub auto_interval_ms: u64,
    #[serde(default = "default_change_threshold")]
    pub change_threshold: u32,
}

fn default_hotkey() -> String {
    "F8".to_string()
}
fn default_auto_interval() -> u64 {
    500
}
fn default_change_threshold() -> u32 {
    4
}

impl Default for TriggerConfig {
    fn default() -> Self {
        Self {
            mode: TriggerMode::default(),
            hotkey: default_hotkey(),
            auto_interval_ms: default_auto_interval(),
            change_threshold: default_change_threshold(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub border_hue: u32,
    #[serde(default = "default_full")]
    pub border_opacity: u32,
    #[serde(default = "default_true")]
    pub show_border: bool,
    /// Measured physical-pixel insets from the frontend (center content area).
    /// [left, top, right, bottom] — when present, OCR uses these instead of
    /// computing from BORDER_PX/TITLE_H. Eliminates DPI rounding errors.
    #[serde(default)]
    pub measured_insets: Option<[i32; 4]>,
}

fn default_full() -> u32 {
    100
}
fn default_true() -> bool {
    true
}

impl Default for CaptureRegion {
    fn default() -> Self {
        Self {
            x: 200,
            y: 200,
            width: 640,
            height: 160,
            border_hue: 0,
            border_opacity: 100,
            show_border: true,
            measured_insets: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayConfig {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default = "default_bg_hue")]
    pub bg_hue: u32,
    #[serde(default = "default_bg_opacity")]
    pub bg_opacity: u32,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_font_color")]
    pub font_color: String,
}

fn default_bg_hue() -> u32 {
    205
}
fn default_bg_opacity() -> u32 {
    72
}
fn default_font_family() -> String {
    "Microsoft YaHei UI".to_string()
}
fn default_font_size() -> u32 {
    18
}
fn default_font_color() -> String {
    "#ffffff".to_string()
}

impl Default for DisplayConfig {
    fn default() -> Self {
        Self {
            x: 180,
            y: 380,
            width: 720,
            height: 220,
            bg_hue: default_bg_hue(),
            bg_opacity: default_bg_opacity(),
            font_family: default_font_family(),
            font_size: default_font_size(),
            font_color: default_font_color(),
        }
    }
}

// ── Canonical AppConfig — version=3, no legacy fields ──────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub enum ThemeMode {
    #[default]
    #[serde(rename = "system")]
    System,
    #[serde(rename = "light")]
    Light,
    #[serde(rename = "dark")]
    Dark,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UiConfig {
    #[serde(default)]
    pub theme: ThemeMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "config_version")]
    pub version: u32,
    #[serde(default)]
    pub api: ApiConfig,
    #[serde(default)]
    pub trigger: TriggerConfig,
    #[serde(default)]
    pub translation: TranslationConfig,
    #[serde(default)]
    pub capture_region: CaptureRegion,
    #[serde(default)]
    pub display: DisplayConfig,
    #[serde(default)]
    pub local: LocalConfig,
    #[serde(default)]
    pub ui: UiConfig,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default)]
    pub onboarding_revision: u32,
}

fn config_version() -> u32 {
    3
}

pub const CURRENT_ONBOARDING_REVISION: u32 = 1;

pub fn onboarding_needed(config: &AppConfig) -> bool {
    !config.onboarding_completed || config.onboarding_revision < CURRENT_ONBOARDING_REVISION
}

pub fn mark_onboarding_completed(config: &mut AppConfig) {
    config.onboarding_completed = true;
    config.onboarding_revision = CURRENT_ONBOARDING_REVISION;
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: config_version(),
            api: ApiConfig::default(),
            trigger: TriggerConfig::default(),
            translation: TranslationConfig::default(),
            capture_region: CaptureRegion::default(),
            display: DisplayConfig::default(),
            local: LocalConfig::default(),
            ui: UiConfig::default(),
            onboarding_completed: false,
            onboarding_revision: 0,
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Private legacy DTOs — used ONLY for migration, never in runtime types
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LegacyApiMode {
    #[serde(alias = "proxy")]
    Custom,
    CustomOpenai,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LegacyTranslationEngine {
    Online,
    Offline,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LegacyTranslationDirection {
    EnZh,
    JaZh,
    JaEn,
    ZhEn,
}

impl LegacyTranslationDirection {
    fn to_lang_pair(&self) -> (SourceLang, TargetLang) {
        match self {
            Self::EnZh => (SourceLang::En, TargetLang::Zh),
            Self::JaZh => (SourceLang::Ja, TargetLang::Zh),
            Self::JaEn => (SourceLang::Ja, TargetLang::En),
            Self::ZhEn => (SourceLang::Zh, TargetLang::En),
        }
    }
}

#[derive(Debug, Deserialize)]
struct LegacyApiConfig {
    #[serde(default)]
    mode: Option<LegacyApiMode>,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default, alias = "model")]
    legacy_model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LegacyTranslationConfig {
    #[serde(default)]
    engine: Option<LegacyTranslationEngine>,
    #[serde(default)]
    direction: Option<LegacyTranslationDirection>,
    #[serde(default)]
    context_size: Option<usize>,
}

/// Private DTO for deserializing v1/v2 config JSON.
/// All fields are Option so partial old configs still parse.
#[derive(Debug, Deserialize)]
struct LegacyV2Config {
    #[serde(default)]
    api: Option<LegacyApiConfig>,
    #[serde(default)]
    trigger: Option<LegacyTriggerConfig>,
    #[serde(default)]
    translation: Option<LegacyTranslationConfig>,
    #[serde(default)]
    capture_region: Option<CaptureRegion>,
    #[serde(default)]
    display: Option<DisplayConfig>,
    #[serde(default)]
    onboarding_completed: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct LegacyTriggerConfig {
    #[serde(default)]
    mode: Option<TriggerMode>,
    #[serde(default)]
    hotkey: Option<String>,
    #[serde(default)]
    auto_interval_ms: Option<u64>,
    #[serde(default)]
    change_threshold: Option<u32>,
}

// ══════════════════════════════════════════════════════════════════════════════
// Migration: v2 JSON → canonical v3 AppConfig
// ══════════════════════════════════════════════════════════════════════════════

/// Try to deserialize as canonical v3 first. If that fails, try legacy v2 migration.
/// Returns (AppConfig, was_migrated).
pub fn load_and_migrate_config(json: &str) -> Result<(AppConfig, bool), serde_json::Error> {
    // First try canonical v3 deserialization
    if let Ok(mut cfg) = serde_json::from_str::<AppConfig>(json) {
        // Check if it's actually a v3 config (version >= 3 and no legacy fields)
        if cfg.version >= 3 {
            let value = serde_json::from_str::<serde_json::Value>(json)?;
            let missing_additive_fields = value.get("onboarding_revision").is_none()
                || value.pointer("/api/vision").is_none();
            let mut changed = normalize_canonical_config(&mut cfg) || missing_additive_fields;
            changed |= json.contains("\"qwen3_4_b\"") || json.contains("\"qwen3_8_b\"");
            return Ok((cfg, changed));
        }
    }

    // Try legacy v2 deserialization
    let legacy: LegacyV2Config = serde_json::from_str(json)?;
    let (mut cfg, mut changed) = migrate_legacy_config(legacy);
    changed |= normalize_canonical_config(&mut cfg);
    Ok((cfg, changed))
}

fn normalize_canonical_config(cfg: &mut AppConfig) -> bool {
    let mut changed = normalize_qwen_profile(
        &cfg.api.provider,
        &mut cfg.api.qwen_region,
        &mut cfg.api.base_url,
    );
    changed |= normalize_qwen_profile(
        &cfg.api.vision.provider,
        &mut cfg.api.vision.qwen_region,
        &mut cfg.api.vision.base_url,
    );
    changed
}

fn normalize_qwen_profile(
    provider: &RemoteProviderId,
    qwen_region: &mut Option<QwenRegion>,
    base_url: &mut String,
) -> bool {
    let mut changed = false;
    if *provider == RemoteProviderId::Qwen {
        if qwen_region.is_none() {
            let inferred = if base_url.trim_end_matches('/')
                == QwenRegion::International.base_url().trim_end_matches('/')
            {
                QwenRegion::International
            } else {
                QwenRegion::Domestic
            };
            *qwen_region = Some(inferred);
            changed = true;
        }

        let is_known_endpoint = [QwenRegion::Domestic, QwenRegion::International]
            .iter()
            .any(|region| {
                base_url.trim_end_matches('/') == region.base_url().trim_end_matches('/')
            });
        if is_known_endpoint {
            base_url.clear();
            changed = true;
        }
    } else if qwen_region.take().is_some() {
        changed = true;
    }
    changed
}

/// Migrate a LegacyV2Config to canonical v3 AppConfig.
fn migrate_legacy_config(legacy: LegacyV2Config) -> (AppConfig, bool) {
    let mut changed = false;
    let mut cfg = AppConfig::default();

    // ── API migration ──
    if let Some(api) = legacy.api {
        // api_key
        if let Some(key) = api.api_key {
            if !key.is_empty() {
                cfg.api.api_key = key;
            }
        }

        // base_url
        let base_url = api.base_url.unwrap_or_default();
        cfg.api.base_url = base_url.clone();

        // Provider detection: custom_openai + unknown endpoint → Custom
        let is_custom_openai = matches!(api.mode, Some(LegacyApiMode::CustomOpenai));
        let has_base_url = !base_url.is_empty();

        if is_custom_openai && has_base_url {
            // Unknown endpoint → Custom, preserve endpoint
            if RemoteProviderId::from_base_url(&base_url).is_some() {
                // Known provider URL — detect provider
                cfg.api.provider = RemoteProviderId::from_base_url(&base_url).unwrap();
            } else {
                // Unknown → Custom
                cfg.api.provider = RemoteProviderId::Custom;
            }
            changed = true;
        } else if has_base_url {
            // Try to detect provider from base_url
            if let Some(detected) = RemoteProviderId::from_base_url(&base_url) {
                cfg.api.provider = detected;
                changed = true;
            }
        }

        // Model migration: only migrate deepseek-chat for non-Custom providers
        let model = api.legacy_model.unwrap_or_default();
        if !model.is_empty() {
            if model == "deepseek-chat" && cfg.api.provider != RemoteProviderId::Custom {
                // Migrate away from deprecated model for known providers
                cfg.api.text_model = "deepseek-v4-flash".to_string();
                changed = true;
            } else {
                // Preserve model as-is (including "deepseek-chat" for Custom)
                cfg.api.text_model = model;
            }
        }
    }

    // ── Translation migration ──
    if let Some(trans) = legacy.translation {
        // Direction → source_lang/target_lang
        if let Some(dir) = trans.direction {
            let (src, tgt) = dir.to_lang_pair();
            cfg.translation.source_lang = src;
            cfg.translation.target_lang = tgt;
            changed = true;
        }

        // Engine → mode
        if let Some(engine) = trans.engine {
            match engine {
                LegacyTranslationEngine::Online => {
                    cfg.translation.mode = TranslationMode::Speed;
                }
                LegacyTranslationEngine::Offline => {
                    cfg.translation.mode = TranslationMode::Local;
                }
            }
            changed = true;
        }

        if let Some(ctx) = trans.context_size {
            cfg.translation.context_size = ctx;
        }
    }

    // ── Trigger migration ──
    if let Some(trigger) = legacy.trigger {
        if let Some(mode) = trigger.mode {
            cfg.trigger.mode = mode;
        }
        if let Some(hk) = trigger.hotkey {
            cfg.trigger.hotkey = hk;
        }
        if let Some(interval) = trigger.auto_interval_ms {
            cfg.trigger.auto_interval_ms = interval;
        }
        if let Some(thresh) = trigger.change_threshold {
            cfg.trigger.change_threshold = thresh;
        }
    }

    // ── Region/Display migration (fields are compatible) ──
    if let Some(region) = legacy.capture_region {
        cfg.capture_region = region;
    }
    if let Some(display) = legacy.display {
        cfg.display = display;
    }
    if let Some(ob) = legacy.onboarding_completed {
        cfg.onboarding_completed = ob;
    }

    // ── Display style migration (one-time) ──
    if cfg.display.x == 200
        && cfg.display.y == 380
        && cfg.display.width == 640
        && cfg.display.height == 200
        && cfg.display.bg_hue == 210
        && cfg.display.bg_opacity == 80
    {
        cfg.display.x = 180;
        cfg.display.y = 380;
        cfg.display.width = 720;
        cfg.display.height = 220;
        cfg.display.bg_hue = 205;
        cfg.display.bg_opacity = 72;
        changed = true;
    }

    cfg.version = 3;
    (cfg, changed)
}

// ══════════════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_matches_expected_runtime_defaults() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.version, 3);
        assert!(matches!(cfg.api.provider, RemoteProviderId::DeepSeek));
        assert_eq!(cfg.api.text_model, "deepseek-v4-flash");
        assert!(cfg.api.api_key.is_empty());
        assert!(matches!(cfg.trigger.mode, TriggerMode::Manual));
        assert_eq!(cfg.trigger.hotkey, "F8");
        assert_eq!(cfg.translation.context_size, 5);
        assert!(matches!(cfg.translation.mode, TranslationMode::Speed));
        assert!(matches!(cfg.translation.source_lang, SourceLang::En));
        assert!(matches!(cfg.translation.target_lang, TargetLang::Zh));
        assert_eq!(cfg.onboarding_revision, 0);
    }

    #[test]
    fn early_v3_config_defaults_new_onboarding_field() {
        let raw = r#"{
            "version": 3,
            "trigger": {"mode":"manual","hotkey":"F8","auto_interval_ms":500,"change_threshold":4},
            "onboarding_completed": true
        }"#;
        let (cfg, migrated) = load_and_migrate_config(raw).unwrap();
        assert!(
            migrated,
            "missing additive v3 fields must be persisted once"
        );
        assert_eq!(cfg.onboarding_revision, 0);
        assert!(onboarding_needed(&cfg));
    }

    #[test]
    fn default_vision_profile_follows_text_and_prefills_qwen() {
        let cfg = ApiConfig::default();
        assert_eq!(cfg.vision.mode, VisionProfileMode::FollowText);
        assert_eq!(cfg.vision.provider, RemoteProviderId::Qwen);
        assert_eq!(cfg.vision.qwen_region, Some(QwenRegion::Domestic));
        assert_eq!(cfg.vision.model, "qwen3.6-flash");
        assert!(cfg.vision.api_key.is_empty());
    }

    #[test]
    fn early_v3_config_defaults_vision_profile_and_is_persisted_once() {
        let raw = r#"{
            "version": 3,
            "api": {
                "provider": "deepseek",
                "api_key": "keep-me",
                "text_model": "deepseek-v4-flash",
                "vlm_model": ""
            }
        }"#;
        let (cfg, changed) = load_and_migrate_config(raw).unwrap();
        assert!(changed);
        assert_eq!(cfg.api.api_key, "keep-me");
        assert_eq!(cfg.api.vision.mode, VisionProfileMode::FollowText);
    }

    #[test]
    fn separate_vision_profile_resolves_without_text_credentials() {
        let api = ApiConfig {
            api_key: "text-secret".to_string(),
            vision: VisionApiConfig {
                mode: VisionProfileMode::Separate,
                api_key: "vision-secret".to_string(),
                ..VisionApiConfig::default()
            },
            ..ApiConfig::default()
        };
        let resolved = api.resolved_vision_profile();
        assert_eq!(resolved.provider, RemoteProviderId::Qwen);
        assert_eq!(resolved.api_key, "vision-secret");
        assert_eq!(resolved.model, "qwen3.6-flash");
        assert_eq!(resolved.base_url, QwenRegion::Domestic.base_url());
    }

    #[test]
    fn follow_text_resolution_uses_outer_profile_only() {
        let api = ApiConfig {
            provider: RemoteProviderId::Gemini,
            api_key: "text-secret".to_string(),
            vlm_model: "gemini-3.5-flash".to_string(),
            ..ApiConfig::default()
        };
        let resolved = api.resolved_vision_profile();
        assert_eq!(resolved.provider, RemoteProviderId::Gemini);
        assert_eq!(resolved.api_key, "text-secret");
        assert_eq!(resolved.model, "gemini-3.5-flash");
    }

    #[test]
    fn vision_profile_mode_wire_values_are_stable() {
        assert_eq!(
            serde_json::to_value(VisionProfileMode::FollowText).unwrap(),
            serde_json::json!("follow_text")
        );
        assert_eq!(
            serde_json::to_value(VisionProfileMode::Separate).unwrap(),
            serde_json::json!("separate")
        );
    }

    #[test]
    fn follow_mode_round_trip_preserves_inactive_independent_profile() {
        let mut api = ApiConfig::default();
        api.vision.mode = VisionProfileMode::FollowText;
        api.vision.provider = RemoteProviderId::Gemini;
        api.vision.base_url = "https://vision.example/v1".to_string();
        api.vision.api_key = "vision-secret".to_string();
        api.vision.model = "gemini-3.5-flash".to_string();
        let json = serde_json::to_string(&api).unwrap();
        let loaded: ApiConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.vision, api.vision);
    }

    #[test]
    fn independent_qwen_endpoint_normalizes_to_region() {
        let mut cfg = AppConfig::default();
        cfg.api.vision.mode = VisionProfileMode::Separate;
        cfg.api.vision.qwen_region = None;
        cfg.api.vision.base_url = QwenRegion::International.base_url().to_string();
        assert!(normalize_canonical_config(&mut cfg));
        assert_eq!(cfg.api.vision.qwen_region, Some(QwenRegion::International));
        assert!(cfg.api.vision.base_url.is_empty());
    }

    #[test]
    fn completed_current_onboarding_revision_is_not_replayed() {
        let cfg = AppConfig {
            onboarding_completed: true,
            onboarding_revision: CURRENT_ONBOARDING_REVISION,
            ..AppConfig::default()
        };
        assert!(!onboarding_needed(&cfg));
    }

    #[test]
    fn completing_onboarding_records_current_revision() {
        let mut cfg = AppConfig::default();
        mark_onboarding_completed(&mut cfg);
        assert!(cfg.onboarding_completed);
        assert_eq!(cfg.onboarding_revision, CURRENT_ONBOARDING_REVISION);
    }

    // ── Provider wire ID tests ──

    #[test]
    fn provider_wire_id_roundtrip() {
        let cases = vec![
            (RemoteProviderId::DeepSeek, "\"deepseek\""),
            (RemoteProviderId::Qwen, "\"qwen\""),
            (RemoteProviderId::Gemini, "\"gemini\""),
            (RemoteProviderId::Groq, "\"groq\""),
            (RemoteProviderId::OpenAI, "\"openai\""),
            (RemoteProviderId::Custom, "\"custom\""),
        ];
        for (variant, expected_json) in cases {
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, expected_json, "serialize {:?}", variant);
            let parsed: RemoteProviderId = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, variant, "deserialize {:?}", variant);
        }
    }

    #[test]
    fn provider_wire_id_accepts_legacy_aliases() {
        let deep_seek: RemoteProviderId = serde_json::from_str("\"deep_seek\"").unwrap();
        assert_eq!(deep_seek, RemoteProviderId::DeepSeek);
        let open_ai: RemoteProviderId = serde_json::from_str("\"open_ai\"").unwrap();
        assert_eq!(open_ai, RemoteProviderId::OpenAI);
    }

    #[test]
    fn provider_wire_id_in_full_config_roundtrip() {
        let mut cfg = AppConfig::default();
        cfg.api.provider = RemoteProviderId::Qwen;
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"qwen\""));
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.api.provider, RemoteProviderId::Qwen);
    }

    #[test]
    fn get_presets_uses_canonical_wire_ids() {
        for preset in RemoteProviderId::all_presets() {
            let json = serde_json::to_string(&preset.id).unwrap();
            let wire = json.trim_matches('"');
            assert!(!wire.contains('_'), "preset {:?} wire: {}", preset.id, wire);
        }
    }

    // ── Canonical AppConfig has no legacy fields in serialized output ──

    #[test]
    fn canonical_config_serializes_no_legacy_fields() {
        let cfg = AppConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(
            !json.contains("\"engine\""),
            "should not have engine: {json}"
        );
        assert!(
            !json.contains("\"direction\""),
            "should not have direction: {json}"
        );
        assert!(
            !json.contains("\"mode\":\"custom\""),
            "should not have api.mode: {json}"
        );
        assert!(
            !json.contains("\"legacy_model\""),
            "should not have legacy_model: {json}"
        );
        assert!(
            !json.contains("\"offline_model_downloaded\""),
            "should not have offline_model_downloaded: {json}"
        );
        assert!(
            !json.contains("\"paddle_models_downloaded\""),
            "should not have paddle_models_downloaded: {json}"
        );
    }

    // ── v2→v3 migration tests ──

    #[test]
    fn migrate_v2_no_direction_defaults_to_en_zh() {
        let raw = r##"{
            "version": 2,
            "api": {"mode": "custom", "api_key": "sk-test", "model": "deepseek-chat"},
            "translation": {"engine": "online", "context_size": 5}
        }"##;
        let (cfg, changed) = load_and_migrate_config(raw).unwrap();
        assert!(changed);
        assert_eq!(cfg.version, 3);
        assert!(matches!(cfg.translation.source_lang, SourceLang::En));
        assert!(matches!(cfg.translation.target_lang, TargetLang::Zh));
        assert!(matches!(cfg.translation.mode, TranslationMode::Speed));
        assert_eq!(cfg.api.text_model, "deepseek-v4-flash");
    }

    #[test]
    fn migrate_v2_with_direction_ja_zh() {
        let raw = r#"{
            "version": 2,
            "api": {"mode": "custom", "api_key": "sk-test", "model": "deepseek-chat"},
            "translation": {"engine": "online", "direction": "ja_zh", "context_size": 3}
        }"#;
        let (cfg, _) = load_and_migrate_config(raw).unwrap();
        assert!(matches!(cfg.translation.source_lang, SourceLang::Ja));
        assert!(matches!(cfg.translation.target_lang, TargetLang::Zh));
    }

    // Regression: offline→Local must persist through serialize→reload.
    #[test]
    fn migrate_offline_persists_through_serialize_reload() {
        let raw = r#"{
            "version": 2,
            "api": {"mode": "custom", "api_key": "sk-test", "model": "deepseek-chat"},
            "translation": {"engine": "offline", "context_size": 5}
        }"#;
        let (cfg1, _) = load_and_migrate_config(raw).unwrap();
        assert!(
            matches!(cfg1.translation.mode, TranslationMode::Local),
            "first load must be Local"
        );

        // Serialize v3
        let json = serde_json::to_string(&cfg1).unwrap();
        assert!(json.contains("\"local\""), "serialized must contain local");

        // Reload — must still be Local, NOT Speed
        let (cfg2, migrated) = load_and_migrate_config(&json).unwrap();
        assert!(!migrated, "reload should not need migration");
        assert!(
            matches!(cfg2.translation.mode, TranslationMode::Local),
            "reload must still be Local, not Speed"
        );
    }

    // Regression: preserve Custom endpoint/model fidelity.
    #[test]
    fn migrate_custom_openai_unknown_endpoint_becomes_custom() {
        let raw = r#"{
            "version": 2,
            "api": {"mode": "custom_openai", "base_url": "https://my-proxy.com/v1", "api_key": "k", "model": "my-model"},
            "translation": {"engine": "online"}
        }"#;
        let (cfg, _) = load_and_migrate_config(raw).unwrap();
        assert!(
            matches!(cfg.api.provider, RemoteProviderId::Custom),
            "unknown endpoint must become Custom"
        );
        assert_eq!(cfg.api.base_url, "https://my-proxy.com/v1");
        assert_eq!(cfg.api.text_model, "my-model");
    }

    #[test]
    fn migrate_custom_model_named_deepseek_chat_is_preserved() {
        let raw = r#"{
            "version": 2,
            "api": {"mode": "custom_openai", "base_url": "https://my-proxy.com/v1", "api_key": "k", "model": "deepseek-chat"},
            "translation": {"engine": "online"}
        }"#;
        let (cfg, _) = load_and_migrate_config(raw).unwrap();
        assert!(
            matches!(cfg.api.provider, RemoteProviderId::Custom),
            "Custom provider"
        );
        assert_eq!(
            cfg.api.text_model, "deepseek-chat",
            "Custom model alias must be preserved"
        );
    }

    #[test]
    fn migrate_known_base_url_detects_provider() {
        let raw = r#"{
            "version": 2,
            "api": {"mode": "custom_openai", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "api_key": "k", "model": "qwen-turbo"},
            "translation": {"engine": "online"}
        }"#;
        let (cfg, _) = load_and_migrate_config(raw).unwrap();
        assert!(matches!(cfg.api.provider, RemoteProviderId::Qwen));
    }

    // Full round-trip regression: offline→Local persists.
    #[test]
    fn roundtrip_full_v2_offline_stays_local() {
        let raw = r##"{
            "version": 2,
            "api": {"mode": "custom", "base_url": "", "api_key": "sk-test123", "model": "deepseek-chat"},
            "trigger": {"mode": "auto", "hotkey": "F9", "auto_interval_ms": 1000, "change_threshold": 6},
            "translation": {"engine": "offline", "direction": "ja_zh", "context_size": 8},
            "capture_region": {"x": 100, "y": 100, "width": 800, "height": 300, "border_hue": 120, "border_opacity": 80, "show_border": true},
            "display": {"x": 50, "y": 500, "width": 600, "height": 200, "bg_hue": 200, "bg_opacity": 60, "font_family": "SimHei", "font_size": 20, "font_color": "#ff0000"},
            "onboarding_completed": true
        }"##;

        // Load + migrate
        let (cfg1, _) = load_and_migrate_config(raw).unwrap();
        assert_eq!(cfg1.version, 3);
        assert!(matches!(cfg1.translation.mode, TranslationMode::Local));
        assert!(matches!(cfg1.translation.source_lang, SourceLang::Ja));
        assert!(matches!(cfg1.translation.target_lang, TargetLang::Zh));
        assert_eq!(cfg1.api.text_model, "deepseek-v4-flash");

        // Serialize v3
        let json = serde_json::to_string(&cfg1).unwrap();

        // Reload — must still be Local
        let (cfg2, migrated) = load_and_migrate_config(&json).unwrap();
        assert!(!migrated, "v3 reload should not need migration");
        assert!(matches!(cfg2.translation.mode, TranslationMode::Local));
        assert!(matches!(cfg2.translation.source_lang, SourceLang::Ja));
        assert!(matches!(cfg2.translation.target_lang, TargetLang::Zh));
        assert_eq!(cfg2.trigger.hotkey, "F9");
        assert_eq!(cfg2.translation.context_size, 8);
        assert!(cfg2.onboarding_completed);
    }

    #[test]
    fn migrate_deepseek_chat_for_default_provider() {
        let raw = r#"{
            "version": 2,
            "api": {"mode": "custom", "api_key": "sk-test", "model": "deepseek-chat"},
            "translation": {"engine": "online"}
        }"#;
        let (cfg, _) = load_and_migrate_config(raw).unwrap();
        assert_eq!(cfg.api.text_model, "deepseek-v4-flash");
    }

    #[test]
    fn v3_config_loads_without_migration() {
        let cfg = AppConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let (loaded, migrated) = load_and_migrate_config(&json).unwrap();
        assert!(!migrated);
        assert_eq!(loaded.version, 3);
    }

    // ── Effective URL/model tests ──

    #[test]
    fn api_config_effective_base_url_uses_preset_when_empty() {
        let cfg = ApiConfig {
            provider: RemoteProviderId::Qwen,
            base_url: String::new(),
            ..Default::default()
        };
        assert_eq!(
            cfg.effective_base_url(),
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        );
    }

    #[test]
    fn api_config_effective_base_url_prefers_user_override() {
        let cfg = ApiConfig {
            provider: RemoteProviderId::DeepSeek,
            base_url: "https://custom.api.com/v1".to_string(),
            ..Default::default()
        };
        assert_eq!(cfg.effective_base_url(), "https://custom.api.com/v1");
    }

    #[test]
    fn api_config_effective_text_model_uses_preset_default() {
        let cfg = ApiConfig {
            provider: RemoteProviderId::Gemini,
            text_model: String::new(),
            ..Default::default()
        };
        assert_eq!(cfg.effective_text_model(), "gemini-3.1-flash-lite");
    }

    #[test]
    fn provider_from_base_url_identifies_known_providers() {
        assert!(matches!(
            RemoteProviderId::from_base_url("https://api.deepseek.com"),
            Some(RemoteProviderId::DeepSeek)
        ));
        assert!(matches!(
            RemoteProviderId::from_base_url("https://dashscope.aliyuncs.com/compatible-mode/v1"),
            Some(RemoteProviderId::Qwen)
        ));
        assert!(RemoteProviderId::from_base_url("https://custom.api.com").is_none());
    }

    // ── SourceLang OCR validation tests ──

    #[test]
    fn source_lang_auto_rejects_ocr() {
        assert!(SourceLang::Auto.validate_for_ocr().is_err());
    }

    #[test]
    fn source_lang_en_returns_en_tag() {
        assert_eq!(SourceLang::En.validate_for_ocr().unwrap(), "en-US");
    }

    #[test]
    fn source_lang_ja_returns_ja_tag() {
        assert_eq!(SourceLang::Ja.validate_for_ocr().unwrap(), "ja-JP");
    }

    #[test]
    fn target_lang_ja_display_name_is_japanese_script() {
        assert_eq!(TargetLang::Ja.display_name(), "日本語");
    }

    #[test]
    fn target_lang_ja_wire_id_is_ja() {
        assert_eq!(TargetLang::Ja.wire_id(), "ja");
        assert_eq!(serde_json::to_string(&TargetLang::Ja).unwrap(), "\"ja\"");
    }

    #[test]
    fn source_lang_zh_returns_zh_hans_tag() {
        assert_eq!(SourceLang::Zh.validate_for_ocr().unwrap(), "zh-Hans");
    }

    #[test]
    fn target_language_prompt_names_cover_en_ja_zh() {
        assert_eq!(TargetLang::En.display_name(), "English");
        assert_eq!(TargetLang::Ja.display_name(), "日本語");
        assert_eq!(TargetLang::Zh.display_name(), "Simplified Chinese");
    }

    #[test]
    fn target_language_wire_id_matches_serde_rename() {
        for lang in [TargetLang::Zh, TargetLang::En, TargetLang::Ja] {
            let serde_wire = serde_json::to_string(&lang).unwrap();
            assert_eq!(format!("\"{}\"", lang.wire_id()), serde_wire);
        }
    }

    #[test]
    fn canonical_enum_wire_ids_are_explicit_and_stable() {
        assert_eq!(serde_json::to_string(&SourceLang::En).unwrap(), "\"en\"");
        assert_eq!(serde_json::to_string(&TargetLang::Ja).unwrap(), "\"ja\"");
        assert_eq!(
            serde_json::to_string(&TranslationMode::Quality).unwrap(),
            "\"quality\""
        );
        assert_eq!(
            serde_json::to_string(&TriggerMode::Manual).unwrap(),
            "\"manual\""
        );
        assert_eq!(
            serde_json::to_string(&QwenRegion::International).unwrap(),
            "\"international\""
        );
        assert_eq!(
            serde_json::to_string(&LocalBackend::BundledLlamaCpp).unwrap(),
            "\"bundled_llama_cpp\""
        );
    }

    // ── LocalConfig tests ──

    #[test]
    fn local_config_defaults_to_bundled_llama_cpp() {
        let cfg = LocalConfig::default();
        assert!(matches!(cfg.backend, LocalBackend::BundledLlamaCpp));
        assert!(matches!(cfg.model, LocalModel::Qwen3_4B));
    }

    #[test]
    fn local_config_serializes_in_app_config() {
        let cfg = AppConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"local\""));
        assert!(json.contains("\"bundled_llama_cpp\""));
        assert!(
            json.contains("qwen3_4b"),
            "JSON should contain model identifier: {json}"
        );
        assert!(!json.contains("runtime_ready"));
        assert!(!json.contains("model_downloaded"));
    }

    #[test]
    fn local_model_wire_ids_roundtrip() {
        for (model, expected) in [
            (LocalModel::Qwen3_4B, "\"qwen3_4b\""),
            (LocalModel::Qwen3_8B, "\"qwen3_8b\""),
            (LocalModel::Custom, "\"custom\""),
        ] {
            let json = serde_json::to_string(&model).unwrap();
            assert_eq!(json, expected);
            let decoded: LocalModel = serde_json::from_str(&json).unwrap();
            assert_eq!(decoded, model);
        }
    }

    #[test]
    fn qwen_region_selects_effective_endpoint() {
        let mut api = ApiConfig {
            provider: RemoteProviderId::Qwen,
            qwen_region: Some(QwenRegion::International),
            ..ApiConfig::default()
        };
        assert_eq!(
            api.effective_base_url(),
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
        );

        // Known preset URLs saved by early V3 builds are normalized by the region.
        api.base_url = QwenRegion::Domestic.base_url().to_string();
        assert_eq!(
            api.effective_base_url(),
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
        );

        // A non-preset endpoint remains an explicit escape hatch.
        api.base_url = "https://workspace.example.com/compatible-mode/v1".to_string();
        assert_eq!(
            api.effective_base_url(),
            "https://workspace.example.com/compatible-mode/v1"
        );
    }

    #[test]
    fn qwen_international_endpoint_maps_to_qwen_provider() {
        assert_eq!(
            RemoteProviderId::from_base_url(QwenRegion::International.base_url()),
            Some(RemoteProviderId::Qwen)
        );
    }

    #[test]
    fn early_v3_qwen_international_config_is_canonicalized() {
        let raw = r##"{
            "version": 3,
            "api": {
                "provider": "qwen",
                "base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
                "api_key": "",
                "text_model": "qwen3.6-flash",
                "vlm_model": "qwen3.6-flash",
                "custom_supports_vision": false
            },
            "trigger": {"mode":"manual","hotkey":"F8","auto_interval_ms":500,"change_threshold":4},
            "translation": {"mode":"speed","source_lang":"en","target_lang":"zh","context_size":5},
            "capture_region": {"x":0,"y":0,"width":640,"height":160,"border_hue":0,"border_opacity":100,"show_border":true},
            "display": {"x":0,"y":0,"width":720,"height":220,"bg_hue":205,"bg_opacity":72,"font_family":"Arial","font_size":18,"font_color":"#ffffff"},
            "local": {"backend":"bundled_llama_cpp","model":"qwen3_4_b","runtime_ready":true},
            "onboarding_completed": true
        }"##;

        let (cfg, changed) = load_and_migrate_config(raw).unwrap();
        assert!(changed);
        assert_eq!(cfg.api.qwen_region, Some(QwenRegion::International));
        assert!(cfg.api.base_url.is_empty());
        assert_eq!(cfg.local.model, LocalModel::Qwen3_4B);

        let saved = serde_json::to_string(&cfg).unwrap();
        assert!(!saved.contains("qwen3_4_b"));
        assert!(!saved.contains("runtime_ready"));
        let (reloaded, changed_again) = load_and_migrate_config(&saved).unwrap();
        assert!(!changed_again);
        assert_eq!(reloaded.api.qwen_region, Some(QwenRegion::International));
    }

    // ── effective_vlm_model tests ──

    #[test]
    fn effective_vlm_model_uses_configured_value() {
        let cfg = ApiConfig {
            provider: RemoteProviderId::Qwen,
            vlm_model: "qwen3.6-plus".to_string(),
            ..Default::default()
        };
        assert_eq!(cfg.effective_vlm_model(), "qwen3.6-plus");
    }

    #[test]
    fn effective_vlm_model_falls_back_to_preset_default() {
        let cfg = ApiConfig {
            provider: RemoteProviderId::Qwen,
            vlm_model: String::new(),
            ..Default::default()
        };
        assert_eq!(cfg.effective_vlm_model(), "qwen3.6-flash");
    }

    #[test]
    fn effective_vlm_model_empty_for_deepseek() {
        let cfg = ApiConfig {
            provider: RemoteProviderId::DeepSeek,
            vlm_model: String::new(),
            ..Default::default()
        };
        assert_eq!(cfg.effective_vlm_model(), "");
    }

    #[test]
    fn effective_vlm_model_gemini_default() {
        let cfg = ApiConfig {
            provider: RemoteProviderId::Gemini,
            vlm_model: String::new(),
            ..Default::default()
        };
        assert_eq!(cfg.effective_vlm_model(), "gemini-3.5-flash");
    }

    // ── supports_vision tests ──

    #[test]
    fn supports_vision_qwen() {
        let cfg = ApiConfig {
            provider: RemoteProviderId::Qwen,
            ..Default::default()
        };
        assert!(cfg.supports_vision());
    }

    #[test]
    fn supports_vision_gemini() {
        let cfg = ApiConfig {
            provider: RemoteProviderId::Gemini,
            ..Default::default()
        };
        assert!(cfg.supports_vision());
    }

    #[test]
    fn supports_vision_deepseek_false() {
        let cfg = ApiConfig {
            provider: RemoteProviderId::DeepSeek,
            ..Default::default()
        };
        assert!(!cfg.supports_vision());
    }

    #[test]
    fn supports_vision_groq_false() {
        let cfg = ApiConfig {
            provider: RemoteProviderId::Groq,
            ..Default::default()
        };
        assert!(!cfg.supports_vision());
    }

    #[test]
    fn supports_vision_custom_requires_both_flags() {
        // custom_supports_vision=true but no vlm_model → false
        let cfg = ApiConfig {
            provider: RemoteProviderId::Custom,
            custom_supports_vision: true,
            vlm_model: String::new(),
            ..Default::default()
        };
        assert!(!cfg.supports_vision());

        // custom_supports_vision=true AND vlm_model set → true
        let cfg = ApiConfig {
            provider: RemoteProviderId::Custom,
            custom_supports_vision: true,
            vlm_model: "my-vlm".to_string(),
            ..Default::default()
        };
        assert!(cfg.supports_vision());

        // custom_supports_vision=false even with vlm_model → false
        let cfg = ApiConfig {
            provider: RemoteProviderId::Custom,
            custom_supports_vision: false,
            vlm_model: "my-vlm".to_string(),
            ..Default::default()
        };
        assert!(!cfg.supports_vision());
    }

    // ── Theme mode tests ──

    #[test]
    fn theme_mode_defaults_to_system() {
        let cfg = AppConfig::default();
        assert!(matches!(cfg.ui.theme, ThemeMode::System));
    }

    #[test]
    fn theme_mode_serde_roundtrip() {
        for (mode, expected) in [
            (ThemeMode::System, "\"system\""),
            (ThemeMode::Light, "\"light\""),
            (ThemeMode::Dark, "\"dark\""),
        ] {
            let json = serde_json::to_string(&mode).unwrap();
            assert_eq!(json, expected);
            let parsed: ThemeMode = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, mode);
        }
    }

    #[test]
    fn ui_config_serializes_in_app_config() {
        let cfg = AppConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"ui\""));
        assert!(json.contains("\"system\""));
    }
}
