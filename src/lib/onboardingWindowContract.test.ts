import { describe, expect, it } from "vitest";
import onboardingSource from "../windows/Onboarding.tsx?raw";
import backendSource from "../../src-tauri/src/lib.rs?raw";

describe("onboarding replay window lifecycle", () => {
  it("hides the reusable onboarding window instead of destroying it", () => {
    expect(onboardingSource).toContain("getCurrentWindow().hide()");
    expect(onboardingSource).not.toContain("getCurrentWindow().close()");
  });

  it("can recreate a missing window and resets an existing replay", () => {
    expect(backendSource).toContain("fn ensure_onboarding_window");
    expect(backendSource).toContain("onboarding-replay-requested");
  });
});
