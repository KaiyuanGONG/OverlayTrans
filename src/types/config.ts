export type TriggerMode = "manual" | "auto";
export type SourceLang = "auto" | "en" | "ja" | "zh";
export type TargetLang = "zh" | "en" | "ja";
export type TranslationMode = "speed" | "quality" | "local";

// V3 canonical remote provider IDs — must match Rust serde names
export type RemoteProviderId =
  | "deepseek"
  | "qwen"
  | "gemini"
  | "groq"
  | "openai"
  | "custom";

// Keep ProviderId as alias for backward compat
export type ProviderId = RemoteProviderId;

export type QwenRegion = "domestic" | "international";
export type VisionProfileMode = "follow_text" | "separate";
export type ApiKeyScope = "text" | "vision";

export type LocalBackend = "bundled_llama_cpp" | "custom_loopback";
export type LocalModel = "qwen3_4b" | "qwen3_8b" | "custom";

export interface VisionApiConfig {
  mode: VisionProfileMode;
  provider: RemoteProviderId;
  qwen_region?: QwenRegion | null;
  base_url: string;
  api_key: string;
  model: string;
  custom_supports_vision: boolean;
}

export interface ApiConfig {
  provider: RemoteProviderId;
  qwen_region?: QwenRegion | null;
  base_url: string;
  api_key: string;
  text_model: string;
  vlm_model: string;
  custom_supports_vision: boolean;
  vision: VisionApiConfig;
}

export interface TriggerConfig {
  mode: TriggerMode;
  hotkey: string;
  auto_interval_ms: number;
  change_threshold: number;
}

export interface TranslationConfig {
  mode: TranslationMode;
  source_lang: SourceLang;
  target_lang: TargetLang;
  context_size: number;
}

export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  border_hue: number;
  border_opacity: number;
  show_border: boolean;
  /** Measured physical-pixel insets [left, top, right, bottom] for OCR cropping. */
  measured_insets?: [number, number, number, number] | null;
}

export interface DisplayConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  bg_hue: number;
  bg_opacity: number;
  font_family: string;
  font_size: number;
  font_color: string;
}

export interface LocalConfig {
  backend: LocalBackend;
  model: LocalModel;
  custom_base_url?: string | null;
  custom_model?: string | null;
}

export type ThemeMode = "system" | "light" | "dark";

export interface UiConfig {
  theme: ThemeMode;
}

export interface AppConfig {
  version: number;
  api: ApiConfig;
  trigger: TriggerConfig;
  translation: TranslationConfig;
  capture_region: CaptureRegion;
  display: DisplayConfig;
  local: LocalConfig;
  ui: UiConfig;
  onboarding_completed: boolean;
  onboarding_revision: number;
}

export interface PresetInfo {
  id: RemoteProviderId;
  label: string;
  base_url: string;
  text_models: string[];
  vlm_models: string[];
  default_text_model: string;
  default_vlm_model: string;
  supports_vision: boolean;
  qwen_international_base_url?: string | null;
}

export const DEFAULT_CONFIG: AppConfig = {
  version: 3,
  api: {
    provider: "deepseek",
    qwen_region: null,
    base_url: "",
    api_key: "",
    text_model: "deepseek-v4-flash",
    vlm_model: "",
    custom_supports_vision: false,
    vision: {
      mode: "follow_text",
      provider: "qwen",
      qwen_region: "domestic",
      base_url: "",
      api_key: "",
      model: "qwen3.6-flash",
      custom_supports_vision: false,
    },
  },
  trigger: {
    mode: "manual",
    hotkey: "F8",
    auto_interval_ms: 500,
    change_threshold: 4,
  },
  translation: {
    mode: "speed",
    source_lang: "en",
    target_lang: "zh",
    context_size: 5,
  },
  capture_region: {
    x: 200,
    y: 200,
    width: 640,
    height: 160,
    border_hue: 0,
    border_opacity: 100,
    show_border: true,
  },
  display: {
    x: 180,
    y: 380,
    width: 720,
    height: 220,
    bg_hue: 205,
    bg_opacity: 72,
    font_family: "Microsoft YaHei UI",
    font_size: 18,
    font_color: "#ffffff",
  },
  local: {
    backend: "bundled_llama_cpp",
    model: "qwen3_4b",
    custom_base_url: null,
    custom_model: null,
  },
  ui: {
    theme: "system",
  },
  onboarding_completed: false,
  onboarding_revision: 0,
};
