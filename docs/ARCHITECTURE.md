# OverlayTrans V3 Architecture

OverlayTrans is an immersive AI screen translator for Visual Novels and videos,
built with Tauri 2, Rust (Tokio), React 18, and TypeScript.

## Runtime

```text
manual trigger / automatic cadence
  → shared pipeline try_lock + generation ID
  → capture cropped screen region (measurement-based insets or fallback formula)
  → WinRT OCR + CJK-aware whitespace normalization (zh, en, ja)
  → streaming translation (Online or Local)
  → generation-tagged chunk / done / error events
  → translation overlay
```

All three translation modes are fully operational:

- **Speed**: WinRT OCR → streaming online text translation.
- **Quality**: Screenshot → VLM multimodal direct translation (multimodal providers only).
- **Local**: WinRT OCR → bundled llama.cpp loopback translation. Once the user-requested model download is complete, translation requests have no remote network path and never fall back online.

## Backend map

- `commands/capture.rs` — manual/automatic pipeline, crop geometry, generation events
- `commands/config.rs` — canonical configuration commands and provider preset DTOs
- `commands/ocr.rs` — WinRT OCR availability/test, language-pack check
- `commands/translate.rs` — API credential smoke test
- `services/ocr_winrt.rs` — the sole OCR adapter (WinRT `Windows.Media.Ocr`)
- `services/translate_online.rs` — URL/request construction, SSE streaming, context, LRU cache
- `services/translate_local.rs` — local llama.cpp translation via loopback
- `services/local_runtime.rs` — llama.cpp process lifecycle (start/stop/health)
- `services/screen_capture.rs` — Windows GDI capture
- `services/cursor_passthrough.rs` — polling-based cursor pass-through for transparent overlay
- `services/overlay_metrics.rs` — shared overlay geometry constants (border, title, handle)
- `models/config.rs` — canonical V3 schema, private legacy migration DTOs

## Frontend map

- `windows/CaptureOverlay.tsx` — capture-region window, trigger controls, resize handles
- `windows/TranslationPanel.tsx` — generation-aware streaming translation output
- `windows/SettingsPanel.tsx` — trigger, appearance, capture, mode, provider, local-state UI
- `windows/Onboarding.tsx` — five-step first-run brand intro, mode selection, provider/local setup, capture guide
- `stores/configStore.ts` — canonical config loading and optimistic persistence with rollback
- `stores/translationStore.ts` — generation-aware event state
- `stores/themeStore.ts` — system/light/dark theme management
- `lib/configContract.ts` — supported language arrays, capability checks
- `i18n/index.ts` — zh/en localization tables

## Configuration

Configuration version is 3. Remote providers and local execution are separate:

- Remote provider IDs: `deepseek`, `qwen`, `gemini`, `groq`, `openai`, `custom`
- Modes: `speed`, `quality`, `local`
- Source languages: `en`, `ja`, `zh` (auto rejected on OCR path)
- Target languages: `zh`, `en`, `ja`
- Local backend IDs: `bundled_llama_cpp`, `custom_loopback`
- Local model IDs: `qwen3_4b`, `qwen3_8b`, `custom`
- Bundled Local inference requires an AVX2-compatible CPU with FMA, F16C, and BMI2; remote Speed and Quality modes are unaffected
- UI theme: `system`, `light`, `dark` (UI-only preference, no pipeline side-effects)

Legacy fields exist only in private Rust migration DTOs. Saving always emits the canonical V3 schema.

## Events

Translation status, chunks, completion, and errors carry a monotonically increasing generation ID. The frontend discards stale events. A semantic config change clears cache, context, the OCR/change-detection baseline, and advances the generation. Theme/UI preference changes do NOT advance the generation or clear caches.

## Validation

Every phase must pass: `cargo fmt`, `cargo build --locked`, `cargo test --locked`, `cargo clippy --locked -D warnings`, `npm run test`, `npm run build`, and `git diff --check`. A release maintainer additionally runs `npm run tauri build` and the installed-package smoke tests.
