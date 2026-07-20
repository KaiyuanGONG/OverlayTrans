/**
 * Zustand store for UI language preference.
 * Persisted to localStorage so the choice survives restarts.
 *
 * Cross-window sync: each Tauri webview has its own JS context, so a Zustand
 * update in SettingsPanel won't reach CaptureOverlay / TranslationPanel on
 * its own.  We solve this by broadcasting a Tauri event ("overlaytrans-lang")
 * whenever setLang is called.  Every window that imports this module sets up
 * a listener and mirrors the change into its own store instance.
 */
import { create } from "zustand";
import { LangCode, getLocale, I18nKeys } from "@/i18n";
import { emit, listen } from "@tauri-apps/api/event";

const STORAGE_KEY = "overlaytrans_lang";
const LANG_EVENT = "overlaytrans-lang";

function readStoredLang(): LangCode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "zh" || v === "en") return v;
  } catch {
    // localStorage unavailable (e.g. in test environment)
  }
  return "zh";
}

interface LangStore {
  lang: LangCode;
  /** Translate a key in the current locale. */
  t: (key: I18nKeys) => string;
  setLang: (lang: LangCode) => void;
}

export const useLangStore = create<LangStore>((set, get) => ({
  lang: readStoredLang(),
  t: (key: I18nKeys) => getLocale(get().lang)[key],
  setLang: (lang: LangCode) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
    set({ lang, t: (key: I18nKeys) => getLocale(lang)[key] });
    // Broadcast to all other windows so they reflect the new language instantly.
    void emit(LANG_EVENT, lang).catch(() => {});
  },
}));

// Listen for broadcasts sent by other windows and mirror the change locally.
// The guard prevents acting on events this window itself emitted (Tauri
// routes the event back to the sender as well as all other windows).
void listen<string>(LANG_EVENT, (ev) => {
  const lang = ev.payload as LangCode;
  if ((lang === "zh" || lang === "en") && lang !== useLangStore.getState().lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
    useLangStore.setState({ lang, t: (key: I18nKeys) => getLocale(lang)[key] });
  }
}).catch(() => {});
