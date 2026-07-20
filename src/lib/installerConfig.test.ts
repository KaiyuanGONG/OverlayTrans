import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import config from "../../src-tauri/tauri.conf.json";

describe("NSIS installer configuration", () => {
  it("keeps the version aligned across manifests", () => {
    expect(config.version).toBe("3.0.4");
    expect(packageJson.version).toBe("3.0.4");
  });

  it("packages a versioned shortcut icon without duplicating the finish prompt", () => {
    expect(config.bundle.resources["icons/icon.ico"]).toBe("OverlayTrans-3.0.4.ico");
  });

  it("relies on the native finish-page desktop shortcut only", () => {
    // Tauri's NSIS template already offers a "Create desktop shortcut"
    // checkbox on the finish page and removes the shortcut on uninstall.
    // A custom hook would prompt the user twice.
    expect(config.bundle.windows.nsis).not.toHaveProperty("installerHooks");
  });
});
