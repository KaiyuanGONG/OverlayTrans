import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { AppConfig, DEFAULT_CONFIG, type ApiKeyScope } from "@/types/config";

interface ConfigStore {
  config: AppConfig;
  isLoading: boolean;
  error: string | null;

  applyConfig: (update: ConfigUpdatedEvent) => void;
  loadConfig: () => Promise<void>;
  updateConfig: (partial: Partial<AppConfig>) => Promise<void>;
  clearApiKey: (scope: ApiKeyScope) => Promise<void>;
  resetConfig: () => Promise<void>;
}

export interface ConfigUpdatedEvent {
  revision: number;
  config: AppConfig;
}

let configMutationQueue: Promise<unknown> = Promise.resolve();
let pendingConfigMutations = 0;
let reconcilingConfig = false;
let latestConfigRevision = 0;
let deferredConfigRevision = 0;

function buildOptimisticReset(current: AppConfig): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    api: { ...current.api, vision: { ...current.api.vision } },
    trigger: { ...DEFAULT_CONFIG.trigger },
    translation: { ...DEFAULT_CONFIG.translation },
    capture_region: { ...DEFAULT_CONFIG.capture_region },
    display: { ...DEFAULT_CONFIG.display },
    local: { ...DEFAULT_CONFIG.local },
    ui: { ...DEFAULT_CONFIG.ui },
    onboarding_completed: current.onboarding_completed,
    onboarding_revision: current.onboarding_revision,
  };
}

function enqueueConfigMutation(
  mutation: () => Promise<number>,
  set: (partial: Partial<ConfigStore>) => void,
): Promise<number> {
  pendingConfigMutations += 1;
  const pending = configMutationQueue.then(async () => {
    try {
      const revision = await mutation();
      latestConfigRevision = Math.max(latestConfigRevision, revision);
      return revision;
    } finally {
      pendingConfigMutations -= 1;
      if (pendingConfigMutations === 0) {
        // Reconcile from the backend after a complete burst. The monotonic
        // revision independently rejects any acknowledgement delivered later.
        reconcilingConfig = true;
        try {
          const config = await invoke<AppConfig>("get_config");
          if (pendingConfigMutations === 0) {
            latestConfigRevision = Math.max(latestConfigRevision, deferredConfigRevision);
            deferredConfigRevision = 0;
            set({ config, error: null });
          }
        } finally {
          reconcilingConfig = false;
        }
      }
    }
  });
  // Keep later writes moving even if one persistence attempt fails. The
  // caller still receives the original rejection after backend reconciliation.
  configMutationQueue = pending.catch(() => undefined);
  return pending;
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  isLoading: true,
  error: null,

  applyConfig: (update: ConfigUpdatedEvent) => {
    if (update.revision <= latestConfigRevision) return;
    // A local optimistic snapshot may be newer than an acknowledgement from an
    // earlier queued write. The queue performs one canonical get_config after
    // the whole burst, so intermediate events must not overwrite user input.
    if (pendingConfigMutations > 0 || reconcilingConfig) {
      deferredConfigRevision = Math.max(deferredConfigRevision, update.revision);
      return;
    }
    latestConfigRevision = update.revision;
    set({ config: update.config, error: null });
  },

  loadConfig: async () => {
    set({ isLoading: true, error: null });
    try {
      const config = await invoke<AppConfig>("get_config");
      set({ config, isLoading: false });
    } catch (e) {
      console.error("Failed to load config:", e);
      set({ error: String(e), isLoading: false });
    }
  },

  updateConfig: async (partial: Partial<AppConfig>) => {
    if (get().isLoading) return;
    const previous = get().config;
    const merged = { ...previous, ...partial };
    set({ config: merged });
    try {
      await enqueueConfigMutation(
        () => invoke<number>("set_config", { config: merged }),
        set,
      );
    } catch (e) {
      console.error("Failed to save config:", e);
      set({ error: String(e) });
    }
  },

  clearApiKey: async (scope) => {
    if (get().isLoading) return;
    const current = get().config;
    const api = scope === "text"
      ? { ...current.api, api_key: "" }
      : { ...current.api, vision: { ...current.api.vision, api_key: "" } };
    set({ config: { ...current, api } });
    try {
      await enqueueConfigMutation(
        () => invoke<number>("clear_api_key", { scope }),
        set,
      );
    } catch (e) {
      console.error("Failed to clear API key:", e);
      set({ error: String(e) });
    }
  },

  resetConfig: async () => {
    if (get().isLoading) return;
    set({ config: buildOptimisticReset(get().config) });
    try {
      await enqueueConfigMutation(() => invoke<number>("reset_config"), set);
    } catch (e) {
      console.error("Failed to reset config:", e);
      set({ error: String(e) });
    }
  },
}));
