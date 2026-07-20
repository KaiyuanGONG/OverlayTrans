import type { AppConfig, PresetInfo } from "@/types/config";

export type OnboardingSelection =
  | { kind: "unchanged" }
  | { kind: "local" }
  | { kind: "online"; preset: PresetInfo; apiKey: string };

export function applyOnboardingSelection(
  current: AppConfig,
  selection: OnboardingSelection,
): AppConfig {
  if (selection.kind === "unchanged") return current;

  if (selection.kind === "local") {
    return {
      ...current,
      translation: { ...current.translation, mode: "local" },
    };
  }

  const { preset } = selection;
  return {
    ...current,
    translation: { ...current.translation, mode: "speed" },
    api: {
      ...current.api,
      provider: preset.id,
      qwen_region: preset.id === "qwen" ? "domestic" : null,
      base_url: "",
      api_key: selection.apiKey.trim(),
      text_model: preset.default_text_model,
      vlm_model: preset.default_vlm_model,
      custom_supports_vision: false,
    },
  };
}
