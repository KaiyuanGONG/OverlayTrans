/**
 * SettingsPanel — themed settings window.
 * Groups: Trigger / Display / Capture / Translation / API / About
 *
 * Follows the app theme (system/light/dark). CaptureOverlay and TranslationPanel
 * are semi-transparent overlays on the game and intentionally keep dark glass style.
 */
import { useConfigStore } from "@/stores/configStore";
import { useLangStore } from "@/stores/langStore";
import { useThemeStore } from "@/stores/themeStore";
import brandSignal from "@/assets/brand/chameleon-signal.svg";
import { LangCode, type I18nKeys } from "@/i18n";
import {
  apiTestAvailable,
  qualityCapability,
  resolvedVisionProfile,
  resolvePresetBaseUrl,
  selectProviderConfig,
  selectVisionProviderConfig,
  showQualityUnavailableHint,
  SUPPORTED_SOURCE_LANGS,
  SUPPORTED_TARGET_LANGS,
} from "@/lib/configContract";
import { userFacingErrorKey } from "@/lib/userFacingError";
import {
  AppConfig,
  LocalBackend,
  LocalModel,
  PresetInfo,
  SourceLang,
  TargetLang,
  ThemeMode,
  TranslationMode,
} from "@/types/config";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Palette,
  Scissors,
  Languages,
  Key,
  Info,
  RotateCcw,
  ExternalLink,
  Bug,
} from "lucide-react";

type Tab =
  | "trigger"
  | "display"
  | "capture"
  | "translation"
  | "api"
  | "about";

const ABOUT_LINKS = {
  repo: "https://github.com/KaiyuanGONG/OverlayTrans",
  issues: "https://github.com/KaiyuanGONG/OverlayTrans/issues",
};

