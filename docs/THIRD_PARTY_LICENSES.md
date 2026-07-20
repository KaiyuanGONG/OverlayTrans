# Third-Party License Generation

OverlayTrans keeps human-readable notices and complete machine-generated license texts as installer resources. The generated files are checked into the repository so release review can inspect the exact bytes before packaging.

## Installer resources

The Windows installer includes:

- `THIRD_PARTY_NOTICES.md`, the component overview and runtime model-download disclosure;
- `RUST_THIRD_PARTY_LICENSES.txt`, the complete license bodies for the locked Windows Rust runtime graph;
- `FRONTEND_THIRD_PARTY_LICENSES.txt`, the complete license and notice bodies for packages found in the final Vite module graph;
- `llama-server-LICENSE.txt`, the verified original llama.cpp license.

Qwen GGUF files are not installer resources. The notices identify their repositories, fixed revisions, Apache-2.0 license, and runtime-only download behavior.

## llama.cpp sidecar

The Windows x64 CPU sidecar is built from the llama.cpp `b10068` source revision `571d0d540df04f25298d0e159e520d9fc62ed121`. The source archive URL and SHA-256 are stored in `scripts/lib/sidecar-manifest.mjs`.

The locked MSVC Release build uses a static runtime and static libraries. OpenMP, dynamic backends, native-host tuning, CPU variant dispatch, tests, examples, the app target, the embedded UI, and OpenSSL are disabled. The server and common tool code remain enabled. AVX2, AVX, FMA, F16C, and BMI2 are enabled; AVX-512 is disabled. Build number `10068` and the full source revision are passed explicitly.

Preparation requires an AVX2-capable host. Before activation, the script verifies the source and license hashes, builds only `llama-server`, runs `--version`, and checks the PE dependency list against a fixed allowlist. Any dependency containing `libomp` is rejected. Activation replaces the complete `src-tauri/binaries` directory and restores the previous usable directory if replacement fails.

Before starting the bundled Local runtime, the application verifies AVX2, FMA, F16C, and BMI2 support. Unsupported processors are rejected without starting the sidecar or changing its process state. Remote Speed and Quality modes are unaffected.

The local Qwen3 4B smoke comparison uses the same model, four worker threads, a 2048-token context, one warm-up request, and three measured requests for each binary. The candidate median must be at least 70% of the prior release median.

## Rust runtime graph

The graph source is:

```text
cargo metadata --locked --filter-platform x86_64-pc-windows-msvc
```

Traversal begins at the OverlayTrans workspace package and follows only normal dependency edges in `resolve.nodes`. Package identity is the complete Cargo Package ID, including name, version, and source. Development, build-only, test-only, pure proc-macro, and other-platform packages are excluded.

The generator requires exactly `cargo-about 0.8.4` and `cargo-deny 0.20.2`. `about.toml` disables development/build dependencies and external ClearlyDefined lookups for the Windows target. cargo-deny applies the accepted-license policy to the complete runtime graph.

### cargo-about 0.8.4 compatibility evidence

Against the current locked runtime graph, cargo-about covers 270 of 287 Package IDs and omits 17 registry packages: `chrono@0.4.43`, `futures-io@0.3.32`, `hashbrown@0.12.3`, `indexmap@1.9.3`, `lru-slab@0.1.2`, `quinn-proto@0.11.13`, `quinn-udp@0.5.14`, `quinn@0.11.9`, `rand@0.9.2`, `rand_chacha@0.9.0`, `rand_core@0.9.5`, `ref-cast@1.0.25`, `rustc-hash@2.1.1`, `schemars@0.9.0`, `schemars@1.2.1`, `tinyvec@1.10.0`, and `tinyvec_macros@0.1.1`.

The registry fallback exists only for this verified limitation. It resolves each exact package through Cargo metadata `manifest_path`, checks the Cargo.lock checksum against Cargo-vendored `.cargo-checksum.json`, and verifies every included `LICENSE*`, `COPYING*`, and `NOTICE*` file hash. Git or path dependencies fail without an explicit checksum-bound clarification. The cargo-about and fallback sets must be disjoint and their union must exactly equal the Windows runtime graph. A future cargo-about upgrade should re-run this set comparison and remove the fallback when it is no longer needed.

## Frontend runtime graph

The Vite collector traverses every final chunk, including dynamic imports, plus Vite `importedCss` and `importedAssets`. It normalizes virtual and query-bearing module IDs, resolves scoped and nested packages from the nearest `package.json`, and checks name, version, and integrity against the exact `package-lock.json` entry.

Every included package contributes root-level `LICENSE*`, `COPYING*`, and `NOTICE*` files. Missing legal text or lockfile mismatches fail generation. Tests assert that React, Zustand, Lucide, and Tauri runtime packages are present while Vite, Vitest, TypeScript, `@types/*`, and Sharp are absent.

## Determinism and release checks

Reports are sorted by component name, version, SPDX expression, and legal-text SHA-256. Output contains no timestamp, source path, absolute path, username, temporary directory, or chunk hash. Consecutive generation must be byte-identical.

`npm run licenses:generate` updates the repository copies. `npm run licenses:check` regenerates into a fresh temporary directory and compares each report byte for byte without overwriting the working tree. `npm run licenses:gate` performs the same comparison, then runs `git status --porcelain=v1 --untracked-files=all`; any staged, unstaged, or untracked path fails the release gate.
