import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type PresetInfo } from "@/types/config";
import { applyOnboardingSelection } from "@/lib/onboardingConfig";

const qwenPreset: PresetInfo = {
  id: "qwen",
  label: "Qwen",
  base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  text_models: ["qwen3.6-flash"],
  vlm_models: ["qwen3-vl-flash"],
  default_text_model: "qwen3.6-flash",
  default_vlm_model: "qwen3-vl-flash",
  supports_vision: true,
  qwen_international_base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
};

describe("applyOnboardingSelection", () => {
  it("leaves every existing setting untouched when the guide is skipped", () => {
    const current = {
      ...DEFAULT_CONFIG,
      api: { ...DEFAULT_CONFIG.api, provider: "custom" as const, base_url: "http://127.0.0.1:1234/v1" },
    };

    expect(applyOnboardingSelection(current, { kind: "unchanged" })).toEqual(current);
  });

  it("switches to local mode without touching remote credentials", () => {
    const current = {
      ...DEFAULT_CONFIG,
      api: { ...DEFAULT_CONFIG.api, provider: "gemini" as const, api_key: "keep-me" },
    };
    const result = applyOnboardingSelection(current, { kind: "local" });

    expect(result.translation.mode).toBe("local");
    expect(result.api).toEqual(current.api);
  });

  it("applies only the selected online provider preset and trimmed key", () => {
    const current = {
      ...DEFAULT_CONFIG,
      display: { ...DEFAULT_CONFIG.display, font_size: 29 },
      api: { ...DEFAULT_CONFIG.api, provider: "gemini" as const, base_url: "https://old.example/v1" },
    };
    const result = applyOnboardingSelection(current, {
      kind: "online",
      preset: qwenPreset,
      apiKey: "  secret  ",
    });

    expect(result.translation.mode).toBe("speed");
    expect(result.api).toEqual({
      ...current.api,
      provider: "qwen",
      qwen_region: "domestic",
      base_url: "",
      api_key: "secret",
      text_model: qwenPreset.default_text_model,
      vlm_model: qwenPreset.default_vlm_model,
      custom_supports_vision: false,
    });
    expect(result.display.font_size).toBe(29);
  });
});
