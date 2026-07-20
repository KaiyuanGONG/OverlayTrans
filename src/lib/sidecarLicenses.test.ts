import { describe, expect, it } from "vitest";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import prepareSource from "../../scripts/prepare-sidecar.mjs?raw";

// @ts-expect-error The release manifest is an ESM build script module.
import { SIDECAR_MANIFEST } from "../../scripts/lib/sidecar-manifest.mjs";

describe("sidecar release license contract", () => {
  it("pins source-build license provenance", () => {
    expect(SIDECAR_MANIFEST.license).toEqual({
      sourceFile: "LICENSE",
      sha256: "94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d",
      output: "llama-server-LICENSE.txt",
    });
    expect(SIDECAR_MANIFEST).not.toHaveProperty("archive");
  });

  it("bundles only the original llama.cpp license text", () => {
    expect(tauriConfig.bundle.resources["binaries/llama-server-LICENSE.txt"]).toBe("");
    expect(tauriConfig.bundle.resources).not.toHaveProperty("binaries/*.dll");
  });

  it("keeps sidecar constants in the importable manifest", () => {
    expect(prepareSource).toMatch(/import\s+\{\s*SIDECAR_MANIFEST\s*\}/);
    expect(prepareSource).toContain("GGML_OPENMP");
  });
});
