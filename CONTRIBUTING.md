# Contributing to OverlayTrans

Bug reports and pull requests are welcome. For bugs, please include your Windows version,
OverlayTrans version, the translation mode, and the provider in use.

## Prerequisites

- **Windows 10 (1809+) or 11** with WebView2 (pre-installed on current Windows).
- **Node.js** 20.19+ (or 22.13+ / 24+) — required by the pinned Vitest and jsdom versions.
- **Rust** stable with the MSVC toolchain — install via [rustup](https://rustup.rs/): `winget install Rustlang.Rustup`.
- **Visual Studio 2022 Build Tools** with *Desktop development with C++* (MSVC and CMake). It is needed
  to build the llama.cpp sidecar; the sidecar build also requires network access and an AVX2 CPU.
- Only for license work: exactly `cargo-about 0.8.4` and `cargo-deny 0.20.2`
  (see [`docs/PACKAGING_WINDOWS.md`](docs/PACKAGING_WINDOWS.md)).

## Setup

```sh
npm ci
node scripts/prepare-sidecar.mjs   # build the pinned llama.cpp sidecar once
npm run tauri dev                  # Rust + frontend with hot reload
```

`src-tauri/binaries/` is git-ignored, and `tauri-build` refuses to compile without the sidecar
and its license, so run `prepare-sidecar.mjs` before any `cargo` or `tauri` command on a fresh clone.

## Project structure

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) maps the Rust modules, React windows and stores,
the event contract, and the configuration schema.

## Checks before opening a pull request

Run from the repository root (do not run Vitest and `vite build` in parallel):

```sh
npm run test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
git diff --check
```

`npm run test` covers the React code and the Node build scripts under `scripts/`.
Some tests pin documentation contracts (license text, AVX2 requirement, installer version),
so update the matching test when you intentionally change that wording or value.

## Code conventions

- **Rust**: `cargo fmt`; Clippy must be clean with `-D warnings`.
- **TypeScript**: `strict` compiler settings (unused locals/parameters are errors). There is no
  formatter config — follow the surrounding style.
- **UI text** goes through `src/i18n/index.ts`; the Chinese and English tables must keep identical keys.
- **Local mode** must stay loopback-only and must never fall back to a remote provider.
- **UI-only preferences** (such as the theme) must not advance the translation generation or clear caches.

## Dependencies and license reports

The generated reports in `src-tauri/licenses/` ship with the installer and must match the locked
dependency graphs. After changing `package-lock.json` or `src-tauri/Cargo.lock`, run
`npm run licenses:generate` and commit the refreshed reports; `npm run licenses:check` verifies
them without touching the working tree. Note that `npm run build` also rewrites
`FRONTEND_THIRD_PARTY_LICENSES.txt` — the output only changes when frontend runtime dependencies change.

## Developer API key file

`.overlaytrans.local.json` (git-ignored; copy `.overlaytrans.local.example.json`) supplies an API
key for local development. It is only used when no key is saved in Settings, applies to the
provider named in the file (DeepSeek when `provider` is omitted), and must match the configured
endpoint when one is set. Candidate locations are `OVERLAYTRANS_LOCAL_API_FILE`, the working directory, the
repository root when running from `src-tauri`, and the executable's folder or its parent. Keep a
single copy: when several exist, the first path in sorted order wins. Never commit it.

## Submitting changes

1. Fork the repo and create a feature branch.
2. Run the checks above; all must pass.
3. Open a pull request describing what changed and why. Include screenshots for UI changes.
