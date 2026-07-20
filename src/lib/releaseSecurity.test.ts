import { describe, expect, it } from "vitest";
import config from "../../src-tauri/tauri.conf.json";
import { DEFAULT_CONFIG } from "@/types/config";

describe("release secret contract", () => {
  it("ships empty TypeScript defaults", () => {
    expect(DEFAULT_CONFIG.api.api_key).toBe("");
    expect(DEFAULT_CONFIG.api.vision.api_key).toBe("");
  });

  it("does not bundle config, developer overrides, or env files", () => {
    const resources = Object.keys(config.bundle.resources);
    expect(resources.some((path) => /(^|[/\\])config\.json$/i.test(path))).toBe(false);
    expect(resources.some((path) => /\.overlaytrans\.local\.json$/i.test(path))).toBe(false);
    expect(resources.some((path) => /(^|[/\\])\.env(?:\.|$)/i.test(path))).toBe(false);
  });
});
