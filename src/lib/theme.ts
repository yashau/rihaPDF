// Theme management: three user-facing modes (system / light / dark) that
// resolve to a binary "is dark" used to toggle the `.dark` class on
// <html>. The class hooks both Tailwind v4's custom dark variant
// (defined in index.css) and HeroUI's `.dark, [data-theme=dark]` rules,
// so a single class flip drives the entire app's chrome.
//
// "system" tracks `prefers-color-scheme: dark` live; "light" and "dark"
// pin the result and ignore the OS. Persisted across reloads in
// localStorage under STORAGE_KEY.

import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "rihaPDF.theme";

function readStored(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Storage may be blocked (private mode, sandboxed iframe) — fall
    // through to the system default.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolve the user's chosen mode to the actual dark/light to apply.
 *  In "system" mode the boolean follows OS preference; otherwise the
 *  user's pick wins. */
export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === "system") return systemPrefersDark();
  return mode === "dark";
}

/** Toggle the `.dark` class on <html>. Idempotent. */
function applyDarkClass(isDark: boolean): void {
  const root = document.documentElement;
  if (isDark) root.classList.add("dark");
  else root.classList.remove("dark");
}

/** App-level hook. Returns the current mode + resolved boolean and a
 *  setter that persists to localStorage. We track the live OS
 *  preference as its own state so flipping the OS appearance while in
 *  "system" mode propagates without a reload — `isDark` is then
 *  derived from `(mode, systemDark)` without calling setState inside
 *  the same effect that reads it. */
export function useTheme(): {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (next: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(() => readStored());
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const isDark = mode === "system" ? systemDark : mode === "dark";

  useEffect(() => {
    applyDarkClass(isDark);
  }, [isDark]);

  const setMode = (next: ThemeMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best effort — proceed even if persistence is blocked.
    }
    setModeState(next);
  };

  return { mode, isDark, setMode };
}
