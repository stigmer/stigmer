import { useCallback, useSyncExternalStore } from "react";
import type { ColorMode } from "@stigmer/react";

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
