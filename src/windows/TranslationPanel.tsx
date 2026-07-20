/**
 * TranslationPanel — semi-transparent always-on-top floating window
 * that displays the current and recent translation results.
 */
import { useEffect, useCallback, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useConfigStore } from "@/stores/configStore";
import { useTranslationStore } from "@/stores/translationStore";
import { useLangStore } from "@/stores/langStore";
import { AppStatus, TranslationResult } from "@/types/translation";
import { WarningBanner } from "@/components/WarningBanner";
import { qualityFallbackWarningKey, userFacingErrorKey } from "@/lib/userFacingError";
import { Settings, X } from "lucide-react";

export default function TranslationPanel() {
  const { config, loadConfig } = useConfigStore();
  const { history, currentStatus, lastError, addTranslation, setStatus, streamingText, isStreaming, startStreaming, appendChunk, warning, setWarning, clearWarning } =
    useTranslationStore();
  const { t } = useLangStore();

  const [showHistory, setShowHistory] = useState(false);
  const [showSource, setShowSource] = useState(false);
  // Sticky error persists until dismissed or next successful translation
  const [stickyError, setStickyError] = useState<string | null>(null);
  const warningKey = warning ? qualityFallbackWarningKey(warning) : null;

  useEffect(() => {
    void loadConfig();
  }, []);

  // Track sticky error
  useEffect(() => {
    if (lastError) setStickyError(lastError);
  }, [lastError]);
  useEffect(() => {
    if (currentStatus === "done") setStickyError(null);
  }, [currentStatus]);

  // Intercept the OS close event — hide instead of destroying.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenClose = win.onCloseRequested(async (event) => {
      event.preventDefault();
      try {
        await invoke("hide_main_windows");
      } catch (e) {
        console.error("Failed to hide windows:", e);
      }
    });
    return () => {
      unlistenClose.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const win = getCurrentWindow();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedulePersist = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const pos = await win.outerPosition();
          const size = await win.outerSize();
          await invoke("set_display_region", {
            region: {
              x: pos.x,
              y: pos.y,
              width: size.width,
              height: size.height,
            },
          });
        } catch (e) {
          console.error("Failed to persist translation window geometry:", e);
        }
      }, 150);
    };

    const unlistenMoved = win.onMoved(() => { schedulePersist(); });
    const unlistenResized = win.onResized(() => { schedulePersist(); });

    return () => {
      if (timer) clearTimeout(timer);
      unlistenMoved.then((f) => f());
      unlistenResized.then((f) => f());
    };
  }, []);

  // Listen for translation results from Rust backend (generation-aware)
  useEffect(() => {
    const unlistenResult = listen<TranslationResult & { generation: number }>(
      "translation-result",
      (ev) => {
        addTranslation(
          {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            source_text: ev.payload.source,
            translated_text: ev.payload.target,
            ocr_engine: ev.payload.ocr_engine,
            translation_engine: ev.payload.translation_engine,
            provider_label: ev.payload.provider_label,
            latency_ms: ev.payload.latency_ms,
          },
          ev.payload.generation ?? 0,
        );
      },
    );

    // Status events now carry { status, generation }
    const unlistenStatus = listen<{ status: string; generation: number }>(
      "translation-status",
      (ev) => {
        const { status, generation: gen } = ev.payload;
        setStatus(status as AppStatus, gen);
        if (status === "translating") {
          startStreaming(gen);
        }
      },
    );

    // Error events now carry { error, generation }
    const unlistenError = listen<{ error: string; generation: number }>(
      "translation-error",
      (ev) => {
        const { error, generation: gen } = ev.payload;
        setStatus("error", gen, error);
      },
    );

    // Chunk events now carry { text, generation }
    const unlistenChunk = listen<{ text: string; generation: number }>(
      "translation-chunk",
      (ev) => {
        const { text, generation: gen } = ev.payload;
        appendChunk(text, gen);
      },
    );

    // Warning events carry { message, generation }
    const unlistenWarning = listen<{ message: string; generation: number }>(
      "translation-warning",
      (ev) => {
        const { message, generation: gen } = ev.payload;
        setWarning(message, gen);
      },
    );

    return () => {
      unlistenResult.then((f) => f());
      unlistenStatus.then((f) => f());
      unlistenError.then((f) => f());
      unlistenChunk.then((f) => f());
      unlistenWarning.then((f) => f());
    };
  }, [addTranslation, setStatus, startStreaming, appendChunk, setWarning]);

  const handleDrag = useCallback(async () => {
    await getCurrentWindow().startDragging();
  }, []);

  const latest = history[0];

  // Compute background from config
  const bgHue = config.display.bg_hue;
  const bgOpacity = config.display.bg_opacity / 100;
  const bgColor = `hsla(${bgHue}, 28%, 18%, ${bgOpacity})`;
  const topBarColor = `hsla(${bgHue}, 30%, 14%, ${Math.min(0.94, bgOpacity + 0.16)})`;
  const fontColor = config.display.font_color;
  const fontSize = config.display.font_size;
  const fontFamily = config.display.font_family;

  return (
    <div
      className="flex flex-col w-full h-full rounded-lg overflow-hidden"
      style={{ background: bgColor }}
      onContextMenu={async (e) => {
        e.preventDefault();
        try {
          await invoke("show_settings_window");
        } catch (err) {
          console.error(err);
        }
      }}
    >
      {/* Drag handle / top bar */}
      <div
        className="flex items-center justify-between px-2 py-0.5 shrink-0 cursor-move"
        style={{ background: topBarColor }}
        onMouseDown={handleDrag}
      >
        <span className="text-white/40 text-xs select-none">OverlayTrans</span>
        <div className="flex gap-1 items-center">
          <StatusDot status={currentStatus} />
          {/* Source text toggle — feat 1 */}
          <button
            className={`text-xs px-1 rounded transition-colors ${
              showSource ? "text-white/70 bg-white/10" : "text-white/30 hover:text-white/60"
            }`}
            onClick={(e) => { e.stopPropagation(); setShowSource((v) => !v); }}
            onMouseDown={(e) => e.stopPropagation()}
            title={t("panel_show_source")}
          >
            {t("panel_show_source")}
          </button>
          <button
            className="text-white/40 hover:text-white/80 text-xs"
            onClick={async (e) => {
              e.stopPropagation();
              await invoke("show_settings_window");
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title={t("panel_settings")}
          >
            <Settings size={12} aria-hidden="true" />
          </button>
          <button
            className="text-white/40 hover:text-white/80 text-xs"
            onClick={async (e) => {
              e.stopPropagation();
              await invoke("hide_main_windows");
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title={t("panel_hide")}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex flex-col px-3 py-2 min-h-0">
        {/* Loading state */}
        {(currentStatus === "ocr" || currentStatus === "translating" || currentStatus === "capturing") && (
          <div className="flex items-center gap-2 mb-1 shrink-0">
            <span className="status-pulsing text-amber-400 text-xs">
              {currentStatus === "capturing"
                ? t("panel_capturing")
                : currentStatus === "ocr"
                ? t("panel_ocr")
                : t("panel_translating")}
            </span>
          </div>
        )}

        {/* Current translation — show streaming text if active, otherwise show latest result */}
        {(isStreaming && streamingText) ? (
          <p
            className="selectable leading-snug shrink-0"
            style={{
              color: fontColor,
              fontSize: `${fontSize}px`,
              fontFamily,
              lineHeight: "1.4",
            }}
          >
            {streamingText}
            <span className="inline-block w-0.5 h-4 ml-0.5 bg-current animate-pulse align-text-bottom" />
          </p>
        ) : latest ? (
          <p
            className="selectable leading-snug shrink-0"
            style={{
              color: fontColor,
              fontSize: `${fontSize}px`,
              fontFamily,
              lineHeight: "1.4",
            }}
          >
            {latest.translated_text}
          </p>
        ) : null}

        {/* Source text (feat 1) */}
        {showSource && latest?.source_text && (
          <p
            className="selectable mt-1 shrink-0"
            style={{
              color: "rgba(255,255,255,0.35)",
              fontSize: `${Math.max(11, fontSize - 4)}px`,
              fontFamily,
              lineHeight: "1.35",
            }}
          >
            {latest.source_text}
          </p>
        )}

        {!latest && currentStatus === "idle" && (
          <p className="text-white/20 text-sm select-none shrink-0">
            {t("panel_idle")}
          </p>
        )}

        {/* History list (feat 5 — now triggered by button below) */}
        {showHistory && history.length > 1 && (
          <div className="mt-2 flex-1 overflow-y-auto thin-scroll border-t border-white/10 pt-2 space-y-1">
            {history.slice(1).map((entry) => (
              <p
                key={entry.id}
                className="selectable text-white/50"
                style={{ fontSize: `${Math.max(12, fontSize - 4)}px`, fontFamily }}
              >
                {entry.translated_text}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Bottom bar: engine badge + history toggle (feat 5) */}
      <div className="px-2 pb-1 flex items-center justify-between shrink-0">
        {latest ? (
          <span className="text-white/25 text-xs">
            {latest.translation_engine === "quality"
              ? `VLM · ${(latest.provider_label && latest.provider_label.trim()) || "Qwen"}`
              : latest.translation_engine === "local"
              ? `${(latest.provider_label && latest.provider_label.trim()) || "Local"}`
              : `WinRT · ${(latest.provider_label && latest.provider_label.trim()) || "DeepSeek"}`}{" "}
            · {latest.latency_ms}ms
          </span>
        ) : (
          <span />
        )}
        {history.length > 1 && (
          <button
            className="text-white/25 hover:text-white/50 text-xs transition-colors select-none"
            onClick={() => setShowHistory((v) => !v)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {showHistory ? t("panel_history_hide") : t("panel_history_show")}
          </button>
        )}
      </div>

      {/* Persistent dismissible error bar (feat 8) */}
      {stickyError && (
        <div className="flex items-start gap-1 px-2 pb-1.5 shrink-0">
          <p className="text-rose-400 text-xs flex-1 leading-snug">{t(userFacingErrorKey(stickyError, "translation"))}</p>
          <button
            className="text-rose-400/60 hover:text-rose-300 text-xs shrink-0 leading-none mt-0.5"
            onClick={() => setStickyError(null)}
            onMouseDown={(e) => e.stopPropagation()}
            title={t("panel_error_dismiss")}
          >
            {t("panel_error_dismiss")}
          </button>
        </div>
      )}

      {/* Sticky warning bar — not cleared by done/idle */}
      {warning && (
        <WarningBanner
          message={warningKey ? t(warningKey) : warning}
          dismissLabel={t("panel_error_dismiss")}
          onDismiss={clearWarning}
        />
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    idle: "bg-white/20",
    capturing: "bg-amber-400 status-pulsing",
    ocr: "bg-amber-400 status-pulsing",
    translating: "bg-brand-indigo status-pulsing",
    done: "bg-emerald-400",
    error: "bg-rose-400",
  };
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 self-center rounded-full ${colorMap[status] ?? "bg-white/20"}`}
    />
  );
}
