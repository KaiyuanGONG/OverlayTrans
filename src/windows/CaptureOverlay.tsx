/**
 * CaptureOverlay — transparent always-on-top window that defines the capture region.
 *
 * Layout:
 *   ┌─────────────────── drag handle (title bar) ──────────────────┐
 *   │                                                               │
 *   │               center (mouse pass-through to game)            │
 *   │                                                               │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * The Rust side polls cursor position and calls set_ignore_cursor_events
 * dynamically so only the border+title area intercepts mouse events.
 *
 * Geometry constants are fetched from the backend (overlay_metrics.rs) —
 * the single source of truth. The center content area is measured via
 * getBoundingClientRect() and sent to the backend as physical-pixel insets
 * for precise OCR cropping.
 *
 * CaptureOverlay and TranslationPanel are semi-transparent overlays on top
 * of the game. They intentionally keep a dark glass style and do NOT follow
 * the app theme (system/light/dark). This is by design.
 */
import { useEffect, useCallback, useState, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useConfigStore } from "@/stores/configStore";
import { useTranslationStore } from "@/stores/translationStore";
import { useLangStore } from "@/stores/langStore";
import { AppStatus } from "@/types/translation";
import { computePhysicalInsets } from "@/lib/overlayGeometry";
import { Play, Settings, X } from "lucide-react";

/** Overlay metrics from the Rust backend (overlay_metrics.rs). */
interface OverlayMetrics {
  border_px: number;
  title_h: number;
  handle_px: number;
  edge_px: number;
}

