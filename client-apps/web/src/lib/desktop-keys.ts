// ---------------------------------------------------------------------------
// The browser-storage keys of the Stigmer Desktop nudge
//
// The shell's Desktop banner (domain/_shared/layout/DesktopAppBanner) reads
// these to decide whether to show, and the download helper
// (lib/desktop-download) writes the download mark and the remembered
// installer answer. Both import them from here, so neither imports the
// other for a name. Every value is a per-browser convenience in
// `localStorage`; nothing here reaches the server.
// ---------------------------------------------------------------------------

/** When this browser first opened the signed-in console (an ISO time). */
export const FIRST_SEEN_KEY = "stigmer:desktop-banner-first-seen";

/** The campaign the banner was dismissed for (`{ campaign, ts }`). */
export const DISMISSED_KEY = "stigmer:desktop-banner-dismissed";

/** Set once this browser started a desktop download; the banner then stays away. */
export const DOWNLOADED_KEY = "stigmer:desktop-downloaded";

/** Set once a runner on this machine was seen; the banner then stays away. */
export const LOCAL_RUNNER_KEY = "stigmer:has-local-runner";

/**
 * Whether the latest release has an installer for this browser's platform,
 * and when that was asked (`{ installer, checkedAt }`), so the console asks
 * the release API at most once a day.
 */
export const INSTALLER_KEY = "stigmer:desktop-installer";
