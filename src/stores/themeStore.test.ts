import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChangeListener = (event: MediaQueryListEvent) => void;

function installMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<ChangeListener>();
  const media = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: ChangeListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: ChangeListener) => listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn(() => media));

  return {
    setDark(value: boolean) {
      dark = value;
      const event = { matches: value, media: media.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

describe("themeStore", () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies explicit light and dark themes", async () => {
    installMatchMedia(false);
    const { useThemeStore } = await import("@/stores/themeStore");

    useThemeStore.getState().setTheme("dark");
    expect(useThemeStore.getState().resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    useThemeStore.getState().setTheme("light");
    expect(useThemeStore.getState().resolved).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("tracks operating-system changes only in system mode", async () => {
    const system = installMatchMedia(false);
    const { useThemeStore } = await import("@/stores/themeStore");

    useThemeStore.getState().initFromConfig("system");
    system.setDark(true);
    expect(useThemeStore.getState().resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    useThemeStore.getState().setTheme("light");
    system.setDark(true);
    expect(useThemeStore.getState().resolved).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
