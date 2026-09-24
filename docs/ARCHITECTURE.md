# OverlayTrans Architecture

OverlayTrans is a Windows-only Tauri 2 desktop app. React 18 + TypeScript renders four windows
(capture box, translation panel, settings, onboarding); Rust + Tokio owns capture, WinRT OCR,
online streaming translation, the local llama.cpp runtime, configuration, hotkey and tray.

## Runtime flow

```text
F8 hotkey / capture-box button / Auto cadence
  → shared pipeline try_lock + new generation ID
  → capture the cropped screen region (GDI BitBlt; measured insets, formula fallback)
  → change detection (image hash; unchanged frames are skipped in Auto mode)
  → Speed / Local: WinRT OCR + CJK-aware whitespace normalization (zh, en, ja)
    Quality:       PNG screenshot sent to a vision model
  → streaming translation (online SSE or loopback llama.cpp)
  → generation-tagged status / chunk / result / warning / error events
  → translation panel
```

## Translation modes

- **Speed** — WinRT OCR → streaming online text model.
- **Quality** — screenshot → vision (VLM) model, using either the text provider or a separate
  image profile (`api.vision`). A runtime failure (timeout, provider error) retries the frame once
  through Speed and emits `translation-warning`; configuration errors never fall back.
- **Local** — WinRT OCR → llama.cpp over loopback. Backends: the bundled sidecar
  (`bundled_llama_cpp`) or a user-run server (`custom_loopback`, restricted to `127.x`,
  `localhost`, `::1`). Local mode never reads the remote API configuration and never falls back online.

## Generations, cache and state

- `AppState` (`services/mod.rs`) holds the config, context history, last image hash, last OCR
  text, the pipeline mutex and a monotonic generation counter.
- Every capture run takes a new generation. A semantic config change (mode, languages, provider,
  endpoint, text model, image profile, Local settings, context size) also advances it and clears the
  LRU cache, context, OCR baseline and image hash. UI-only preferences such as the theme do not.
- The frontend ignores events whose generation is older than the latest one it has seen.
- Online results are cached in a 200-entry LRU keyed by normalized source, target language,
  provider, endpoint, model, mode, prompt version, context digest and (Quality) image hash.
  Local results are not cached.

## Capture overlay and click-through

The capture window is transparent and undecorated. `cursor_passthrough.rs` polls the cursor and
toggles `set_ignore_cursor_events`, so the content area stays click-through while the title bar,
border and resize handles remain interactive (frozen while a mouse button is held).
`overlay_metrics.rs` is the single source of the border/title/handle geometry; OCR crops use
measured physical-pixel insets reported by the frontend and fall back to a formula.

## Backend map (`src-tauri/src/`)

| Path | Responsibility |
|---|---|
| `main.rs` | Entry point; hides the console in release builds |
| `lib.rs` | Tauri builder, plugins, command registration, tray, window lifecycle, startup, runtime shutdown on exit |
| `commands/capture.rs` | Manual and Auto pipelines, crop geometry, Quality→Speed fallback, generation-tagged events |
| `commands/config.rs` | Config read/write/reset, provider presets, key clearing, trigger mode, semantic-change reset |
| `commands/local.rs` | Local status, GGUF download/cancel/delete, runtime start/stop/test |
| `commands/ocr.rs` | WinRT OCR self-test and language-pack check |
| `commands/translate.rs` | Text and image API credential tests |
| `models/config.rs` | Canonical config v3, provider presets, private legacy migration DTOs |
| `models/translation.rs` | Event payloads and context entries |
| `models/ocr_result.rs` | OCR result type |
| `services/mod.rs` | `AppState`, generation counter, config persistence |
| `services/screen_capture.rs` | Windows GDI capture |
| `services/change_detector.rs` | Image-hash change detection |
| `services/ocr_winrt.rs` | The only OCR adapter (`Windows.Media.Ocr`) |
| `services/translate_online.rs` | URL building, request bodies, SSE streaming, context, LRU cache, developer key file |
| `services/translate_local.rs` | Loopback-only translation against llama.cpp |
| `services/local_model.rs` | Pinned GGUF manifest, download, verification stamp, deletion |
| `services/local_process.rs` | llama-server process state machine and health polling |
| `services/local_runtime.rs` | Local runtime orchestration, CPU feature check, packaged-runtime checks |
| `services/hotkey.rs` | Global translation hotkey |
| `services/cursor_passthrough.rs` | Region-based mouse click-through for the capture window |
| `services/overlay_metrics.rs` | Capture-box geometry constants and `get_overlay_metrics` |
| `services/windows_shell.rs` | Repoints this app's desktop/Start-menu shortcuts to the versioned icon |
| `utils/download.rs` | Streaming download with progress, cancel, SHA-256 and atomic replace |
| `utils/text.rs` | CJK whitespace normalization |
| `utils/image_processing.rs` | Capture rectangle types |

