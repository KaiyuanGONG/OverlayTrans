import type { ApiConfig, PresetInfo, QwenRegion, SourceLang, TargetLang, TranslationMode } from "@/types/config";

export const SUPPORTED_SOURCE_LANGS = ["en", "zh", "ja"] as const satisfies readonly SourceLang[];
export const SUPPORTED_TARGET_LANGS = ["zh", "en", "ja"] as const satisfies readonly TargetLang[];

export function resolvePresetBaseUrl(
  preset: PresetInfo | undefined,
  qwenRegion: QwenRegion | null | undefined,
): string {
  if (!preset) return "";
  if (preset.id === "qwen" && qwenRegion === "international") {
    return preset.qwen_international_base_url ?? preset.base_url;
  }
  return preset.base_url;
}

export interface ResolvedVisionProfile {
  provider: ApiConfig["provider"];
  preset?: PresetInfo;
  baseUrl: string;
  apiKey: string;
  model: string;
  customSupportsVision: boolean;
}

export function resolvedVisionProfile(
  api: ApiConfig,
  presets: PresetInfo[],
): ResolvedVisionProfile {
  const separate = api.vision.mode === "separate";
  const provider = separate ? api.vision.provider : api.provider;
  const preset = presets.find((candidate) => candidate.id === provider);
  const region = separate ? api.vision.qwen_region : api.qwen_region;
  const configuredBaseUrl = separate ? api.vision.base_url : api.base_url;
  const model = separate
    ? api.vision.model.trim()
    : api.vlm_model.trim() || preset?.default_vlm_model.trim() || "";
  return {
    provider,
    preset,
    baseUrl: configuredBaseUrl.trim() || resolvePresetBaseUrl(preset, region),
    apiKey: separate ? api.vision.api_key : api.api_key,
    model,
    customSupportsVision: separate
      ? api.vision.custom_supports_vision
      : api.custom_supports_vision,
  };
}

export function qualityCapability(api: ApiConfig, presets: PresetInfo[]): boolean {
  const resolved = resolvedVisionProfile(api, presets);
  return resolved.provider === "custom"
    ? resolved.customSupportsVision && !!resolved.model
    : !!resolved.preset?.supports_vision && !!resolved.model;
}

export function selectVisionProviderConfig(
  current: ApiConfig,
  preset: PresetInfo,
): ApiConfig {
  return {
    ...current,
    vision: {
      ...current.vision,
      mode: "separate",
      provider: preset.id,
      qwen_region: preset.id === "qwen" ? "domestic" : null,
      base_url: "",
      api_key: "",
      model: preset.default_vlm_model,
      custom_supports_vision: false,
    },
  };
}

export function selectProviderConfig(current: ApiConfig, preset: PresetInfo): ApiConfig {
  return {
    ...current,
    provider: preset.id,
    qwen_region: preset.id === "qwen" ? "domestic" : null,
    base_url: "",
    api_key: "",
    text_model: preset.default_text_model,
    vlm_model: preset.supports_vision ? preset.default_vlm_model : "",
    custom_supports_vision: false,
  };
}

export function apiTestAvailable(isLoading: boolean, apiKey: string): boolean {
  return !isLoading && apiKey.trim().length > 0;
}

export function showQualityUnavailableHint(
  mode: TranslationMode,
  qualityAvailable: boolean,
): boolean {
  return mode === "quality" && !qualityAvailable;
}
