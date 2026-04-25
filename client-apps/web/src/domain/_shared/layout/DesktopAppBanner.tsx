"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Download, Monitor, X } from "lucide-react";
import { triggerDesktopDownload } from "@/lib/desktop-download";

// ---------------------------------------------------------------------------
// Desktop banner visibility — visit-based trigger, permanent dismissal
//
// First visit:  seeds "first-seen" via useEffect, banner stays hidden.
// Second+ visit: "first-seen" exists, "dismissed" absent → banner visible.
// Dismiss:       sets "dismissed", dispatches storage event → banner hidden.
// ---------------------------------------------------------------------------

const FIRST_SEEN_KEY = "stigmer:desktop-banner-first-seen";
const DISMISSED_KEY = "stigmer:desktop-banner-dismissed";

// Tracks whether we seeded FIRST_SEEN during this page load. Resets on
// reload (module re-evaluation), which is exactly when "second visit" begins.
let seededThisSession = false;

function getBannerSnapshot(): boolean {
  try {
    if (seededThisSession) return false;
    if (localStorage.getItem(DISMISSED_KEY)) return false;
    return localStorage.getItem(FIRST_SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

function getBannerServerSnapshot(): boolean {
  return false;
}

function subscribeBanner(callback: () => void): () => void {
  function onStorage(e: StorageEvent) {
    if (e.key === FIRST_SEEN_KEY || e.key === DISMISSED_KEY) callback();
  }
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/**
 * Manages the desktop app nudge banner lifecycle.
 *
 * Uses `useSyncExternalStore` with localStorage (matching the sidebar
 * pattern in `use-layout-state.tsx`) so the banner reacts to cross-tab
 * changes and avoids SSR hydration mismatches.
 */
export function useDesktopBannerState() {
  const visible = useSyncExternalStore(
    subscribeBanner,
    getBannerSnapshot,
    getBannerServerSnapshot,
  );

  useEffect(() => {
    try {
      if (!localStorage.getItem(FIRST_SEEN_KEY)) {
        localStorage.setItem(FIRST_SEEN_KEY, new Date().toISOString());
        seededThisSession = true;
      }
    } catch {
      /* SSR or private browsing */
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      /* SSR or private browsing */
    }
    window.dispatchEvent(new StorageEvent("storage", { key: DISMISSED_KEY }));
  }, []);

  return { visible, dismiss } as const;
}

export function DesktopAppBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <aside
      role="complementary"
      aria-label="Desktop app"
      className="bg-card border-border-muted flex items-center gap-3 border-b px-4 py-2.5"
    >
      <Monitor className="text-muted-foreground size-4 shrink-0" />
      <p className="text-muted-foreground min-w-0 flex-1 text-xs">
        <span className="text-foreground font-medium">Stigmer Desktop</span>
        {" \u2014 "}
        manage runners from your system tray with deep-link launches and native
        notifications.
      </p>
      <button
        type="button"
        onClick={triggerDesktopDownload}
        className="text-primary hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs font-medium transition-colors"
      >
        Download
        <Download className="text-muted-foreground size-3" />
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground -mr-1 shrink-0 rounded p-0.5 transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </aside>
  );
}
