"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Download, Monitor, X } from "lucide-react";
import { IconButton, useActiveOrgId, useJourney, type UseJourneyReturn } from "@stigmer/react-sdk";
import { hasDesktopInstaller, triggerDesktopDownload } from "@/lib/desktop-download";
import {
  DISMISSED_KEY,
  DOWNLOADED_KEY,
  FIRST_SEEN_KEY,
  LOCAL_RUNNER_KEY,
} from "@/lib/desktop-keys";

// ---------------------------------------------------------------------------
// Desktop banner visibility
//
// The banner is a promotional nudge for Stigmer Desktop. It is mounted only
// by the signed-in shell ({@link ShellDesktopBanner} in AppShell), inside
// the organization providers the public routes lack, so `/login` and
// `/invite/` never seed its first-seen key and a first visit after sign-up
// is a first visit (stigmer#3194).
//
// Show when, in this order:
//   - Second+ visit (first-seen key exists, not seeded on this page load) AND
//   - Not dismissed for current campaign AND
//   - Not already using desktop (Tauri, local runner, or downloaded) AND
//   - The organization's onboarding journey is not open: a person with a
//     step to take has one job, and an ad for another app competes with it AND
//   - The latest release has an installer for this platform (asked only when
//     every rule above would show it; remembered in this browser for a day)
//
// Campaign-scoped dismissal: bumping BANNER_CAMPAIGN_ID resets dismissals
// so the banner can reappear for major desktop feature launches.
//
// Stop criteria — conditions under which this banner should be removed:
//   1. User has a local runner connected → auto-hidden via LOCAL_RUNNER_KEY
//   2. User downloaded via triggerDesktopDownload → auto-hidden via DOWNLOADED_KEY
//   3. User dismissed for current campaign → hidden until campaign bumps
//   4. 90 days after banner feature launch → evaluate adoption metrics;
//      decide whether to continue, redesign, or remove entirely
//   5. Desktop app reaches >40% adoption among console users → remove the
//      global banner; keep contextual DesktopAppPromo on Runners page
// ---------------------------------------------------------------------------

/**
 * Bump this value when shipping a new desktop feature campaign.
 * Dismissed banners from older campaigns will automatically reset.
 */
const BANNER_CAMPAIGN_ID = "2026.04";

let seededThisSession = false;

function isRunningInTauri(): boolean {
  try {
    return typeof window !== "undefined" && "__TAURI__" in window;
  } catch {
    return false;
  }
}

function hasDesktopSignal(): boolean {
  try {
    if (isRunningInTauri()) return true;
    if (localStorage.getItem(DOWNLOADED_KEY)) return true;
    if (localStorage.getItem(LOCAL_RUNNER_KEY)) return true;
    return false;
  } catch {
    return false;
  }
}

function isDismissedForCurrentCampaign(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.campaign === BANNER_CAMPAIGN_ID;
  } catch {
    return false;
  }
}

function getBannerSnapshot(): boolean {
  try {
    if (seededThisSession) return false;
    if (hasDesktopSignal()) return false;
    if (isDismissedForCurrentCampaign()) return false;
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
    if (
      e.key === FIRST_SEEN_KEY ||
      e.key === DISMISSED_KEY ||
      e.key === DOWNLOADED_KEY ||
      e.key === LOCAL_RUNNER_KEY
    ) {
      callback();
    }
  }
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/**
 * Whether the organization's onboarding journey leaves room for the banner:
 * read as the journey's card reads it (`useJourney`), the banner waits while
 * the answer is pending and stays away while a step is current. A journey
 * that is done, or "off" (a member, a host or server without one, a failed
 * read), leaves room.
 */
function journeyLeavesRoom(journey: UseJourneyReturn): boolean {
  if (journey.status === "off") return true;
  return journey.status === "ready" && journey.current === undefined;
}

/**
 * Whether the latest release has an installer for this platform, asked only
 * while `asking`; undefined until answered.
 */
function useHasInstaller(asking: boolean): boolean | undefined {
  const [installer, setInstaller] = useState<boolean | undefined>(undefined);
  const known = installer !== undefined;

  useEffect(() => {
    if (!asking || known) return;
    let live = true;
    hasDesktopInstaller().then(
      (answer) => {
        if (live) setInstaller(answer);
      },
      () => {
        if (live) setInstaller(false);
      },
    );
    return () => {
      live = false;
    };
  }, [asking, known]);

  return installer;
}

/**
 * Manages the desktop app nudge banner lifecycle.
 *
 * Uses `useSyncExternalStore` with localStorage (matching the sidebar
 * pattern in `use-layout-state.tsx`) so the banner reacts to cross-tab
 * changes and avoids SSR hydration mismatches.
 *
 * The banner is suppressed when any desktop signal is detected:
 * - Running inside Tauri (user is already in the desktop app)
 * - `stigmer:desktop-downloaded` flag set (user triggered a download)
 * - `stigmer:has-local-runner` flag set (local runner detected)
 *
 * It also waits for the organization's onboarding journey to close, and for
 * the release to have an installer for this platform.
 *
 * Dismissal is scoped to {@link BANNER_CAMPAIGN_ID} so it resets
 * when a new campaign ships.
 *
 * Reads the active organization, so it runs only under `OrgProvider`: the
 * signed-in shell, never a public route.
 */
export function useDesktopBannerState() {
  const storageAllows = useSyncExternalStore(
    subscribeBanner,
    getBannerSnapshot,
    getBannerServerSnapshot,
  );
  const org = useActiveOrgId();
  const journey = useJourney(org, { enabled: true });
  const asking = storageAllows && journeyLeavesRoom(journey);
  const installer = useHasInstaller(asking);

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
      localStorage.setItem(
        DISMISSED_KEY,
        JSON.stringify({ campaign: BANNER_CAMPAIGN_ID, ts: new Date().toISOString() }),
      );
    } catch {
      /* SSR or private browsing */
    }
    window.dispatchEvent(new StorageEvent("storage", { key: DISMISSED_KEY }));
  }, []);

  return { visible: asking && installer === true, dismiss } as const;
}

/**
 * Returns `true` when any desktop signal is present (Tauri, downloaded, local runner).
 *
 * Useful for hiding the contextual desktop promo on the Runners page
 * independently from the banner's visit-based and campaign-scoped logic.
 */
export function useHasDesktopSignal(): boolean {
  return useSyncExternalStore(
    subscribeBanner,
    hasDesktopSignal,
    () => false,
  );
}

/**
 * Records that a local runner was detected for banner suppression.
 *
 * Called by the runner list/picker when a runner with a local hostname
 * is observed. Once set, the desktop banner is permanently hidden.
 */
export function markLocalRunnerDetected(): void {
  try {
    if (!localStorage.getItem(LOCAL_RUNNER_KEY)) {
      localStorage.setItem(LOCAL_RUNNER_KEY, new Date().toISOString());
      window.dispatchEvent(
        new StorageEvent("storage", { key: LOCAL_RUNNER_KEY }),
      );
    }
  } catch {
    /* private browsing */
  }
}

/**
 * The signed-in shell's Desktop banner: owns its state and draws
 * {@link DesktopAppBanner} only when every rule above allows it.
 */
export function ShellDesktopBanner() {
  const { visible, dismiss } = useDesktopBannerState();
  if (!visible) return null;
  return <DesktopAppBanner onDismiss={dismiss} />;
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
      <IconButton label="Dismiss" size="xs" icon={<X className="size-3.5" />} onClick={onDismiss} className="-mr-1" />
    </aside>
  );
}
