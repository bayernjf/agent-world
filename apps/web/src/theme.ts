/**
 * Theme management: dark (default) / light.
 *
 * The CSS variable layer lives in styles.css (:root = dark,
 * [data-theme="light"] = light overrides). This module only owns:
 *  1. reading the persisted/system preference,
 *  2. applying `data-theme` on <html>,
 *  3. persisting the choice to localStorage.
 *
 * initTheme() runs once at module import (main.tsx) to avoid a flash
 * of the wrong theme before React mounts.
 */

export type Theme = "dark" | "light";

const STORAGE_KEY = "agent-world-theme";

function systemPrefersLight(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  );
}

export function getTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return systemPrefersLight() ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage may be unavailable (private mode); non-fatal
  }
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

/** Apply the saved/system theme once, before React renders. */
export function initTheme(): void {
  if (typeof document === "undefined") return;
  setTheme(getTheme());
}

// Auto-initialize on import so main.tsx only needs a side-effect import.
initTheme();
