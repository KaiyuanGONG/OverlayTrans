import { describe, expect, it } from "vitest";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import notices from "../../THIRD_PARTY_NOTICES.md?raw";

describe("third-party notices bundle contract", () => {
  it("bundles the human notice, generated runtime reports and raw llama.cpp license", () => {
    expect(tauriConfig.bundle.resources).toMatchObject({
      "../THIRD_PARTY_NOTICES.md": "THIRD_PARTY_NOTICES.md",
      "licenses/RUST_THIRD_PARTY_LICENSES.txt": "RUST_THIRD_PARTY_LICENSES.txt",
      "licenses/FRONTEND_THIRD_PARTY_LICENSES.txt": "FRONTEND_THIRD_PARTY_LICENSES.txt",
      "binaries/llama-server-LICENSE.txt": "",
    });
  });

  it("describes both pinned Qwen GGUF downloads as Apache-2.0 runtime downloads, not bundled files", () => {
    expect(notices).toContain("Qwen/Qwen3-4B-GGUF");
    expect(notices).toContain("bc640142c66e1fdd12af0bd68f40445458f3869b");
    expect(notices).toContain("Qwen3-4B-Q4_K_M.gguf");
    expect(notices).toContain("Qwen/Qwen3-8B-GGUF");
    expect(notices).toContain("7c41481f57cb95916b40956ab2f0b139b296d974");
    expect(notices).toContain("Qwen3-8B-Q4_K_M.gguf");
    expect(notices).toMatch(/Apache-2\.0/);
    expect(notices).toMatch(/not included in the installer/i);
    expect(notices).toMatch(/downloaded.*runtime/i);
  });

  it("keeps the bundled and generated notice categories explicit", () => {
    expect(notices).toMatch(/llama\.cpp.*b10068/is);
    expect(notices).toContain("RUST_THIRD_PARTY_LICENSES.txt");
    expect(notices).toContain("FRONTEND_THIRD_PARTY_LICENSES.txt");
  });
});
