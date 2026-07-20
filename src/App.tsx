import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import CaptureOverlay from "./windows/CaptureOverlay";
import TranslationPanel from "./windows/TranslationPanel";
import SettingsPanel from "./windows/SettingsPanel";
import Onboarding from "./windows/Onboarding";
import { type ConfigUpdatedEvent, useConfigStore } from "@/stores/configStore";

type WindowLabel = "capture" | "translation" | "settings" | "onboarding";

// getCurrentWindow() is synchronous in Tauri 2.0 — read the label once at module load
const windowLabel = getCurrentWindow().label as WindowLabel;

export default function App() {
  const applyConfig = useConfigStore((s) => s.applyConfig);

  useEffect(() => {
    const unlisten = listen<ConfigUpdatedEvent>("config-updated", (ev) => {
      applyConfig(ev.payload);
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [applyConfig]);

  switch (windowLabel) {
    case "capture":
      return <CaptureOverlay />;
    case "translation":
      return <TranslationPanel />;
    case "settings":
      return <SettingsPanel />;
    case "onboarding":
      return <Onboarding />;
    default:
      return null;
  }
}
