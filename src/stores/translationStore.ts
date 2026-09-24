import { create } from "zustand";
import { AppStatus, TranslationEntry } from "@/types/translation";

const MAX_HISTORY = 20;

interface TranslationStore {
  history: TranslationEntry[];
  currentStatus: AppStatus;
  lastError: string | null;
  isAutoMode: boolean;
  // Streaming: accumulate chunks for the current translation
  streamingText: string;
  isStreaming: boolean;
  // Generation tracking — discard stale events
  currentGeneration: number;
  // Sticky warning — persists across done/idle, only cleared on new generation
  warning: string | null;

  addTranslation: (entry: TranslationEntry, generation: number) => void;
  setStatus: (status: AppStatus, generation: number, error?: string) => void;
  setAutoMode: (enabled: boolean) => void;
  // Streaming actions
  startStreaming: (generation: number) => void;
  appendChunk: (chunk: string, generation: number) => void;
  // Warning action (sticky — not cleared by done/idle)
  setWarning: (message: string, generation: number) => void;
  clearWarning: () => void;
}

export const useTranslationStore = create<TranslationStore>((set) => ({
  history: [],
  currentStatus: "idle",
  lastError: null,
  isAutoMode: false,
  streamingText: "",
  isStreaming: false,
  currentGeneration: 0,
  warning: null,

  addTranslation: (entry, generation) =>
    set((state) => {
      // Discard stale generation
      if (generation < state.currentGeneration) return state;
      return {
        history: [entry, ...state.history].slice(0, MAX_HISTORY),
        currentStatus: "done",
        lastError: null,
        streamingText: "",
        isStreaming: false,
        currentGeneration: generation,
        // Warning is NOT cleared by done — it's sticky
      };
    }),

  setStatus: (status, generation, error) =>
    set((state) => {
      // Discard stale generation (but always accept idle/error for current gen)
      if (generation < state.currentGeneration) return state;
      return {
        currentStatus: status,
        lastError: error ?? null,
        currentGeneration: generation,
        // A genuinely new generation clears the previous warning immediately.
        ...(generation > state.currentGeneration ? { warning: null } : {}),
        // Clear streaming state on error or idle
        ...(status === "error" || status === "idle"
          ? { streamingText: "", isStreaming: false }
          : {}),
        // Warning is NOT cleared by status changes — only by new generation or explicit clear
      };
    }),

  setAutoMode: (enabled) => set({ isAutoMode: enabled }),

  startStreaming: (generation) =>
    set((state) => {
      if (generation < state.currentGeneration) return state;
      return {
        isStreaming: true,
        streamingText: "",
        currentGeneration: generation,
        // A second translating status in the same generation (Quality →
        // Speed fallback) must not erase the sticky fallback warning.
        ...(generation > state.currentGeneration ? { warning: null } : {}),
      };
    }),

  appendChunk: (chunk, generation) =>
    set((state) => {
      // Discard stale generation — don't let old chunks pollute current UI
      if (generation < state.currentGeneration) return state;
      return {
        streamingText: state.streamingText + chunk,
        currentGeneration: generation,
      };
    }),

  setWarning: (message, generation) =>
    set((state) => {
      // Discard stale generation
      if (generation < state.currentGeneration) return state;
      return { warning: message, currentGeneration: generation };
    }),

  clearWarning: () => set({ warning: null }),
}));
