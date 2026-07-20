import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type AppConfig, type PresetInfo } from "@/types/config";
import {
  P1_DISABLED_MODES,
  apiTestAvailable,
  qualityCapability,
  resolvedVisionProfile,
  selectProviderConfig,
  selectVisionProviderConfig,
  resolvePresetBaseUrl,
  showQualityUnavailableHint,
  SUPPORTED_SOURCE_LANGS,
  SUPPORTED_TARGET_LANGS,
} from "@/lib/configContract";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { useConfigStore } from "@/stores/configStore";

let testRevision = 0;

beforeEach(() => {
  testRevision += 100;
  invokeMock.mockReset();
  useConfigStore.setState({ config: DEFAULT_CONFIG, isLoading: false, error: null });
});

describe("Config Store", () => {
  it("default config has version 3", () => {
    expect(DEFAULT_CONFIG.version).toBe(3);
  });

  it("default config uses deepseek provider", () => {
    expect(DEFAULT_CONFIG.api.provider).toBe("deepseek");
  });

  it("default config uses deepseek-v4-flash model", () => {
    expect(DEFAULT_CONFIG.api.text_model).toBe("deepseek-v4-flash");
  });

  it("default config has speed mode", () => {
    expect(DEFAULT_CONFIG.translation.mode).toBe("speed");
  });

  it("default config has en source and zh target", () => {
    expect(DEFAULT_CONFIG.translation.source_lang).toBe("en");
    expect(DEFAULT_CONFIG.translation.target_lang).toBe("zh");
  });

  it("defaults onboarding revision to zero", () => {
    expect(DEFAULT_CONFIG.onboarding_revision).toBe(0);
  });

  it("default config has local config with bundled llama.cpp", () => {
    expect(DEFAULT_CONFIG.local.backend).toBe("bundled_llama_cpp");
    expect(DEFAULT_CONFIG.local.model).toBe("qwen3_4b");
    expect(DEFAULT_CONFIG.local).not.toHaveProperty("runtime_ready");
    expect(DEFAULT_CONFIG.local).not.toHaveProperty("model_downloaded");
  });

  it("loads the canonical config returned by the backend", async () => {
    const loaded: AppConfig = {
      ...DEFAULT_CONFIG,
      api: { ...DEFAULT_CONFIG.api, provider: "qwen", qwen_region: "international" },
    };
    invokeMock.mockResolvedValueOnce(loaded);

    await useConfigStore.getState().loadConfig();

    expect(invokeMock).toHaveBeenCalledWith("get_config");
    expect(useConfigStore.getState().config).toEqual(loaded);
  });

  it("keeps the store in loading state until backend config arrives", async () => {
    let resolveConfig!: (config: AppConfig) => void;
    invokeMock.mockReturnValueOnce(new Promise<AppConfig>((resolve) => { resolveConfig = resolve; }));

    const pending = useConfigStore.getState().loadConfig();
    expect(useConfigStore.getState().isLoading).toBe(true);

    resolveConfig(DEFAULT_CONFIG);
    await pending;
    expect(useConfigStore.getState().isLoading).toBe(false);
  });

  it("reconciles optimistic config from the backend when persistence fails", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(DEFAULT_CONFIG);

    await useConfigStore.getState().updateConfig({
      translation: { ...DEFAULT_CONFIG.translation, target_lang: "en" },
    });

    expect(useConfigStore.getState().config).toEqual(DEFAULT_CONFIG);
    expect(useConfigStore.getState().error).toContain("disk full");
  });

  it("does not persist DEFAULT_CONFIG while the real config is loading", async () => {
    useConfigStore.setState({ isLoading: true });

    await useConfigStore.getState().updateConfig({
      ui: { ...DEFAULT_CONFIG.ui, theme: "dark" },
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(useConfigStore.getState().config).toEqual(DEFAULT_CONFIG);
  });

  it("serializes full config snapshots so the newest API key wins", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    invokeMock
      .mockReturnValueOnce(new Promise<number>((resolve) => {
        releaseFirst = () => resolve(testRevision + 1);
      }))
      .mockReturnValueOnce(new Promise<number>((resolve) => {
        releaseSecond = () => resolve(testRevision + 2);
      }));

    const qwen = {
      ...DEFAULT_CONFIG.api,
      provider: "qwen" as const,
      api_key: "",
      text_model: "qwen3.6-flash",
      vlm_model: "qwen3.6-flash",
    };
    const providerUpdate = useConfigStore.getState().updateConfig({ api: qwen });
    const keyUpdate = useConfigStore.getState().updateConfig({
      api: { ...qwen, api_key: "qwen-secret" },
    });

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    releaseFirst();
    await providerUpdate;
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));

    const secondSnapshot = invokeMock.mock.calls[1][1].config as AppConfig;
    expect(secondSnapshot.api.provider).toBe("qwen");
    expect(secondSnapshot.api.api_key).toBe("qwen-secret");

    invokeMock.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      api: { ...qwen, api_key: "qwen-secret" },
    });
    releaseSecond();
    await keyUpdate;
    expect(useConfigStore.getState().config.api.api_key).toBe("qwen-secret");
  });

  it("ignores an older config-updated acknowledgement while a newer draft is pending", async () => {
    let releaseWrite!: () => void;
    const latest: AppConfig = {
      ...DEFAULT_CONFIG,
      api: { ...DEFAULT_CONFIG.api, api_key: "latest-secret" },
    };
    invokeMock
      .mockReturnValueOnce(new Promise<number>((resolve) => {
        releaseWrite = () => resolve(testRevision + 2);
      }))
      .mockResolvedValueOnce(latest);

    const update = useConfigStore.getState().updateConfig({ api: latest.api });
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    useConfigStore.getState().applyConfig({
      revision: testRevision + 1,
      config: DEFAULT_CONFIG,
    });
    expect(useConfigStore.getState().config.api.api_key).toBe("latest-secret");

    releaseWrite();
    await update;
    expect(useConfigStore.getState().config).toEqual(latest);
  });

  it("queues clearApiKey after older snapshots so the key cannot reappear", async () => {
    const withKey: AppConfig = {
      ...DEFAULT_CONFIG,
      api: { ...DEFAULT_CONFIG.api, api_key: "old-secret" },
    };
    const cleared: AppConfig = {
      ...withKey,
      api: { ...withKey.api, api_key: "" },
    };
    useConfigStore.setState({ config: withKey });
    let releaseWrite!: () => void;
    invokeMock
      .mockReturnValueOnce(new Promise<number>((resolve) => {
        releaseWrite = () => resolve(testRevision + 1);
      }))
      .mockResolvedValueOnce(testRevision + 2)
      .mockResolvedValueOnce(cleared);

    const olderWrite = useConfigStore.getState().updateConfig({
      ui: { ...withKey.ui, theme: "dark" },
    });
    const clear = useConfigStore.getState().clearApiKey("text");

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(useConfigStore.getState().config.api.api_key).toBe("");
    releaseWrite();
    await olderWrite;
    await clear;

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "set_config",
      "clear_api_key",
      "get_config",
    ]);
    expect(useConfigStore.getState().config.api.api_key).toBe("");
  });

  it("clears only the requested image key through the mutation queue", async () => {
    const configured: AppConfig = {
      ...DEFAULT_CONFIG,
      api: {
        ...DEFAULT_CONFIG.api,
        api_key: "text-secret",
        vision: { ...DEFAULT_CONFIG.api.vision, api_key: "vision-secret" },
      },
    };
    useConfigStore.setState({ config: configured, isLoading: false, error: null });
    invokeMock
      .mockResolvedValueOnce(testRevision)
      .mockResolvedValueOnce({
        ...configured,
        api: {
          ...configured.api,
          vision: { ...configured.api.vision, api_key: "" },
        },
      });

    await useConfigStore.getState().clearApiKey("vision");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "clear_api_key", { scope: "vision" });
    expect(useConfigStore.getState().config.api.api_key).toBe("text-secret");
    expect(useConfigStore.getState().config.api.vision.api_key).toBe("");
  });

  it("reconciles to the backend baseline when an entire queued burst fails", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"))
      .mockResolvedValueOnce(DEFAULT_CONFIG);

    const first = useConfigStore.getState().updateConfig({
      ui: { ...DEFAULT_CONFIG.ui, theme: "light" },
    });
    const second = useConfigStore.getState().updateConfig({
      ui: { ...DEFAULT_CONFIG.ui, theme: "dark" },
    });
    await Promise.all([first, second]);

    expect(useConfigStore.getState().config).toEqual(DEFAULT_CONFIG);
    expect(invokeMock).toHaveBeenLastCalledWith("get_config");
  });

  it("rejects a stale config event even after the local mutation has reconciled", async () => {
    const latest: AppConfig = {
      ...DEFAULT_CONFIG,
      api: { ...DEFAULT_CONFIG.api, api_key: "latest-secret" },
    };
    invokeMock
      .mockResolvedValueOnce(testRevision + 2)
      .mockResolvedValueOnce(latest);

    await useConfigStore.getState().updateConfig({ api: latest.api });
    useConfigStore.getState().applyConfig({
      revision: testRevision + 1,
      config: DEFAULT_CONFIG,
    });

    expect(useConfigStore.getState().config.api.api_key).toBe("latest-secret");
  });

  it("builds edits queued after reset from the optimistic reset snapshot", async () => {
    const beforeReset: AppConfig = {
      ...DEFAULT_CONFIG,
      api: { ...DEFAULT_CONFIG.api, provider: "qwen", api_key: "qwen-secret" },
      translation: { ...DEFAULT_CONFIG.translation, target_lang: "ja" },
      ui: { ...DEFAULT_CONFIG.ui, theme: "light" },
    };
    const expectedAfterEdit: AppConfig = {
      ...DEFAULT_CONFIG,
      api: beforeReset.api,
      onboarding_completed: beforeReset.onboarding_completed,
      onboarding_revision: beforeReset.onboarding_revision,
      ui: { ...DEFAULT_CONFIG.ui, theme: "dark" },
    };
    useConfigStore.setState({ config: beforeReset });
    let releaseReset!: () => void;
    invokeMock
      .mockReturnValueOnce(new Promise<number>((resolve) => {
        releaseReset = () => resolve(testRevision + 1);
      }))
      .mockResolvedValueOnce(testRevision + 2)
      .mockResolvedValueOnce(expectedAfterEdit);

    const reset = useConfigStore.getState().resetConfig();
    const edit = useConfigStore.getState().updateConfig({
      ui: { ...DEFAULT_CONFIG.ui, theme: "dark" },
    });
    releaseReset();
    await Promise.all([reset, edit]);

    const queuedEdit = invokeMock.mock.calls.find(([command]) => command === "set_config")?.[1]
      .config as AppConfig;
    expect(queuedEdit.translation.target_lang).toBe(DEFAULT_CONFIG.translation.target_lang);
    expect(queuedEdit.api).toEqual(beforeReset.api);
    expect(useConfigStore.getState().config).toEqual(expectedAfterEdit);
  });
});

