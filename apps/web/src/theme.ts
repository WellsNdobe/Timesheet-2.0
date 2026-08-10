import { useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "tempoledger.theme-preference";
const THEME_CHANGE_EVENT = "tempoledger-theme-change";

const isThemePreference = (value: string | null): value is ThemePreference => value === "light" || value === "dark" || value === "system";

export const readThemePreference = (): ThemePreference => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
};

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

const updateThemeColor = (preference: ThemePreference) => {
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!themeColor) return;
  const isDark = preference === "dark" || (preference === "system" && prefersDark());
  themeColor.content = isDark ? "#111315" : "#ffffff";
};

export const applyThemePreference = (preference: ThemePreference) => {
  if (preference === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = preference;
  updateThemeColor(preference);
};

export const useThemePreference = () => {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    applyThemePreference(preference);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (preference === "system") updateThemeColor(preference);
    };
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const nextPreference = isThemePreference(event.newValue) ? event.newValue : "system";
      setPreference(nextPreference);
      applyThemePreference(nextPreference);
    };
    const handleThemeChange = (event: Event) => {
      const nextPreference = (event as CustomEvent<ThemePreference>).detail;
      if (!isThemePreference(nextPreference)) return;
      setPreference(nextPreference);
    };

    mediaQuery.addEventListener("change", handleSystemChange);
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    return () => {
      mediaQuery.removeEventListener("change", handleSystemChange);
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    };
  }, [preference]);

  const changePreference = (nextPreference: ThemePreference) => {
    setPreference(nextPreference);
    applyThemePreference(nextPreference);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
    } catch {
      // The theme still applies for the current session when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent<ThemePreference>(THEME_CHANGE_EVENT, { detail: nextPreference }));
  };

  return { preference, changePreference };
};
