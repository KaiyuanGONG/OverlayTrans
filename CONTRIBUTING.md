# Contributing to OverlayTrans

## Prerequisites

- **Rust** (stable) — install via [rustup](https://rustup.rs/): `winget install Rustlang.Rustup`
- **Node.js** 18+ — install via [nodejs.org](https://nodejs.org/)
- **Windows 10/11** with WebView2 (pre-installed on Win10 1809+ and all Win11)

## Setup

```sh
# Install frontend dependencies
npm install

# Start development build (Rust + frontend hot-reload)
npm run tauri dev
```

## Project Structure

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a full map of every file and module.

## Code Style

- **Rust**: `cargo fmt` before committing; no `clippy` warnings
- **TypeScript**: Prettier defaults (configured in `package.json`)
- No test frameworks are currently required for frontend; Rust unit tests live alongside source in `#[cfg(test)]` modules

## Testing

```sh
# Rust unit tests
cd src-tauri && cargo test

# Rust type/lint check
cd src-tauri && cargo check
```

## Private Developer Files

- `_docs/` — gitignored; contains PRD, architecture notes, decisions, release guide. Copy from another collaborator or request access.
- `.overlaytrans.local.json` — gitignored; override API key/endpoint for local dev (copy from `.overlaytrans.local.example.json`).

## Submitting Changes

1. Fork the repo and create a feature branch.
2. Run `cargo check` and `cargo test` — both must pass cleanly.
3. Open a pull request with a clear description of what changed and why.
