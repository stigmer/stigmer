import { useCallback, useSyncExternalStore } from "react";
import type { ColorMode, ResolvedColorMode } from "@stigmer/react-sdk";

const COLOR_MODE_KEY = "stigmer:colorMode";
const DEFAULT: ColorMode = "system";

function getSnapshot(): ColorMode {
  try {
    const stored = localStorage.getItem(COLOR_MODE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    return DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function subscribe(callback: () => void): () => void {
  function onStorage(e: StorageEvent) {
    if (e.key === COLOR_MODE_KEY) callback();
  }
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function setColorMode(mode: ColorMode): void {
  try {
    localStorage.setItem(COLOR_MODE_KEY, mode);
  } catch {
    /* private browsing */
  }
  window.dispatchEvent(new StorageEvent("storage", { key: COLOR_MODE_KEY }));
}

export function useColorModePreference() {
  const colorMode = useSyncExternalStore(subscribe, getSnapshot);
  const setMode = useCallback((mode: string) => {
    if (mode === "light" || mode === "dark" || mode === "system") {
      setColorMode(mode);
    }
  }, []);

  return { colorMode, setColorMode: setMode } as const;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemIsDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

function subscribeToSystem(callback: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/**
 * The scheme to wear: the person's choice, with "system" read from the
 * system's appearance. For what renders above the kit's provider, which
 * resolves the same choice for the app itself.
 */
export function useResolvedColorMode(): ResolvedColorMode {
  const { colorMode } = useColorModePreference();
  const dark = useSyncExternalStore(subscribeToSystem, systemIsDark);
  if (colorMode === "system") return dark ? "dark" : "light";
  return colorMode;
}
