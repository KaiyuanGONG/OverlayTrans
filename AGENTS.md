# AGENTS.md

Working notes for AI coding agents in this repository. Human contributors: see `CONTRIBUTING.md`.

## Project

OverlayTrans is a Windows-only Tauri 2 desktop app: it OCRs a screen region with WinRT (or sends a
screenshot to a vision model) and streams the translation into a transparent overlay.
Modes: Speed (OCR → text model), Quality (screenshot → VLM), Local (OCR → bundled llama.cpp).

## Run and verify

- Setup: `npm ci`, then `node scripts/prepare-sidecar.mjs` once. It builds the git-ignored
  `src-tauri/binaries/`; every `cargo`/`tauri` command fails without it.
- Dev: `npm run tauri dev` · installers: `npm run tauri build` (Windows + MSVC only).
- Before finishing a change, from the repo root: `npm run test`, `npm run build`, then in
  `src-tauri/`: `cargo fmt --all -- --check`, `cargo clippy --all-targets --locked -- -D warnings`,
  `cargo test --locked`. Never run Vitest and `vite build` in parallel.

## Stack

Rust + Tokio (`src-tauri/src/`), React 18 + TypeScript + Vite + Tailwind + Zustand (`src/`),
Vitest for frontend and build-script tests (`scripts/**/*.test.mjs`), llama.cpp sidecar for Local mode.

## Where things are

- Module map, events, config schema: `docs/ARCHITECTURE.md`.
- Toolchain, release gates, license reports, installer and Local smoke tests: `docs/PACKAGING_WINDOWS.md`.
- `scripts/`: sidecar build, icon pipeline, license tooling, secret scan.

## Invariants

- Local mode stays loopback-only and never falls back to a remote provider.
- Pipeline writes are guarded by the generation ID; UI-only preferences (theme) must not advance it.
- Keep the Rust config (`models/config.rs`) and its TS mirror (`src/types/config.ts`) in sync;
  legacy fields live only in the private migration DTOs.
- UI text goes through `src/i18n/index.ts` with identical zh/en keys.
- Some tests pin docs and manifests (LICENSE text, AVX2 wording, version `3.0.4`, bundled
  resources, capabilities); change them together with intentional edits.
- After dependency changes run `npm run licenses:generate` (exact cargo-about 0.8.4 and
  cargo-deny 0.20.2) and commit the refreshed reports.
- Regenerate icons only through `scripts/generate-icons.mjs` and `validate-brand-assets.mjs`.
- Never commit API keys, `config.json`, `.overlaytrans.local.json`, `src-tauri/binaries/` or `_docs/`.

## Status (2026-09-24)

v3.0.4 is released. Provider presets are time-sensitive (last checked 2026-07-18) and must be
re-verified before the next release; the Local-mode smoke in `docs/PACKAGING_WINDOWS.md` runs once
per release.
