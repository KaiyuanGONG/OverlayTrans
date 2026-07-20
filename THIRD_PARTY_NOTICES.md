# OverlayTrans Third-Party Notices

This document is a human-readable overview of third-party software and model files used by OverlayTrans. The complete license texts for software distributed with the Windows application are installed as separate resources beside the application.

## Software distributed in the Windows installer

### llama.cpp

OverlayTrans distributes a statically linked Windows x64 CPU runtime built from `ggml-org/llama.cpp` release `b10068` as the local inference sidecar. The build disables OpenMP. llama.cpp is licensed under the MIT License. Its unmodified upstream license text is distributed as `llama-server-LICENSE.txt`.

Source: <https://github.com/ggml-org/llama.cpp/tree/b10068>

## Rust and frontend runtime dependencies

The complete license texts for Rust crates in the resolved `x86_64-pc-windows-msvc` normal-dependency runtime graph are distributed as `RUST_THIRD_PARTY_LICENSES.txt`.

The complete license and notice texts for npm packages present in the final Vite module graph, including dynamic chunks and imported CSS/assets, are distributed as `FRONTEND_THIRD_PARTY_LICENSES.txt`.

These generated files intentionally exclude tests, build-only tools, type declarations, and platform-specific dependencies that do not enter the Windows release. They are generated from the locked dependency graphs; they are not a hand-written claim of a complete dependency list.

## Qwen GGUF model files downloaded at runtime

Qwen GGUF model files are not included in the installer. A user who enables local translation may choose to have OverlayTrans download one of the following files at runtime from Hugging Face into the application's user-data directory. Both upstream repositories identify the models as Apache-2.0 licensed.

- `Qwen/Qwen3-4B-GGUF`, revision `bc640142c66e1fdd12af0bd68f40445458f3869b`, file `Qwen3-4B-Q4_K_M.gguf`  
  Source: <https://huggingface.co/Qwen/Qwen3-4B-GGUF/tree/bc640142c66e1fdd12af0bd68f40445458f3869b>
- `Qwen/Qwen3-8B-GGUF`, revision `7c41481f57cb95916b40956ab2f0b139b296d974`, file `Qwen3-8B-Q4_K_M.gguf`  
  Source: <https://huggingface.co/Qwen/Qwen3-8B-GGUF/tree/7c41481f57cb95916b40956ab2f0b139b296d974>

The model repositories and their license information remain available from the source links above. Because the GGUF files are downloaded only at runtime and are not bundled, their model files and license text are not part of the installer resources described in the preceding sections.