describe("Provider wire IDs", () => {
  const validProviderIds = [
    "deepseek",
    "qwen",
    "gemini",
    "groq",
    "openai",
    "custom",
  ];

  it("all provider IDs are valid snake_case or single word", () => {
    for (const id of validProviderIds) {
      expect(id).toMatch(/^[a-z][a-z0-9]*$/);
    }
  });

  it("no provider ID contains underscore (canonical form)", () => {
    // Note: deep_seek and open_ai are legacy aliases, not canonical
    const canonicalIds = validProviderIds;
    for (const id of canonicalIds) {
      expect(id).not.toContain("_");
    }
  });
});

describe("TranslationMode", () => {
  it("speed mode is available", () => {
    expect(DEFAULT_CONFIG.translation.mode).toBe("speed");
  });

  it("all modes are enabled (quality P2, local P3)", () => {
    expect(P1_DISABLED_MODES).toEqual([]);
  });
});

describe("SourceLang", () => {
  it("supported UI languages include en, zh, ja", () => {
    expect(SUPPORTED_SOURCE_LANGS).toEqual(["en", "zh", "ja"]);
    expect(SUPPORTED_SOURCE_LANGS).not.toContain("auto");
    expect(SUPPORTED_TARGET_LANGS).toEqual(["zh", "en", "ja"]);
  });
});