## Frontend map (`src/`)

| Path | Responsibility |
|---|---|
| `main.tsx`, `App.tsx` | One bundle; picks the view from the window label and applies `config-updated` |
| `windows/CaptureOverlay.tsx` | Capture box, trigger controls, resize handles, inset measurement |
| `windows/TranslationPanel.tsx` | Generation-aware streaming output, history, warnings and errors |
| `windows/SettingsPanel.tsx` | Tabs: Trigger, Display, Capture, Translation (incl. Local model/runtime), API, About |
| `windows/Onboarding.tsx` | Five steps: welcome, modes, setup, usage, done |
| `components/WarningBanner.tsx` | Inline warning banner |
| `stores/configStore.ts` | Ordered optimistic config writes with backend reconciliation |
| `stores/translationStore.ts` | Generation-aware translation event state |
| `stores/themeStore.ts` | System / light / dark theme |
| `stores/langStore.ts` | UI language (zh/en), synchronized across windows |
| `lib/configContract.ts` | Supported languages, provider and vision capability helpers |
| `lib/onboardingConfig.ts` | Applies onboarding choices to the config |
| `lib/overlayGeometry.ts` | Physical-pixel inset computation |
| `lib/userFacingError.ts` | Maps backend errors and warnings to i18n keys |
| `i18n/index.ts` | zh/en tables with identical key sets |
| `types/` | TypeScript mirrors of the config and event payloads |

## Events

| Event | Payload / purpose |
|---|---|
| `translation-status` | `{status, generation}` — capturing, ocr, translating, done, idle, error |
| `translation-chunk` | Streaming text increment for a generation |
| `translation-result` | Final text for a generation |
| `translation-warning` | Non-fatal warning (e.g. Quality→Speed fallback) |
| `translation-error` | Failure for a generation |
| `auto-mode-changed` | Auto trigger on/off |
| `config-updated` | `{revision, config}` after every accepted write |
| `hotkey-triggered` | Global hotkey pressed |
| `onboarding-replay-requested` | Reopen onboarding from Settings |
| `local-model-progress` | GGUF download/verification progress |
| `local-runtime-status` | Local runtime state changes |

## Configuration

Stored as JSON at `%APPDATA%\OverlayTrans\config.json`; config version 3. Old files are migrated
through private legacy DTOs and saved back in the canonical schema.

- Modes: `speed`, `quality`, `local`; trigger: `manual`, `auto`
- Remote provider IDs: `deepseek`, `qwen` (region `domestic` / `international`), `gemini`, `groq`, `openai`, `custom`
- Image profile (`api.vision`): `follow_text` or `separate` (own provider, model and key)
- Source languages: `en`, `ja`, `zh` (`auto` is rejected on the OCR path); target languages: `zh`, `en`, `ja`
- Local backend IDs: `bundled_llama_cpp`, `custom_loopback`
- Local model IDs: `qwen3_4b`, `qwen3_8b` (`custom` is reserved in the schema but not selectable)
- UI theme: `system`, `light`, `dark` (UI-only preference, no pipeline side effects)

API keys live only in this file (plus the optional git-ignored developer key file described in
`CONTRIBUTING.md`). Default configs ship with empty keys, and the bundle never includes
`config.json`, `.overlaytrans.local.json` or `.env` files.

## Local runtime

- `scripts/prepare-sidecar.mjs` builds a static Windows x64 CPU `llama-server` from the pinned
  llama.cpp `b10068` source; see `docs/THIRD_PARTY_LICENSES.md` for build flags and verification.
- Bundled Local inference requires an AVX2-compatible CPU with FMA, F16C, and BMI2; the check runs
  before the runtime starts. Remote Speed and Quality modes are unaffected.
- The server binds `127.0.0.1` on a free port with `--ctx-size 2048` and half the logical cores
  (1–4 threads); it is healthy once `/health` answers, and it is stopped on mode changes, Local
  setting changes, model deletion and app exit.
- Models: `Qwen/Qwen3-4B-GGUF` and `Qwen/Qwen3-8B-GGUF` (Q4_K_M), pinned by revision, size and
  SHA-256, downloaded only on request into the app data directory.

## Validation

The complete gate (Rust fmt/Clippy/tests, Vitest, build, license reports, installer smoke) is in
[`PACKAGING_WINDOWS.md`](PACKAGING_WINDOWS.md).
