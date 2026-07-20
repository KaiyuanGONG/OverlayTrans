/**
 * Onboarding — five-step first-run guide with brand identity.
 * Steps: Welcome → Three Modes → Provider Setup → Capture Usage → Done
 *
 * Theme-aware: follows system/light/dark via themeStore.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useConfigStore } from "@/stores/configStore";
import { useLangStore } from "@/stores/langStore";
import { useThemeStore } from "@/stores/themeStore";
import { LangCode } from "@/i18n";
import type { PresetInfo, ProviderId } from "@/types/config";
import { applyOnboardingSelection } from "@/lib/onboardingConfig";
import brandSignal from "@/assets/brand/chameleon-signal.svg";
import { Zap, Eye, Lock, ArrowRight, ArrowLeft, Rocket } from "lucide-react";

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [setupKind, setSetupKind] = useState<"unchanged" | "online" | "local">("unchanged");
  const [providerId, setProviderId] = useState<ProviderId>("deepseek");
  const { config, loadConfig } = useConfigStore();
  const { t, lang, setLang } = useLangStore();
  const { initFromConfig } = useThemeStore();

  useEffect(() => {
    void loadConfig();
    void invoke<PresetInfo[]>("get_presets")
      .then((items) => setPresets(items.filter((item) => item.id !== "custom")))
      .catch((error) => console.error("Failed to load provider presets:", error));
  }, []);

  useEffect(() => {
    initFromConfig(config.ui?.theme ?? "system");
  }, [config.ui?.theme, initFromConfig]);

  useEffect(() => {
    setApiKey(config.api.api_key);
    if (config.api.provider !== "custom") setProviderId(config.api.provider);
  }, [config.api.api_key, config.api.provider]);

  const TOTAL = 5;
  const isLast = step === TOTAL - 1;

  const resetForReplay = () => {
    setStep(0);
    setSetupKind("unchanged");
    setApiKey(config.api.api_key);
    if (config.api.provider !== "custom") setProviderId(config.api.provider);
  };

  useEffect(() => {
    const unlisten = listen("onboarding-replay-requested", () => {
      resetForReplay();
      void loadConfig();
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [config.api.api_key, config.api.provider, loadConfig]);

  const complete = async (saveSelection: boolean) => {
    if (saveSelection && setupKind !== "unchanged") {
      const selection = setupKind === "local"
        ? { kind: "local" as const }
        : {
            kind: "online" as const,
            preset: presets.find((preset) => preset.id === providerId) ?? presets[0],
            apiKey,
          };

      if (selection.kind === "local" || selection.preset) {
        await invoke("set_config", {
          config: applyOnboardingSelection(config, selection),
        });
      }
    }
    await invoke("set_onboarding_completed", { completed: true });
    await invoke("show_main_windows");
    await invoke("apply_startup_mode");
    resetForReplay();
    await getCurrentWindow().hide();
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-microsoft-yahei select-none">
      {/* Brand header with signal gradient */}
      <div
        className="w-full shrink-0 px-6 py-5 flex items-center gap-4"
        style={{
          background: "linear-gradient(135deg, #22D3EE 0%, #6366F1 50%, #A855F7 100%)",
        }}
      >
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-950/20 shadow-lg">
          <img
            src={brandSignal}
            alt="OverlayTrans"
            className="h-full w-full scale-[1.65]"
          />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white drop-shadow-sm">OverlayTrans</h1>
          <p className="text-xs text-white/80">{t("ob_welcome_desc")}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-slate-200 dark:bg-slate-800 h-1 shrink-0">
        <div
          className="h-1 transition-all duration-300"
          style={{
            width: `${((step + 1) / TOTAL) * 100}%`,
            background: "linear-gradient(90deg, #22D3EE, #6366F1, #A855F7)",
          }}
        />
      </div>

      {/* Step counter */}
      <div className="px-6 pt-3 text-xs text-slate-400">
        {t("ob_step")} {step + 1} {t("ob_of")} {TOTAL}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-3">
        {step === 0 && <WelcomeStep lang={lang} setLang={setLang} t={t} />}
        {step === 1 && <ModesStep t={t} />}
        {step === 2 && (
          <ProviderStep
            apiKey={apiKey}
            setApiKey={setApiKey}
            presets={presets}
            providerId={providerId}
            setProviderId={setProviderId}
            setupKind={setupKind}
            setSetupKind={setSetupKind}
            t={t}
          />
        )}
        {step === 3 && <UsageStep t={t} />}
        {step === 4 && <DoneStep t={t} />}
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center px-6 py-4 border-t border-slate-200 dark:border-slate-800 shrink-0">
        <button
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-sm transition-colors"
          onClick={() => void complete(false)}
        >
          {t("ob_skip")}
        </button>
        <div className="flex gap-2">
          {step > 0 && (
            <button
              className="px-4 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-sm rounded transition-colors flex items-center gap-1"
              onClick={() => setStep((s) => s - 1)}
            >
              <ArrowLeft size={14} />
              {t("ob_prev")}
            </button>
          )}
          {isLast ? (
            <button
              className="px-5 py-1.5 text-sm rounded font-semibold transition-colors flex items-center gap-1.5 text-white"
              style={{ background: "linear-gradient(135deg, #6366F1, #A855F7)" }}
              onClick={() => void complete(true)}
            >
              <Rocket size={14} />
              {t("ob_start")}
            </button>
          ) : (
            <button
              className="px-4 py-1.5 bg-brand-indigo hover:bg-indigo-600 text-white text-sm rounded transition-colors flex items-center gap-1"
              onClick={() => setStep((s) => s + 1)}
            >
              {t("ob_next")}
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Step 1: Welcome + Language ----

function WelcomeStep({
  lang,
  setLang,
  t,
}: {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  t: ReturnType<typeof useLangStore.getState>["t"];
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-2xl font-bold">{t("ob_welcome_title")}</span>
        <div className="flex gap-1">
          {(["zh", "en"] as LangCode[]).map((code) => (
            <button
              key={code}
              onClick={() => setLang(code)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                lang === code
                  ? "bg-brand-indigo text-white"
                  : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              {code === "zh" ? "中文" : "EN"}
            </button>
          ))}
        </div>
      </div>

      <p className="text-slate-500 dark:text-slate-400 text-sm">{t("ob_welcome_desc")}</p>

      <ul className="space-y-2">
        {(
          [
            "ob_welcome_f1",
            "ob_welcome_f2",
            "ob_welcome_f3",
            "ob_welcome_f4",
          ] as const
        ).map((key) => (
          <li key={key} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span className="text-brand-indigo shrink-0">✓</span>
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Step 2: Three Modes Explanation ----

function ModesStep({
  t,
}: {
  t: ReturnType<typeof useLangStore.getState>["t"];
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{t("ob_modes_title")}</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">{t("ob_modes_desc")}</p>

      <div className="space-y-3">
        <ModeCard
          icon={<Zap size={20} className="text-amber-500" />}
          title={t("ob_modes_speed_title")}
          desc={t("ob_modes_speed_desc")}
          gradient="from-amber-500/10 to-amber-500/5"
        />
        <ModeCard
          icon={<Eye size={20} className="text-brand-violet" />}
          title={t("ob_modes_quality_title")}
          desc={t("ob_modes_quality_desc")}
          gradient="from-purple-500/10 to-purple-500/5"
        />
        <ModeCard
          icon={<Lock size={20} className="text-emerald-500" />}
          title={t("ob_modes_local_title")}
          desc={t("ob_modes_local_desc")}
          gradient="from-emerald-500/10 to-emerald-500/5"
        />
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">{t("ob_modes_langs")}</p>
    </div>
  );
}

function ModeCard({ icon, title, desc, gradient }: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  gradient: string;
}) {
  return (
    <div className={`flex gap-3 bg-gradient-to-r ${gradient} dark:from-slate-800 dark:to-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700`}>
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

// ---- Step 3: Provider Setup ----

function ProviderStep({
  apiKey,
  setApiKey,
  presets,
  providerId,
  setProviderId,
  setupKind,
  setSetupKind,
  t,
}: {
  apiKey: string;
  setApiKey: (value: string) => void;
  presets: PresetInfo[];
  providerId: ProviderId;
  setProviderId: (value: ProviderId) => void;
  setupKind: "unchanged" | "online" | "local";
  setSetupKind: (value: "unchanged" | "online" | "local") => void;
  t: ReturnType<typeof useLangStore.getState>["t"];
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{t("ob_setup_title")}</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">{t("ob_setup_desc")}</p>

      <div className="grid grid-cols-3 gap-2">
        {(["unchanged", "online", "local"] as const).map((kind) => (
          <button
            key={kind}
            className={`rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
              setupKind === kind
                ? "border-brand-indigo bg-brand-indigo/10 text-brand-indigo dark:text-indigo-300"
                : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
            onClick={() => setSetupKind(kind)}
          >
            {t(`ob_setup_${kind}`)}
          </button>
        ))}
      </div>

      {setupKind === "online" && (
        <div className="rounded-lg border border-brand-indigo/30 dark:border-brand-indigo/20 bg-brand-indigo/5 dark:bg-brand-indigo/10 p-4">
        <label className="block text-xs text-slate-600 dark:text-slate-300" htmlFor="onboarding-provider">
          {t("api_text_provider")}
        </label>
        <select
          id="onboarding-provider"
          value={providerId}
          onChange={(event) => {
            const nextProvider = event.target.value as ProviderId;
            if (nextProvider !== providerId) setApiKey("");
            setProviderId(nextProvider);
          }}
          className="mt-1 w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm outline-none ring-brand-indigo focus:ring-2 border border-slate-200 dark:border-slate-700"
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("ob_api_desc")}</p>
        <label className="mt-3 block text-xs text-slate-600 dark:text-slate-300" htmlFor="onboarding-api-key">
          {t("api_key_label")}
        </label>
        <input
          id="onboarding-api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          className="mt-1 w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm outline-none ring-brand-indigo focus:ring-2 border border-slate-200 dark:border-slate-700"
          placeholder={t("api_key_placeholder")}
          autoComplete="off"
        />
      </div>
      )}

      {setupKind === "local" && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          {t("ob_setup_local_hint")}
        </p>
      )}
    </div>
  );
}

// ---- Step 4: Capture Usage ----

function UsageStep({ t }: { t: ReturnType<typeof useLangStore.getState>["t"] }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{t("ob_usage_title")}</h2>
      <div className="space-y-3">
        <StepCard number="1" title={t("ob_usage_step1")} sub={t("ob_usage_step1b")} />
        <StepCard number="2" title={t("ob_usage_step2")} sub={t("ob_usage_step2b")} />
        <StepCard number="3" title={t("ob_usage_step3")} sub={t("ob_usage_step3b")} />
      </div>
      <p className="text-xs text-amber-600 dark:text-amber-400">{t("ob_usage_warn")}</p>
    </div>
  );
}

function StepCard({ number, title, sub }: { number: string; title: string; sub: string }) {
  return (
    <div className="flex gap-3 bg-slate-100 dark:bg-slate-800 rounded-lg p-3">
      <span
        className="font-bold text-base shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-white text-xs"
        style={{ background: "linear-gradient(135deg, #6366F1, #A855F7)" }}
      >
        {number}
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

// ---- Step 5: Done ----

function DoneStep({ t }: { t: ReturnType<typeof useLangStore.getState>["t"] }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{t("ob_done_title")}</h2>
      <p className="text-slate-600 dark:text-slate-300 text-sm">{t("ob_done_desc")}</p>

      <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3 space-y-1.5">
        {(["ob_done_tip1", "ob_done_tip2", "ob_done_tip3", "ob_done_tip4"] as const).map((key) => (
          <p key={key} className="text-xs text-slate-600 dark:text-slate-300">
            {t(key)}
          </p>
        ))}
      </div>

      <p className="text-emerald-500 dark:text-emerald-400 text-sm font-medium">{t("ob_done_enjoy")}</p>
    </div>
  );
}