describe("Qwen endpoint contract", () => {
  const qwenPreset: PresetInfo = {
    id: "qwen",
    label: "Qwen",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    qwen_international_base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    text_models: ["qwen3.6-flash"],
    vlm_models: ["qwen3.6-flash"],
    default_text_model: "qwen3.6-flash",
    default_vlm_model: "qwen3.6-flash",
    supports_vision: true,
  };

  it("resolves domestic and international endpoints from the backend DTO", () => {
    expect(resolvePresetBaseUrl(qwenPreset, "domestic")).toBe(qwenPreset.base_url);
    expect(resolvePresetBaseUrl(qwenPreset, "international")).toBe(
      qwenPreset.qwen_international_base_url,
    );
  });
});

describe("Provider vision capability", () => {
  it("only shows the unavailable warning while Quality mode is selected", () => {
    expect(showQualityUnavailableHint("quality", false)).toBe(true);
    expect(showQualityUnavailableHint("speed", false)).toBe(false);
    expect(showQualityUnavailableHint("local", false)).toBe(false);
    expect(showQualityUnavailableHint("quality", true)).toBe(false);
  });
});

describe("API settings safety", () => {
  const qwenPreset: PresetInfo = {
    id: "qwen",
    label: "Qwen（国内推荐）",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    text_models: ["qwen3.6-flash"],
    vlm_models: ["qwen3.6-flash"],
    default_text_model: "qwen3.6-flash",
    default_vlm_model: "qwen3.6-flash",
    supports_vision: true,
  };

  it("clears the old key and incompatible VLM when provider changes", () => {
    const next = selectProviderConfig(
      { ...DEFAULT_CONFIG.api, provider: "deepseek", api_key: "secret", vlm_model: "bad-vlm" },
      qwenPreset,
    );
    expect(next.api_key).toBe("");
    expect(next.vlm_model).toBe("qwen3.6-flash");
    expect(next.qwen_region).toBe("domestic");
  });

  it("disables API tests until config is loaded and a key is visible", () => {
    expect(apiTestAvailable(true, "secret")).toBe(false);
    expect(apiTestAvailable(false, "")).toBe(false);
    expect(apiTestAvailable(false, "secret")).toBe(true);
  });
});