export default function SettingsPanel() {
  const { config, isLoading, loadConfig, updateConfig, resetConfig } = useConfigStore();
  const { t, lang, setLang } = useLangStore();
  const { initFromConfig, setTheme } = useThemeStore();
  const [activeTab, setActiveTab] = useState<Tab>("trigger");
  const [saved, setSaved] = useState(false);
  const [presets, setPresets] = useState<PresetInfo[]>([]);

  // Initialize theme from config
  useEffect(() => {
    initFromConfig(config.ui?.theme ?? "system");
  }, []);

  // Sync theme when config changes
  useEffect(() => {
    setTheme(config.ui?.theme ?? "system");
  }, [config.ui?.theme, setTheme]);

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "trigger", label: t("tab_trigger"), icon: <Keyboard size={16} /> },
    { id: "display", label: t("tab_display"), icon: <Palette size={16} /> },
    { id: "capture", label: t("tab_capture"), icon: <Scissors size={16} /> },
    { id: "translation", label: t("tab_translation"), icon: <Languages size={16} /> },
    { id: "api", label: t("tab_api"), icon: <Key size={16} /> },
    { id: "about", label: t("tab_about"), icon: <Info size={16} /> },
  ];

  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenClose = win.onCloseRequested(async (event) => {
      event.preventDefault();
      try {
        await win.hide();
      } catch (e) {
        console.error("Failed to hide settings window:", e);
      }
    });
    return () => {
      unlistenClose.then((f) => f());
    };
  }, []);

  useEffect(() => {
    void loadConfig();

    const loadPresets = async () => {
      try {
        const p = await invoke<PresetInfo[]>("get_presets");
        setPresets(p);
      } catch (e) {
        console.error("Failed to load presets:", e);
      }
    };
    void loadPresets();
  }, []);

  const handleChange = async <K extends keyof AppConfig>(
    key: K,
    value: AppConfig[K]
  ) => {
    await updateConfig({ [key]: value });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-microsoft-yahei">
      {/* Sidebar */}
      <aside className="w-36 bg-slate-100 dark:bg-slate-950 flex flex-col pt-4 shrink-0 border-r border-slate-200 dark:border-slate-800">
        <div className="px-4 mb-4">
          <h1 className="text-base font-bold">{t("settings_title")}</h1>
          {saved && <span className="text-emerald-500 text-xs">{t("save_indicator")}</span>}
        </div>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
              activeTab === tab.id
                ? "bg-brand-indigo text-white"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800"
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />

        {/* Theme control belongs with other application-wide controls. */}
        <div className="mx-4 mb-2">
          <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400" htmlFor="sidebar-theme">
            {t("theme_mode")}
          </label>
          <select
            id="sidebar-theme"
            className="w-full rounded bg-slate-200 px-2 py-1 text-xs dark:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            value={config.ui.theme}
            disabled={isLoading}
            onChange={(event) => {
              const theme = event.target.value as ThemeMode;
              setTheme(theme);
              void handleChange("ui", { ...config.ui, theme });
            }}
          >
            <option value="system">{t("theme_system")}</option>
            <option value="light">{t("theme_light")}</option>
            <option value="dark">{t("theme_dark")}</option>
          </select>
        </div>

        {/* Language toggle */}
        <div className="px-4 mb-2 flex gap-1">
          {(["zh", "en"] as LangCode[]).map((code) => (
            <button
              key={code}
              onClick={() => setLang(code)}
              className={`flex-1 py-1 text-xs rounded transition-colors ${
                lang === code
                  ? "bg-brand-indigo text-white"
                  : "bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              {code === "zh" ? "中文" : "EN"}
            </button>
          ))}
        </div>

        <button
          className="mx-4 mb-2 px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded transition-colors flex items-center gap-1.5"
          title={t("reset_windows_tip")}
          onClick={async () => {
            await invoke("reset_window_layout");
          }}
        >
          <RotateCcw size={14} />
          {t("reset_windows")}
        </button>
        <button
          className="mx-4 mb-4 px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-700 hover:bg-rose-500 dark:hover:bg-rose-600 rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isLoading}
          onClick={async () => {
            if (confirm(t("reset_confirm"))) {
              await resetConfig();
            }
          }}
        >
          {t("reset_defaults")}
        </button>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            {t("settings_loading")}
          </div>
        ) : <>
        {activeTab === "trigger" && (
          <TriggerTab config={config} onChange={handleChange} />
        )}
        {activeTab === "display" && (
          <DisplayTab config={config} onChange={handleChange} />
        )}
        {activeTab === "capture" && (
          <CaptureTab config={config} onChange={handleChange} />
        )}
        {activeTab === "translation" && (
          <TranslationTab config={config} onChange={handleChange} presets={presets} onOpenApi={() => setActiveTab("api")} />
        )}
        {activeTab === "api" && (
          <ApiTab config={config} onChange={handleChange} presets={presets} isLoading={isLoading} />
        )}
        {activeTab === "about" && <AboutTab />}
        </>}
      </main>
    </div>
  );
}

// --- Helpers ---

// --- Sub-components ---

type ChangeHandler = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => Promise<void>;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold mb-4">{children}</h2>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-200 dark:border-slate-700/50">
      <span className="text-slate-600 dark:text-slate-300 text-sm">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function TriggerTab({ config, onChange }: { config: AppConfig; onChange: ChangeHandler }) {
  const { t } = useLangStore();
  return (
    <div>
      <SectionTitle>{t("trigger_section")}</SectionTitle>
      <Row label={t("trigger_default_mode")}>
        <select
          className="bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1"
          value={config.trigger.mode}
          onChange={(e) =>
            onChange("trigger", { ...config.trigger, mode: e.target.value as "manual" | "auto" })
          }
        >
          <option value="manual">{t("trigger_mode_manual")}</option>
          <option value="auto">{t("trigger_mode_auto")}</option>
        </select>
      </Row>
      <Row label={t("trigger_hotkey")}>
        <HotkeyCapture
          value={config.trigger.hotkey}
          onChange={(key) => onChange("trigger", { ...config.trigger, hotkey: key })}
        />
      </Row>
      <Row label={t("trigger_interval")}>
        <input
          type="range"
          min={200}
          max={5000}
          step={100}
          value={config.trigger.auto_interval_ms}
          onChange={(e) =>
            onChange("trigger", { ...config.trigger, auto_interval_ms: Number(e.target.value) })
          }
        />
        <span className="text-slate-600 dark:text-slate-300 text-sm w-14 text-right">
          {config.trigger.auto_interval_ms}ms
        </span>
      </Row>
      <Row label={t("trigger_threshold")}>
        <input
          type="range"
          min={1}
          max={20}
          value={config.trigger.change_threshold}
          onChange={(e) =>
            onChange("trigger", { ...config.trigger, change_threshold: Number(e.target.value) })
          }
        />
        <span className="text-slate-600 dark:text-slate-300 text-sm w-6 text-right">
          {config.trigger.change_threshold}
        </span>
      </Row>
    </div>
  );
}

const FONT_PRESETS = [
  "Microsoft YaHei UI",
  "Microsoft YaHei",
  "SimHei",
  "NSimSun",
  "Consolas",
  "monospace",
];

function DisplayTab({ config, onChange }: { config: AppConfig; onChange: ChangeHandler }) {
  const { t } = useLangStore();
  const [useCustomFont, setUseCustomFont] = useState(
    !FONT_PRESETS.includes(config.display.font_family)
  );

  return (
    <div>
      <SectionTitle>{t("display_section")}</SectionTitle>
      <Row label={t("display_bg_hue")}>
        <input
          type="range"
          min={0}
          max={360}
          value={config.display.bg_hue}
          onChange={(e) =>
            onChange("display", { ...config.display, bg_hue: Number(e.target.value) })
          }
        />
        <span className="text-sm text-slate-600 dark:text-slate-300 w-8">{config.display.bg_hue}</span>
      </Row>
      <Row label={t("display_bg_opacity")}>
        <input
          type="range"
          min={0}
          max={100}
          value={config.display.bg_opacity}
          onChange={(e) =>
            onChange("display", { ...config.display, bg_opacity: Number(e.target.value) })
          }
        />
        <span className="text-sm text-slate-600 dark:text-slate-300 w-8">{config.display.bg_opacity}%</span>
      </Row>
      <Row label={t("display_font_size")}>
        <input
          type="range"
          min={12}
          max={36}
          value={config.display.font_size}
          onChange={(e) =>
            onChange("display", { ...config.display, font_size: Number(e.target.value) })
          }
        />
        <span className="text-sm text-slate-600 dark:text-slate-300 w-8">{config.display.font_size}px</span>
      </Row>
      <Row label={t("display_font_color")}>
        <input
          type="color"
          value={config.display.font_color}
          className="w-8 h-8 rounded cursor-pointer"
          onChange={(e) =>
            onChange("display", { ...config.display, font_color: e.target.value })
          }
        />
      </Row>
      <Row label={t("display_font_family")}>
        <select
          className="bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1 max-w-[180px]"
          value={useCustomFont ? "__custom__" : config.display.font_family}
          onChange={(e) => {
            if (e.target.value === "__custom__") {
              setUseCustomFont(true);
            } else {
              setUseCustomFont(false);
              onChange("display", { ...config.display, font_family: e.target.value });
            }
          }}
        >
          {FONT_PRESETS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
          <option value="__custom__">{t("display_font_custom")}</option>
        </select>
      </Row>
      {useCustomFont && (
        <Row label="">
          <input
            key={config.display.font_family}
            className="bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1 w-48"
            defaultValue={config.display.font_family}
            placeholder="e.g. Arial"
            onBlur={(e) =>
              onChange("display", { ...config.display, font_family: e.target.value })
            }
          />
        </Row>
      )}
      <div className="mt-5 border-t border-slate-200 dark:border-slate-700/50 pt-4">
        <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">{t("display_preview_title")}</p>
        <div
          data-testid="display-style-preview"
          className="min-h-20 rounded border border-slate-300 dark:border-white/10 p-4 transition-colors"
          style={{
            backgroundColor: `hsla(${config.display.bg_hue}, 28%, 18%, ${config.display.bg_opacity / 100})`,
            color: config.display.font_color,
            fontFamily: config.display.font_family,
            fontSize: `${config.display.font_size}px`,
          }}
        >
          {t("display_preview_text")}
        </div>
      </div>
    </div>
  );
}

function CaptureTab({ config, onChange }: { config: AppConfig; onChange: ChangeHandler }) {
  const { t } = useLangStore();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      const url = await invoke<string | null>("get_last_screenshot");
      setPreviewUrl(url ?? null);
    } catch (e) {
      console.error(e);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleTestOcr = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await invoke<string>("test_ocr_engine");
      setTestResult(`${t("ocr_test_success")}: "${result}"`);
    } catch (e) {
      console.error("OCR test failed:", e);
      setTestResult(`${t("ocr_test_error")}：${t(userFacingErrorKey(e, "translation"))}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <SectionTitle>{t("capture_section")}</SectionTitle>
      <Row label={t("capture_show_border")}>
        <input
          type="checkbox"
          checked={config.capture_region.show_border}
          onChange={(e) =>
            onChange("capture_region", { ...config.capture_region, show_border: e.target.checked })
          }
        />
      </Row>
      <Row label={t("capture_border_hue")}>
        <input
          type="range"
          min={0}
          max={360}
          value={config.capture_region.border_hue}
          onChange={(e) =>
            onChange("capture_region", { ...config.capture_region, border_hue: Number(e.target.value) })
          }
        />
        <span className="text-sm text-slate-600 dark:text-slate-300 w-8">{config.capture_region.border_hue}</span>
      </Row>
      <Row label={t("capture_border_opacity")}>
        <input
          type="range"
          min={0}
          max={100}
          value={config.capture_region.border_opacity}
          onChange={(e) =>
            onChange("capture_region", { ...config.capture_region, border_opacity: Number(e.target.value) })
          }
        />
        <span className="text-sm text-slate-600 dark:text-slate-300 w-8">{config.capture_region.border_opacity}%</span>
      </Row>

      <div className="mt-5 border-t border-slate-200 dark:border-slate-700/50 pt-4">
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-2">{t("capture_preview_title")}</p>
        <button
          className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-sm rounded"
          onClick={handlePreview}
          disabled={previewLoading}
        >
          {t("capture_preview_btn")}
        </button>
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="capture preview"
            className="mt-2 max-w-full rounded border border-slate-300 dark:border-slate-600"
          />
        ) : (
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">{t("capture_no_preview")}</p>
        )}
      </div>

      {/* OCR self-test section (moved from OcrTab) */}
      <div className="mt-5 border-t border-slate-200 dark:border-slate-700/50 pt-4">
        <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-3">{t("ocr_section")}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{t("ocr_winrt")}</p>
        <div className="mb-3 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 p-2 rounded">
          {t("ocr_winrt_note")}
        </div>
        <button
          className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-sm rounded flex items-center gap-1.5"
          onClick={handleTestOcr}
          disabled={testing}
        >
          <Bug size={14} />
          {testing ? t("ocr_testing_btn") : t("ocr_test_btn")}
        </button>
        {testResult && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{testResult}</p>}
      </div>
    </div>
  );
}

function TranslationTab({
  config,
  onChange,
  presets,
  onOpenApi,
}: {
  config: AppConfig;
  onChange: ChangeHandler;
  presets: PresetInfo[];
  onOpenApi: () => void;
}) {
  const { t } = useLangStore();

  const mode = config.translation.mode ?? "speed";
  const sourceLang = config.translation.source_lang ?? "en";
  const targetLang = config.translation.target_lang ?? "zh";

  const qualityAvailable = qualityCapability(config.api, presets);

  // Check OCR language pack availability for Speed/Local modes
  const [ocrLangAvailable, setOcrLangAvailable] = useState<boolean | null>(null);
  const needsOcr = mode === "speed" || mode === "local";

  useEffect(() => {
    if (!needsOcr || sourceLang === "auto") {
      setOcrLangAvailable(null);
      return;
    }
    // Map source lang to BCP-47 tag
    const tagMap: Record<string, string> = { en: "en-US", ja: "ja-JP", zh: "zh-Hans" };
    const tag = tagMap[sourceLang];
    if (!tag) {
      setOcrLangAvailable(null);
      return;
    }
    invoke<boolean>("check_ocr_language", { lang: tag }).then(setOcrLangAvailable).catch(() => setOcrLangAvailable(null));
  }, [sourceLang, needsOcr]);

  return (
    <div>
      <SectionTitle>{t("translation_section")}</SectionTitle>

      {/* Translation mode selector */}
      <Row label={t("translation_mode")}>
        <select
          className="bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1"
          value={mode}
          onChange={(e) =>
            onChange("translation", {
              ...config.translation,
              mode: e.target.value as TranslationMode,
            })
          }
        >
          <option value="speed">{t("mode_speed")}</option>
          <option value="quality" disabled={!qualityAvailable}>
            {t("mode_quality")}{!qualityAvailable ? ` (${t("mode_quality_no_vision")})` : ""}
          </option>
          <option value="local">
            {t("mode_local")}
          </option>
        </select>
      </Row>

      {mode === "speed" && (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 p-2 rounded">
          {t("mode_speed_desc")}
        </div>
      )}
      {showQualityUnavailableHint(mode, qualityAvailable) && (
        <div className="mt-1 text-xs text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-2 rounded">
          {t("mode_quality_no_vision_hint")}
          <button className="ml-2 underline" onClick={onOpenApi}>{t("mode_quality_open_api")}</button>
        </div>
      )}
      {mode === "quality" && qualityAvailable && (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 p-2 rounded">
          {t("mode_quality_desc")}
        </div>
      )}
      {mode === "local" && (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 p-2 rounded">
          {t("mode_local_desc")}
        </div>
      )}

      {/* Source language */}
      <Row label={t("source_lang")}>
        <select
          className="bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1"
          value={sourceLang}
          onChange={(e) =>
            onChange("translation", {
              ...config.translation,
              source_lang: e.target.value as SourceLang,
            })
          }
        >
          {SUPPORTED_SOURCE_LANGS.map((source) => (
            <option key={source} value={source}>
              {t(source === "en" ? "lang_en" : source === "zh" ? "lang_zh" : "lang_ja")}
            </option>
          ))}
        </select>
      </Row>

      {/* Target language */}
      <Row label={t("target_lang")}>
        <select
          className="bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1"
          value={targetLang}
          onChange={(e) =>
            onChange("translation", {
              ...config.translation,
              target_lang: e.target.value as TargetLang,
            })
          }
        >
          {SUPPORTED_TARGET_LANGS.map((target) => (
            <option key={target} value={target}>
              {t(target === "en" ? "lang_en" : target === "zh" ? "lang_zh" : "lang_ja")}
            </option>
          ))}
        </select>
      </Row>

      {sourceLang !== "en" && (
        <div className="mt-1 text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-700 p-2 rounded">
          {t("translation_winrt_lang_warn")}
        </div>
      )}

      {needsOcr && ocrLangAvailable === false && (
        <div className="mt-1 text-xs text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-2 rounded">
          {t("ocr_lang_missing_hint")}
        </div>
      )}

      <Row label={t("translation_context_size")}>
        <input
          type="range"
          min={1}
          max={20}
          value={config.translation.context_size}
          onChange={(e) =>
            onChange("translation", { ...config.translation, context_size: Number(e.target.value) })
          }
        />
        <span className="text-sm text-slate-600 dark:text-slate-300 w-6">{config.translation.context_size}</span>
      </Row>

      {/* Local config section */}
      <div className="mt-6 border-t border-slate-200 dark:border-slate-700/50 pt-4">
        <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-3">{t("local_section")}</h3>
        {mode !== "local" && (
          <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 p-2 rounded mb-3">
            {t("local_section_hint")}
          </div>
        )}

        <Row label={t("local_backend")}>
          <select
            className="bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1"
            value={config.local.backend}
            onChange={(e) =>
              onChange("local", {
                ...config.local,
                backend: e.target.value as LocalBackend,
              })
            }
          >
            <option value="bundled_llama_cpp">{t("local_backend_bundled")}</option>
            <option value="custom_loopback">{t("local_backend_custom")}</option>
          </select>
        </Row>

        {config.local.backend === "bundled_llama_cpp" && (
          <>
            <Row label={t("local_model")}>
              <select
                className="bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1"
                value={config.local.model}
                onChange={(e) =>
                  onChange("local", {
                    ...config.local,
                    model: e.target.value as LocalModel,
                  })
                }
              >
                <option value="qwen3_4b">{t("local_model_qwen3_4b")}</option>
                <option value="qwen3_8b">{t("local_model_qwen3_8b")}</option>
              </select>
            </Row>
            <LocalModelManager model={config.local.model} />
            <p className="ml-4 mt-2 text-xs text-amber-600 dark:text-amber-300/90">
              {t("local_resource_note")}
            </p>
          </>
        )}

        {config.local.backend === "custom_loopback" && (
          <>
            <Row label={t("local_custom_url")}>
              <input
                className="bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1 w-64"
                value={config.local.custom_base_url ?? ""}
                onChange={(e) =>
                  onChange("local", {
                    ...config.local,
                    custom_base_url: e.target.value,
                  })
                }
                placeholder="http://localhost:8080/v1"
              />
            </Row>
            <Row label={t("local_custom_model")}>
              <input
                className="bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1 w-64"
                value={config.local.custom_model ?? ""}
                onChange={(e) =>
                  onChange("local", {
                    ...config.local,
                    custom_model: e.target.value,
                  })
                }
                placeholder="my-llama-model"
              />
            </Row>
          </>
        )}

        <LocalRuntimeStatus backend={config.local.backend} />
      </div>
    </div>
  );
}

// ── Local model download/status components ──

interface LocalStatus {
  runtime_packaged: boolean;
  model_state: string;
  model_bytes: number;
  model_expected_bytes: number;
  download_progress: number;
  server_state: string;
  active_model: string | null;
  endpoint: string | null;
  last_error: string | null;
}

interface LocalModelProgress {
  model_id: string;
  downloaded: number;
  total: number;
  progress: number;
  done: boolean;
  error: string | null;
}

function LocalModelManager({ model }: { model: LocalModel }) {
  const { t } = useLangStore();
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = async () => {
    try {
      const s = await invoke<LocalStatus>("get_local_status");
      setStatus(s);
    } catch (e) {
      console.error("Failed to get local status:", e);
    }
  };

  useEffect(() => {
    void refreshStatus();
    const unlisten = listen<LocalModelProgress>("local-model-progress", (event) => {
      if (event.payload.model_id !== model) return;
      setProgress(event.payload.progress);
      setDownloading(!event.payload.done);
      if (event.payload.error) {
        console.error("Local model download failed:", event.payload.error);
        setError(t("error_local_operation"));
      }
      if (event.payload.done) void refreshStatus();
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [model]);

  const handleDownload = async () => {
    setDownloading(true);
    setProgress(0);
    setError(null);
    try {
      await invoke("download_local_model", { modelId: model });
      await refreshStatus();
    } catch (e) {
      console.error("Local model download failed:", e);
      setError(t(userFacingErrorKey(e, "local")));
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await invoke("delete_local_model", { modelId: model });
      await refreshStatus();
    } catch (e) {
      console.error("Local model delete failed:", e);
      setError(t(userFacingErrorKey(e, "local")));
    }
  };

  const handleCancel = async () => {
    try {
      await invoke("cancel_local_model_download");
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  };

  const isDownloaded = status?.model_state === "ready";
  const downloadedBytes = status?.model_bytes ?? 0;

  return (
    <div className="ml-4 mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {isDownloaded
            ? `${t("local_model_ready")} (${(downloadedBytes / 1073741824).toFixed(1)} GB)`
            : downloading
            ? `${t("local_model_downloading")} ${(progress * 100).toFixed(0)}%`
            : t("local_model_not_downloaded")}
        </span>
      </div>

      {downloading && (
        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded h-2">
          <div
            className="bg-brand-indigo h-2 rounded transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}

      <div className="flex gap-2">
        {!isDownloaded && !downloading && (
          <button
            className="px-3 py-1 text-xs bg-brand-indigo hover:bg-indigo-600 text-white rounded"
            onClick={handleDownload}
          >
            {t("local_download_btn")}
          </button>
        )}
        {downloading && (
          <button
            className="px-3 py-1 text-xs bg-rose-500 hover:bg-rose-600 text-white rounded"
            onClick={handleCancel}
          >
            {t("local_cancel_btn")}
          </button>
        )}
        {isDownloaded && (
          <button
            className="px-3 py-1 text-xs bg-rose-500 hover:bg-rose-600 text-white rounded"
            onClick={handleDelete}
          >
            {t("local_delete_btn")}
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-500">{error}</p>
      )}
    </div>
  );
}

function LocalRuntimeStatus({ backend }: { backend: LocalBackend }) {
  const { t } = useLangStore();
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testIsError, setTestIsError] = useState(false);
  const lastLoggedRuntimeError = useRef<string | null>(null);

  const refreshStatus = async () => {
    try {
      const s = await invoke<LocalStatus>("get_local_status");
      setStatus(s);
    } catch (e) {
      console.error("Failed to get local status:", e);
    }
  };

  useEffect(() => {
    void refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (status?.last_error && status.last_error !== lastLoggedRuntimeError.current) {
      console.error("Local runtime reported an error:", status.last_error);
      lastLoggedRuntimeError.current = status.last_error;
    }
  }, [status?.last_error]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestIsError(false);
    try {
      const result = await invoke<string>("test_local_runtime");
      setTestResult(result);
    } catch (e) {
      console.error("Local runtime test failed:", e);
      setTestResult(t(userFacingErrorKey(e, "local")));
      setTestIsError(true);
    } finally {
      setTesting(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    setTestResult(null);
    setTestIsError(false);
    try {
      await invoke("start_local_runtime");
      await refreshStatus();
    } catch (e) {
      console.error("Local runtime start failed:", e);
      setTestResult(t(userFacingErrorKey(e, "local")));
      setTestIsError(true);
      await refreshStatus();
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await invoke("stop_local_runtime");
      await refreshStatus();
    } catch (e) {
      console.error("Stop failed:", e);
    }
  };

  const stateColor: Record<string, string> = {
    stopped: "text-slate-400",
    starting: "text-amber-500",
    healthy: "text-emerald-500",
    stopping: "text-amber-500",
    failed: "text-rose-500",
  };

  return (
    <div className="mt-4 border-t border-slate-200 dark:border-slate-700/50 pt-3 space-y-2">
      <Row label={t("local_status_runtime")}>
        <span className={`text-sm ${stateColor[status?.server_state ?? "stopped"]}`}>
          {t(`local_server_${status?.server_state ?? "stopped"}` as any)}
        </span>
      </Row>

      {status?.active_model && (
        <Row label={t("local_active_model")}>
          <span className="text-sm text-slate-600 dark:text-slate-300">{status.active_model}</span>
        </Row>
      )}

      {status?.endpoint && (
        <Row label={t("local_endpoint")}>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{status.endpoint}</span>
        </Row>
      )}

      {status?.last_error && (
        <div className="text-xs text-rose-500 bg-rose-50 dark:bg-rose-900/20 p-2 rounded">
          {t(userFacingErrorKey(status.last_error, "local"))}
        </div>
      )}

      {backend === "bundled_llama_cpp" && status && !status.runtime_packaged && (
        <div className="text-xs text-rose-500 bg-rose-50 dark:bg-rose-900/20 p-2 rounded">
          {t("local_runtime_missing")}
        </div>
      )}

      <div className="flex gap-2">
        {backend === "bundled_llama_cpp" &&
          status?.runtime_packaged &&
          status.model_state === "ready" &&
          (status.server_state === "stopped" || status.server_state === "failed") && (
            <button
              className="px-3 py-1 text-xs bg-brand-indigo hover:bg-indigo-600 text-white rounded disabled:opacity-50"
              onClick={handleStart}
              disabled={starting}
            >
              {starting ? t("local_starting_btn") : t("local_start_btn")}
            </button>
          )}
        <button
          className="px-3 py-1 text-xs bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded"
          onClick={handleTest}
          disabled={testing || (backend === "bundled_llama_cpp" && status?.server_state !== "healthy")}
        >
          {testing ? t("local_testing_btn") : t("local_test_btn")}
        </button>
        {status?.server_state === "healthy" && (
          <button
            className="px-3 py-1 text-xs bg-rose-500 hover:bg-rose-600 text-white rounded"
            onClick={handleStop}
          >
            {t("local_stop_btn")}
          </button>
        )}
      </div>

      {testResult && (
        <p className={`text-xs ${testIsError ? "text-rose-500" : "text-emerald-500"}`}>
          {testResult}
        </p>
      )}
    </div>
  );
}

type ApiTestResult = {
  provider: string;
  model: string;
  test_type: string;
  latency_ms: number;
  output: string;
};

function imageModelLabel(model: string, t: (key: I18nKeys) => string): string {
  const suffix: Partial<Record<string, I18nKeys>> = {
    "qwen3.6-flash": "api_model_recommended",
    "qwen3.7-plus": "api_model_high_quality",
    "gemini-3.1-flash-lite": "api_model_low_cost",
    "gemini-3.5-flash": "api_model_high_quality",
  };
  const key = suffix[model];
  return key ? `${model} · ${t(key)}` : model;
}

export function ApiTab({
  config,
  onChange,
  presets,
  isLoading,
}: {
  config: AppConfig;
  onChange: ChangeHandler;
  presets: PresetInfo[];
  isLoading: boolean;
}) {
  const { t } = useLangStore();
  const { clearApiKey } = useConfigStore();
  const [testing, setTesting] = useState<"text" | "vision" | null>(null);
  const [textResult, setTextResult] = useState<ApiTestResult | null>(null);
  const [visionResult, setVisionResult] = useState<ApiTestResult | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);

  const currentProvider = config.api.provider;
  const selectedPreset = presets.find((p) => p.id === currentProvider);
  const isCustomProvider = currentProvider === "custom";
  const visionProfile = resolvedVisionProfile(config.api, presets);
  const qualityAvailable = qualityCapability(config.api, presets);
  const separateVision = config.api.vision.mode === "separate";
  const visionPreset = presets.find((p) => p.id === config.api.vision.provider);
  const isCustomVision = config.api.vision.provider === "custom";
  const visionPresets = presets.filter((preset) => preset.supports_vision);

  const handleProviderChange = (providerId: string) => {
    const preset = presets.find((p) => p.id === providerId);
    if (preset) {
      onChange("api", selectProviderConfig(config.api, preset));
    } else {
      onChange("api", {
        ...config.api,
        provider: "custom",
        api_key: "",
        qwen_region: null,
        base_url: "",
        text_model: config.api.text_model || "",
        vlm_model: "",
        custom_supports_vision: false,
      });
    }
  };

  const handleVisionProviderChange = (providerId: string) => {
    const preset = visionPresets.find((candidate) => candidate.id === providerId);
    if (preset) {
      onChange("api", selectVisionProviderConfig(config.api, preset));
      return;
    }
    onChange("api", {
      ...config.api,
      vision: {
        ...config.api.vision,
        mode: "separate",
        provider: "custom",
        qwen_region: null,
        base_url: "",
        api_key: "",
        model: "",
        custom_supports_vision: false,
      },
    });
  };

  const handleTest = async (kind: "text" | "vision") => {
    const apiKey = kind === "text" ? config.api.api_key : visionProfile.apiKey;
    const setError = kind === "text" ? setTextError : setVisionError;
    const setResult = kind === "text" ? setTextResult : setVisionResult;
    if (!apiTestAvailable(isLoading, apiKey)) {
      setError(t("api_key_required_visible"));
      return;
    }
    setTesting(kind);
    setResult(null);
    setError(null);
    try {
      const result = await invoke<ApiTestResult>(
        kind === "text" ? "test_api_text" : "test_api_vlm",
        { api: config.api },
      );
      setResult(result);
    } catch (e) {
      console.error("API test failed:", e);
      setResult(null);
      setError(t(userFacingErrorKey(e, kind === "text" ? "api_text" : "api_vision")));
    } finally {
      setTesting(null);
    }
  };

  const resultLine = (result: ApiTestResult | null, error: string | null) => {
    if (error) return <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{`${t("api_test_fail")}：${error}`}</p>;
    if (!result) return null;
    return (
      <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
        {`${t("api_test_ok")}：${result.provider} · ${result.model} · ${result.latency_ms}ms — ${result.output}`}
      </p>
    );
  };

  const selectClass = "bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1 w-64";
  const inputClass = "bg-slate-200 dark:bg-slate-700 text-sm rounded px-2 py-1 w-64";
  const cardClass = "rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/45";

  return (
    <div>
      <SectionTitle>{t("api_section")}</SectionTitle>

      <div className="space-y-4">
        <section className={cardClass} aria-labelledby="api-text-card-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 id="api-text-card-title" className="font-semibold text-slate-900 dark:text-slate-100">{t("api_text_card")}</h3>
            <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{t("api_text_usage")}</span>
          </div>

          <Row label={t("api_text_provider")}>
            <select aria-label={t("api_text_provider")} className={selectClass} value={currentProvider} onChange={(e) => handleProviderChange(e.target.value)}>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              <option value="custom">{t("api_provider_custom")}</option>
            </select>
          </Row>

          {currentProvider === "qwen" && (
            <Row label={t("api_qwen_region")}>
              <select aria-label={t("api_qwen_region")} className={selectClass} value={config.api.qwen_region ?? "domestic"} onChange={(e) => onChange("api", { ...config.api, qwen_region: e.target.value as "domestic" | "international", base_url: "" })}>
                <option value="domestic">{t("api_qwen_domestic")}</option>
                <option value="international">{t("api_qwen_international")}</option>
              </select>
            </Row>
          )}

          <Row label={t("api_key_label")}>
            <input aria-label={t("api_key_label")} type="password" className={inputClass} value={config.api.api_key} onChange={(e) => onChange("api", { ...config.api, api_key: e.target.value })} placeholder={t("api_key_placeholder")} />
            <button className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/30 disabled:opacity-40" disabled={isLoading || !config.api.api_key} onClick={async () => {
              if (!confirm(t("api_clear_text_key_confirm"))) return;
              await clearApiKey("text");
              setTextResult(null);
            }}>{t("api_clear_key")}</button>
          </Row>

          <Row label={t("api_base_url")}>
            {isCustomProvider ? (
              <input aria-label={t("api_base_url")} className={inputClass} value={config.api.base_url} onChange={(e) => onChange("api", { ...config.api, base_url: e.target.value })} placeholder="https://api.example.com" />
            ) : (
              <span className="max-w-[300px] truncate text-xs text-slate-500 dark:text-slate-400">{resolvePresetBaseUrl(selectedPreset, config.api.qwen_region) || config.api.base_url}</span>
            )}
          </Row>

          <Row label={t("api_text_model")}>
            {selectedPreset?.text_models.length ? (
              <select aria-label={t("api_text_model")} className={selectClass} value={selectedPreset.text_models.includes(config.api.text_model) ? config.api.text_model : "__custom__"} onChange={(e) => onChange("api", { ...config.api, text_model: e.target.value === "__custom__" ? "" : e.target.value })}>
                {selectedPreset.text_models.map((model) => <option key={model} value={model}>{model}</option>)}
                <option value="__custom__">{t("api_provider_custom")}</option>
              </select>
            ) : (
              <input aria-label={t("api_text_model")} className={inputClass} value={config.api.text_model} onChange={(e) => onChange("api", { ...config.api, text_model: e.target.value })} placeholder="model-name" />
            )}
          </Row>
          {selectedPreset && !selectedPreset.text_models.includes(config.api.text_model) && (
            <Row label=""><input aria-label={`${t("api_text_model")} custom`} className={inputClass} value={config.api.text_model} onChange={(e) => onChange("api", { ...config.api, text_model: e.target.value })} placeholder="model-name" /></Row>
          )}

          <button className="mt-3 rounded bg-brand-indigo px-3 py-1.5 text-sm text-white hover:bg-indigo-600 disabled:opacity-50" onClick={() => void handleTest("text")} disabled={testing !== null || !apiTestAvailable(isLoading, config.api.api_key)}>
            {testing === "text" ? t("api_testing_text") : t("api_test_text")}
          </button>
          {resultLine(textResult, textError)}
        </section>

        <section className={cardClass} aria-labelledby="api-vision-card-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 id="api-vision-card-title" className="font-semibold text-slate-900 dark:text-slate-100">{t("api_vision_card")}</h3>
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">{t("api_vision_usage")}</span>
          </div>

          <div className="mb-3 inline-flex rounded-lg bg-slate-200 p-1 dark:bg-slate-700" role="group">
            {(["follow_text", "separate"] as const).map((mode) => (
              <button key={mode} className={`rounded-md px-3 py-1.5 text-xs ${config.api.vision.mode === mode ? "bg-white font-medium text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white" : "text-slate-600 dark:text-slate-300"}`} onClick={() => onChange("api", { ...config.api, vision: { ...config.api.vision, mode } })}>
                {mode === "follow_text" ? t("api_vision_follow") : t("api_vision_separate")}
              </button>
            ))}
          </div>

          {separateVision ? (
            <>
              <Row label={t("api_vision_provider")}>
                <select aria-label={t("api_vision_provider")} className={selectClass} value={config.api.vision.provider} onChange={(e) => handleVisionProviderChange(e.target.value)}>
                  {visionPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                  <option value="custom">{t("api_provider_custom")}</option>
                </select>
              </Row>
              {config.api.vision.provider === "qwen" && (
                <Row label={t("api_qwen_region")}>
                  <select aria-label={`${t("api_qwen_region")} vision`} className={selectClass} value={config.api.vision.qwen_region ?? "domestic"} onChange={(e) => onChange("api", { ...config.api, vision: { ...config.api.vision, qwen_region: e.target.value as "domestic" | "international", base_url: "" } })}>
                    <option value="domestic">{t("api_qwen_domestic")}</option>
                    <option value="international">{t("api_qwen_international")}</option>
                  </select>
                </Row>
              )}
              <Row label={t("api_key_label")}>
                <input aria-label={t("api_key_label")} type="password" className={inputClass} value={config.api.vision.api_key} onChange={(e) => onChange("api", { ...config.api, vision: { ...config.api.vision, api_key: e.target.value } })} placeholder={t("api_key_placeholder")} />
                <button className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/30 disabled:opacity-40" disabled={isLoading || !config.api.vision.api_key} onClick={async () => {
                  if (!confirm(t("api_clear_vision_key_confirm"))) return;
                  await clearApiKey("vision");
                  setVisionResult(null);
                }}>{t("api_clear_key")}</button>
              </Row>
              <Row label={t("api_base_url")}>
                {isCustomVision ? (
                  <input aria-label={`${t("api_base_url")} vision`} className={inputClass} value={config.api.vision.base_url} onChange={(e) => onChange("api", { ...config.api, vision: { ...config.api.vision, base_url: e.target.value } })} placeholder="https://api.example.com" />
                ) : (
                  <span className="max-w-[300px] truncate text-xs text-slate-500 dark:text-slate-400">{resolvePresetBaseUrl(visionPreset, config.api.vision.qwen_region) || config.api.vision.base_url}</span>
                )}
              </Row>
              <Row label={t("api_vision_model")}>
                {visionPreset?.vlm_models.length ? (
                  <select aria-label={t("api_vision_model")} className={selectClass} value={config.api.vision.model} onChange={(e) => onChange("api", { ...config.api, vision: { ...config.api.vision, model: e.target.value } })}>
                    {visionPreset.vlm_models.map((model) => <option key={model} value={model}>{imageModelLabel(model, t)}</option>)}
                  </select>
                ) : (
                  <input aria-label={t("api_vision_model")} className={inputClass} value={config.api.vision.model} onChange={(e) => onChange("api", { ...config.api, vision: { ...config.api.vision, model: e.target.value } })} placeholder={t("api_vision_placeholder")} />
                )}
              </Row>
              {isCustomVision && (
                <Row label={t("api_custom_vision")}><input type="checkbox" checked={config.api.vision.custom_supports_vision} onChange={(e) => onChange("api", { ...config.api, vision: { ...config.api.vision, custom_supports_vision: e.target.checked } })} /></Row>
              )}
            </>
          ) : qualityAvailable ? (
            <Row label={t("api_vision_model")}>
              {selectedPreset?.vlm_models.length ? (
                <select aria-label={t("api_vision_model")} className={selectClass} value={visionProfile.model} onChange={(e) => onChange("api", { ...config.api, vlm_model: e.target.value })}>
                  {selectedPreset.vlm_models.map((model) => <option key={model} value={model}>{imageModelLabel(model, t)}</option>)}
                </select>
              ) : (
                <input aria-label={t("api_vision_model")} className={inputClass} value={config.api.vlm_model} onChange={(e) => onChange("api", { ...config.api, vlm_model: e.target.value })} placeholder={t("api_vision_placeholder")} />
              )}
            </Row>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-200">
              <p>{t("api_vision_unsupported")}</p>
              <button className="mt-2 font-medium underline" onClick={() => onChange("api", { ...config.api, vision: { ...config.api.vision, mode: "separate" } })}>{t("api_use_separate")}</button>
            </div>
          )}

          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t("api_vision_service_fallback")}</p>
          {(separateVision || qualityAvailable) && (
            <>
              <button className="mt-3 rounded bg-brand-violet px-3 py-1.5 text-sm text-white hover:bg-violet-600 disabled:opacity-50" onClick={() => void handleTest("vision")} disabled={testing !== null || !qualityAvailable || !apiTestAvailable(isLoading, visionProfile.apiKey)}>
                {testing === "vision" ? t("api_testing_vision") : t("api_test_vision")}
              </button>
              {resultLine(visionResult, visionError)}
            </>
          )}
        </section>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>{t("api_key_note")}</span>
        <button className="underline" onClick={() => open("https://help.aliyun.com/zh/model-studio/vision-model/")}>{t("api_qwen_docs")}</button>
        <button className="underline" onClick={() => open("https://ai.google.dev/gemini-api/docs/models")}>{t("api_gemini_docs")}</button>
      </div>
    </div>
  );
}

// ---- Hotkey capture helper ----

function formatHotkey(e: KeyboardEvent): string {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return "";
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  let key = e.code;
  if (key.startsWith("Key")) key = key.slice(3);
  else if (key.startsWith("Digit")) key = key.slice(5);
  else if (key.startsWith("Numpad")) key = `Numpad${key.slice(6)}`;
  parts.push(key);
  return parts.join("+");
}

function HotkeyCapture({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  const { t } = useLangStore();
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const key = formatHotkey(e);
      if (key) {
        onChange(key);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [recording, onChange]);

  return (
    <button
      className={`text-sm rounded px-3 py-1 w-32 text-center transition-colors ${
        recording
          ? "bg-brand-indigo text-white ring-2 ring-indigo-400"
          : "bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600"
      }`}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
    >
      {recording ? t("trigger_hotkey_recording") : value || t("trigger_hotkey_click")}
    </button>
  );
}

function AboutTab() {
  const { t } = useLangStore();
  return (
    <div>
      <SectionTitle>{t("about_section")}</SectionTitle>
      <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-950/40">
            <img
              src={brandSignal}
              alt=""
              className="h-full w-full scale-[1.65]"
              aria-hidden="true"
            />
          </div>
          <p>
            <strong className="text-slate-900 dark:text-white">OverlayTrans v3.0.4</strong> — {t("about_description")}
          </p>
        </div>
        <p>{t("about_for")}</p>
        <div className="flex gap-3 flex-wrap">
          <button
            className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded flex items-center gap-1.5"
            onClick={() => open(ABOUT_LINKS.repo)}
          >
            <ExternalLink size={14} />
            {t("about_github")}
          </button>
          <button
            className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded flex items-center gap-1.5"
            onClick={() => open(ABOUT_LINKS.issues)}
          >
            <Bug size={14} />
            {t("about_issues")}
          </button>
          <button
            className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded flex items-center gap-1.5"
            onClick={async () => {
              await invoke("show_onboarding_window");
            }}
          >
            <RotateCcw size={14} />
            {t("about_replay_onboarding")}
          </button>
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-4 space-y-1">
          <p>{t("about_tech_stack")}</p>
          <p>{t("about_ocr_v3")}</p>
          <p>{t("about_translation_v3")}</p>
          <p>{t("about_license")}</p>
        </div>
      </div>
    </div>
  );
}
