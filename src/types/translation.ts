export type AppStatus =
  | "idle"
  | "capturing"
  | "ocr"
  | "translating"
  | "done"
  | "error";

export interface TranslationEntry {
  id: string;
  timestamp: number;
  source_text: string;
  translated_text: string;
  ocr_engine: string;
  translation_engine: string;
  provider_label: string;
  latency_ms: number;
}

export interface TranslationResult {
  source: string;
  target: string;
  ocr_engine: string;
  translation_engine: string;
  provider_label: string;
  latency_ms: number;
  generation: number;
}

export interface TriggerEvent {
  mode: "manual" | "auto";
  timestamp: number;
}