describe("Independent image API profile", () => {
  const qwenPreset: PresetInfo = {
    id: "qwen",
    label: "Qwen",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    text_models: ["qwen3.6-flash", "qwen3.7-plus"],
    vlm_models: ["qwen3.6-flash", "qwen3.6-plus", "qwen3.7-plus"],
    default_text_model: "qwen3.6-flash",
    default_vlm_model: "qwen3.6-flash",
    supports_vision: true,
    qwen_international_base_url:
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  };

  const geminiPreset: PresetInfo = {
    id: "gemini",
    label: "Gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
    text_models: ["gemini-3.1-flash-lite", "gemini-3.5-flash"],
    vlm_models: ["gemini-3.1-flash-lite", "gemini-3.5-flash"],
    default_text_model: "gemini-3.1-flash-lite",
    default_vlm_model: "gemini-3.5-flash",
    supports_vision: true,
    qwen_international_base_url: null,
  };

  it("defaults image translation to follow text while prefilling Qwen", () => {
    expect(DEFAULT_CONFIG.api.vision).toEqual({
      mode: "follow_text",
      provider: "qwen",
      qwen_region: "domestic",
      base_url: "",
      api_key: "",
      model: "qwen3.6-flash",
      custom_supports_vision: false,
    });
  });

  it("resolves independent image credentials without text credentials", () => {
    const api = {
      ...DEFAULT_CONFIG.api,
      api_key: "text-secret",
      vision: {
        ...DEFAULT_CONFIG.api.vision,
        mode: "separate" as const,
        api_key: "vision-secret",
      },
    };
    expect(resolvedVisionProfile(api, [qwenPreset])).toMatchObject({
      provider: "qwen",
      apiKey: "vision-secret",
      model: "qwen3.6-flash",
    });
    expect(qualityCapability(api, [qwenPreset])).toBe(true);
  });

  it("selects a vision provider without changing text credentials", () => {
    const current = { ...DEFAULT_CONFIG.api, api_key: "text-secret" };
    const next = selectVisionProviderConfig(current, geminiPreset);
    expect(next.api_key).toBe("text-secret");
    expect(next.vision.provider).toBe("gemini");
    expect(next.vision.api_key).toBe("");
  });
});

describe("Disabled modes", () => {
  it("all modes are enabled (quality P2, local P3)", () => {
    expect(P1_DISABLED_MODES).toEqual([]);
    expect(P1_DISABLED_MODES).not.toContain("quality");
    expect(P1_DISABLED_MODES).not.toContain("local");
  });
});
