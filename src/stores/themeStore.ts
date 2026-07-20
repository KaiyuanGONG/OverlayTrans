/**
 * Theme store — manages system/light/dark theme.
 *
 * Applies the `dark` class to `document.documentElement` based on the
 * configured theme mode. `system` mode follows `prefers-color-scheme`.
 *
 * This is a UI-only preference. Changing the theme does NOT trigger
 * translation generation advancement or cache clearing.
 */
import { create } from "zustand";
import type { ThemeMode } from "@/types/config";

interface ThemeStore {
  theme: ThemeMode;
  resolved: "light" | "dark";
  setTheme: (theme: ThemeMode) => void;
  initFromConfig: (theme: ThemeMode) => void;
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: ThemeMode): "light" | "dark" {
  const resolved = theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
  if (resolved === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  return resolved;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: "system",
  resolved: "dark",

  setTheme: (theme: ThemeMode) => {
    const resolved = applyTheme(theme);
    set({ theme, resolved });
  },

  initFromConfig: (theme: ThemeMode) => {
    const resolved = applyTheme(theme);
    set({ theme, resolved });
  },
}));

// Listen for system theme changes when in "system" mode
if (typeof window !== "undefined") {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    const { theme } = useThemeStore.getState();
    if (theme === "system") {
      const resolved = applyTheme("system");
      useThemeStore.setState({ resolved });
    }
  });
}