export default function CaptureOverlay() {
  const { config, loadConfig } = useConfigStore();
  const { currentStatus, isAutoMode, setAutoMode } = useTranslationStore();
  const { t } = useLangStore();
  const [hasTranslated, setHasTranslated] = useState(false);
  const [metrics, setMetrics] = useState<OverlayMetrics | null>(null);
  const ocrContentRef = useRef<HTMLDivElement>(null);

  // Fetch overlay metrics from backend (single source of truth)
  useEffect(() => {
    invoke<OverlayMetrics>("get_overlay_metrics").then(setMetrics).catch(console.error);
  }, []);

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    setAutoMode(config.trigger.mode === "auto");
  }, [config.trigger.mode, setAutoMode]);

  // Listen for translation status events from Rust (generation-aware)
  useEffect(() => {
    const unlistenStatus = listen<{ status: string; generation: number }>(
      "translation-status",
      (ev) => {
        const { status, generation: gen } = ev.payload;
        useTranslationStore.getState().setStatus(status as AppStatus, gen);
        if (
          status === "done" &&
          useTranslationStore.getState().currentGeneration === gen
        ) {
          setHasTranslated(true);
        }
      },
    );
    const unlistenError = listen<{ error: string; generation: number }>(
      "translation-error",
      (ev) => {
        const { error, generation: gen } = ev.payload;
        useTranslationStore.getState().setStatus("error", gen, error);
      },
    );
    const unlistenAutoMode = listen<boolean>("auto-mode-changed", (ev) => {
      useTranslationStore.getState().setAutoMode(Boolean(ev.payload));
    });

    return () => {
      unlistenStatus.then((f) => f());
      unlistenError.then((f) => f());
      unlistenAutoMode.then((f) => f());
    };
  }, []);

  const handleManualTrigger = useCallback(async () => {
    try {
      await invoke("trigger_translation_manual");
    } catch (e) {
      const msg = String(e);
      const store = useTranslationStore.getState();
      store.setStatus("error", store.currentGeneration, msg);
      console.error(msg);
    }
  }, []);

  useEffect(() => {
    const unlistenHotkey = listen<null>("hotkey-triggered", () => {
      handleManualTrigger();
    });
    return () => {
      unlistenHotkey.then((f) => f());
    };
  }, [handleManualTrigger]);

  const handleToggleAuto = useCallback(async () => {
    try {
      await invoke("set_trigger_mode", { mode: isAutoMode ? "manual" : "auto" });
    } catch (e) {
      console.error(e);
    }
  }, [isAutoMode]);

  const handleDrag = useCallback(async () => {
    await getCurrentWindow().startDragging();
  }, []);

  // Intercept the OS close event (e.g. Alt+F4) — hide instead of destroying.
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

  /**
   * Measure the center content area and persist capture region with
   * physical-pixel insets for precise OCR cropping.
   *
   * left/top use Math.ceil, right/bottom use Math.floor — this guarantees
   * the OCR crop is strictly inside the visible border.
   */
  const persistGeometry = useCallback(async () => {
    try {
      if (!metrics || !ocrContentRef.current) return;

      const win = getCurrentWindow();
      const [pos, size, innerPos] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        win.innerPosition(),
      ]);
      const dpr = window.devicePixelRatio || 1;
      const rect = ocrContentRef.current.getBoundingClientRect();
      const measuredInsets = computePhysicalInsets(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        dpr,
        {
          clientOffsetX: innerPos.x - pos.x,
          clientOffsetY: innerPos.y - pos.y,
          outerWidth: size.width,
          outerHeight: size.height,
        },
      );

      await invoke("set_capture_region", {
        region: {
          x: pos.x,
          y: pos.y,
          width: size.width,
          height: size.height,
          measured_insets: measuredInsets,
        },
      });
    } catch (e) {
      console.error("Failed to persist capture window geometry:", e);
    }
  }, [metrics]);

  // Persist capture window geometry on drag/resize with debounce
  useEffect(() => {
    const win = getCurrentWindow();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedulePersist = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(persistGeometry, 150);
    };

    const unlistenMoved = win.onMoved(() => schedulePersist());
    const unlistenResized = win.onResized(() => schedulePersist());

    // Re-register after every DPI transition so repeated monitor changes are observed.
    let mq: MediaQueryList | null = null;
    const handleDpiChange = () => {
      schedulePersist();
      mq?.removeEventListener("change", handleDpiChange);
      subscribeToCurrentDpi();
    };
    const subscribeToCurrentDpi = () => {
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener("change", handleDpiChange);
    };
    subscribeToCurrentDpi();

    return () => {
      if (timer) clearTimeout(timer);
      unlistenMoved.then((f) => f());
      unlistenResized.then((f) => f());
      mq?.removeEventListener("change", handleDpiChange);
    };
  }, [persistGeometry]);

  // Re-measure when show_border changes
  useEffect(() => {
    const timer = setTimeout(persistGeometry, 50);
    return () => clearTimeout(timer);
  }, [config.capture_region.show_border, persistGeometry]);

  const borderPx = metrics?.border_px ?? 0;
  const titleH = metrics?.title_h ?? 0;

  // Compute border color from hue
  const hue = config.capture_region.border_hue;
  const opacity = config.capture_region.border_opacity / 100;
  const borderColor = `hsla(${hue}, 90%, 55%, ${opacity})`;
  const showBorder = config.capture_region.show_border;

  const statusLabel: Record<string, string> = {
    idle: t("capture_status_idle"),
    capturing: t("capture_status_capturing"),
    ocr: t("capture_status_ocr"),
    translating: t("capture_status_translating"),
    done: t("capture_status_done"),
    error: t("capture_status_error"),
  };

  return (
    <div
      className="relative flex flex-col w-full h-full"
      style={{ background: "transparent" }}
      onContextMenu={async (e) => {
        e.preventDefault();
        try {
          await invoke("show_settings_window");
        } catch (err) {
          console.error(err);
        }
      }}
    >
      {/* Title bar / drag handle */}
      <div
        className="flex items-center justify-between px-2 cursor-move shrink-0"
        style={{
          height: titleH,
          background: showBorder ? borderColor : "rgba(0,0,0,0.5)",
          borderRadius: "4px 4px 0 0",
          paddingLeft: metrics?.handle_px ?? 0,
          paddingRight: metrics?.handle_px ?? 0,
        }}
        onMouseDown={handleDrag}
      >
        <span className="text-white text-xs font-bold select-none">
          OverlayTrans
        </span>

        <div className="flex items-center gap-1">
          {/* Status indicator */}
          <span
            className={`text-xs px-1.5 py-0.5 rounded text-white ${
              currentStatus === "translating" || currentStatus === "ocr"
                ? "status-pulsing bg-amber-500"
                : currentStatus === "error"
                ? "bg-rose-500"
                : currentStatus === "done"
                ? "bg-emerald-500"
                : "bg-black/30"
            }`}
          >
            {statusLabel[currentStatus] ?? currentStatus}
          </span>

          {/* Manual trigger */}
          <button
            className="text-white text-xs px-1.5 py-0.5 bg-black/40 hover:bg-black/60 rounded"
            onClick={handleManualTrigger}
            onMouseDown={(e) => e.stopPropagation()}
            title={t("capture_manual_title")}
          >
            <Play size={12} aria-hidden="true" />
          </button>

          {/* Auto mode toggle */}
          <button
            className={`text-xs px-1.5 py-0.5 rounded ${
              isAutoMode ? "bg-indigo-500 text-white" : "bg-black/40 text-white hover:bg-black/60"
            }`}
            onClick={handleToggleAuto}
            onMouseDown={(e) => e.stopPropagation()}
            title={t("capture_auto_title")}
          >
            {isAutoMode ? t("capture_auto_label") : t("capture_manual_label")}
          </button>

          {/* Settings button */}
          <button
            className="text-white text-xs px-1.5 py-0.5 bg-black/40 hover:bg-black/60 rounded"
            onClick={async () => {
              await invoke("show_settings_window");
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title={t("capture_settings_title")}
          >
            <Settings size={12} aria-hidden="true" />
          </button>

          {/* Hide button (restore from tray) */}
          <button
            className="text-white text-xs px-1.5 py-0.5 bg-black/40 hover:bg-black/70 rounded"
            onClick={async () => {
              await invoke("hide_main_windows");
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title={t("capture_hide_title")}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Bordered shell; the inner child is the exact OCR content rectangle. */}
      <div
        className="flex-1 flex items-center justify-center"
        style={{
          border: showBorder ? `${borderPx}px solid ${borderColor}` : "none",
          borderTop: "none",
          background: "transparent",
          borderRadius: "0 0 4px 4px",
          position: "relative",
        }}
      >
        <div
          ref={ocrContentRef}
          className="w-full h-full flex items-center justify-center"
        >
          {!hasTranslated && (
            <div className="flex flex-col items-center gap-1 pointer-events-none select-none">
              <p className="text-white/25 text-sm text-center">
                {t("capture_hint_line1")}
              </p>
              <p className="text-white/15 text-xs text-center">
                {t("capture_hint_line2")}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Resize zones live at the actual window edges, not inside the OCR area. */}
      {metrics &&
        (["NorthWest", "NorthEast", "SouthWest", "SouthEast"] as const).map((dir) => {
          const isNorth = dir.includes("North");
          const isWest = dir.includes("West");
          // Correct cursor per direction
          const cursor =
            dir === "NorthWest" || dir === "SouthEast" ? "nwse-resize" : "nesw-resize";
          return (
            <div
              key={dir}
              className="absolute"
              style={{
                width: metrics.handle_px,
                height: metrics.handle_px,
                cursor,
                top: isNorth ? 0 : undefined,
                bottom: isNorth ? undefined : 0,
                left: isWest ? 0 : undefined,
                right: isWest ? undefined : 0,
                // Visual indicator: thin L-shaped lines at corners
                borderTop: isNorth ? `3px solid ${borderColor}` : "none",
                borderBottom: isNorth ? "none" : `3px solid ${borderColor}`,
                borderLeft: isWest ? `3px solid ${borderColor}` : "none",
                borderRight: isWest ? "none" : `3px solid ${borderColor}`,
                opacity: 0.8,
                zIndex: 10,
              }}
              onMouseDown={async (e) => {
                e.stopPropagation();
                await getCurrentWindow().startResizeDragging(dir as any);
              }}
            />
          );
        })}

      {metrics &&
        (
          [
            { dir: "East" as const, style: { top: metrics.handle_px, right: 0, bottom: metrics.handle_px, width: metrics.edge_px, cursor: "ew-resize" as const } },
            { dir: "West" as const, style: { top: metrics.handle_px, left: 0, bottom: metrics.handle_px, width: metrics.edge_px, cursor: "ew-resize" as const } },
            { dir: "South" as const, style: { left: metrics.handle_px, right: metrics.handle_px, bottom: 0, height: metrics.edge_px, cursor: "ns-resize" as const } },
          ]
        ).map(({ dir, style }) => (
          <div
            key={dir}
            className="absolute"
            style={{
              ...style,
              zIndex: 10,
            }}
            onMouseDown={async (e) => {
              e.stopPropagation();
              await getCurrentWindow().startResizeDragging(dir as any);
            }}
            />
        ))}
    </div>
  );
}
