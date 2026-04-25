/**
 * Desktop app download utilities.
 *
 * Resolves download URLs dynamically from the GitHub Releases API so we never
 * hardcode version strings. Platform detection + cached release resolution +
 * one-click download trigger with Sonner toast instructions.
 *
 * When the download cannot be triggered directly (API unreachable, platform
 * unknown, no matching asset), the user sees a failure-specific toast with an
 * action button linking to the marketing site download page. No forced
 * redirects, no popup-blocker risk from async window.open calls.
 */

import { toast } from "sonner";
import { EXTERNAL_LINKS } from "@/config/external-links";
import { DOWNLOADED_KEY } from "@/domain/_shared/layout/DesktopAppBanner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NavigatorUAData {
  brands: { brand: string; version: string }[];
  mobile: boolean;
  platform: string;
  getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>;
}

export type DetectedOS = "macos" | "windows" | "linux" | null;
export type DetectedArch = "arm64" | "x64" | null;

export interface DetectedPlatform {
  os: DetectedOS;
  arch: DetectedArch;
}

export interface DesktopAsset {
  os: DetectedOS;
  /** null = universal binary, matches any detected architecture. */
  arch: DetectedArch;
  url: string;
  filename: string;
  label: string;
}

interface ReleaseResult {
  version: string;
  assets: DesktopAsset[];
}

export type ReleaseFetchResult =
  | { ok: true; release: ReleaseResult }
  | { ok: false; reason: "fetch-failed"; status?: number }
  | { ok: false; reason: "no-assets" };

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/**
 * Detects the user's OS and architecture from browser APIs.
 *
 * Uses `navigator.userAgentData` (Chromium) for accurate architecture
 * detection on macOS, falling back to arm64 as the default since the
 * majority of active Macs shipped after 2020 use Apple Silicon.
 */
export function detectPlatform(): Promise<DetectedPlatform> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined") {
      resolve({ os: null, arch: null });
      return;
    }

    const ua = navigator.userAgent.toLowerCase();

    let os: DetectedOS = null;
    if (ua.includes("mac")) os = "macos";
    else if (ua.includes("win")) os = "windows";
    else if (ua.includes("linux")) os = "linux";

    let arch: DetectedArch = null;
    if (os === "macos") {
      const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
      if (uaData) {
        uaData
          .getHighEntropyValues(["architecture"])
          .then((values) => {
            resolve({ os, arch: values.architecture === "arm" ? "arm64" : "x64" });
          })
          .catch(() => {
            resolve({ os, arch: "arm64" });
          });
        return;
      }
      arch = "arm64";
    } else if (os === "windows" || os === "linux") {
      arch = "x64";
    }

    resolve({ os, arch });
  });
}

// ---------------------------------------------------------------------------
// Asset matching
// ---------------------------------------------------------------------------

const ASSET_PATTERNS: {
  test: (name: string) => boolean;
  os: DetectedOS;
  arch: DetectedArch;
  label: string;
}[] = [
  {
    test: (n) => n.endsWith(".dmg"),
    os: "macos",
    arch: null,
    label: "macOS",
  },
  {
    test: (n) => n.endsWith("-setup.exe"),
    os: "windows",
    arch: "x64",
    label: "Windows (64-bit)",
  },
  {
    test: (n) => n.endsWith(".deb"),
    os: "linux",
    arch: "x64",
    label: "Linux (.deb)",
  },
  {
    test: (n) => n.endsWith(".AppImage"),
    os: "linux",
    arch: "x64",
    label: "Linux (.AppImage)",
  },
];

function classifyAsset(
  name: string,
  url: string,
): DesktopAsset | null {
  for (const pattern of ASSET_PATTERNS) {
    if (pattern.test(name)) {
      return { os: pattern.os, arch: pattern.arch, url, filename: name, label: pattern.label };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// GitHub Releases API (cached)
// ---------------------------------------------------------------------------

const GITHUB_API =
  "https://api.github.com/repos/stigmer/stigmer/releases/latest";

let cachedRelease: ReleaseResult | null = null;

/**
 * Fetches the latest GitHub release and classifies desktop assets by file
 * extension. Returns a discriminated result so the caller can distinguish
 * between "API unreachable" and "release has no desktop assets."
 */
export async function fetchLatestDesktopRelease(): Promise<ReleaseFetchResult> {
  if (cachedRelease) return { ok: true, release: cachedRelease };

  try {
    const res = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) return { ok: false, reason: "fetch-failed", status: res.status };

    const data = await res.json();
    const tagName: string = data.tag_name ?? "";
    const version = tagName.replace(/^v/, "");

    const assets: DesktopAsset[] = [];
    for (const asset of data.assets ?? []) {
      const classified = classifyAsset(asset.name, asset.browser_download_url);
      if (classified) assets.push(classified);
    }

    if (assets.length === 0) return { ok: false, reason: "no-assets" };

    cachedRelease = { version, assets };
    return { ok: true, release: cachedRelease };
  } catch {
    return { ok: false, reason: "fetch-failed" };
  }
}

/**
 * Find the best-matching asset for the detected platform.
 *
 * A null arch on the asset (e.g. macOS universal .dmg) matches any detected
 * architecture. For Linux, prefers `.deb` over `.AppImage`.
 */
export function findAssetForPlatform(
  assets: DesktopAsset[],
  platform: DetectedPlatform,
): DesktopAsset | null {
  if (!platform.os) return null;

  const matches = assets.filter(
    (a) =>
      a.os === platform.os &&
      (a.arch === null || platform.arch === null || a.arch === platform.arch),
  );

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  return matches.find((a) => a.filename.endsWith(".deb")) ?? matches[0];
}

// ---------------------------------------------------------------------------
// Download trigger
// ---------------------------------------------------------------------------

const INSTALL_INSTRUCTIONS: Record<string, string> = {
  macos: "Open the .dmg and drag Stigmer to Applications.",
  windows: "Run the installer and follow the prompts.",
  linux: "Install with sudo dpkg -i <filename>.",
};

const OS_LABELS: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

const DOWNLOAD_PAGE_ACTION = {
  label: "Download page",
  onClick: () =>
    window.open(EXTERNAL_LINKS.download, "_blank", "noopener,noreferrer"),
};

/**
 * Attempts a direct download of the desktop app for the user's platform.
 *
 * 1. Detects platform
 * 2. Fetches the latest release from GitHub
 * 3. Triggers a browser download for the matching asset
 * 4. Shows a Sonner toast with platform-specific install instructions
 *
 * On failure, shows a specific toast with an action button linking to the
 * marketing site download page. The user stays in the console and chooses
 * whether to navigate — no forced redirects, no popup-blocker risk.
 */
export async function triggerDesktopDownload(): Promise<void> {
  try {
    const [platform, releaseResult] = await Promise.all([
      detectPlatform(),
      fetchLatestDesktopRelease(),
    ]);

    if (!platform.os) {
      console.warn("[desktop-download] Platform detection returned no OS", {
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "n/a",
      });
      toast.warning("Couldn\u2019t detect your platform.", {
        description: "Visit the download page to pick the right installer.",
        action: DOWNLOAD_PAGE_ACTION,
        duration: 8000,
      });
      return;
    }

    if (!releaseResult.ok) {
      console.warn("[desktop-download] Release fetch failed", releaseResult);
      toast.warning("Couldn\u2019t reach the download server.", {
        description: "Try again in a moment, or visit the download page.",
        action: DOWNLOAD_PAGE_ACTION,
        duration: 8000,
      });
      return;
    }

    const asset = findAssetForPlatform(releaseResult.release.assets, platform);
    if (!asset) {
      console.warn("[desktop-download] No matching asset for platform", {
        platform,
        availableAssets: releaseResult.release.assets.map((a) => ({
          os: a.os,
          arch: a.arch,
          filename: a.filename,
        })),
      });
      toast.warning(
        `No installer found for ${OS_LABELS[platform.os] ?? platform.os}.`,
        {
          description:
            "This platform may not be supported yet. Check all available downloads.",
          action: DOWNLOAD_PAGE_ACTION,
          duration: 8000,
        },
      );
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = asset.url;
    anchor.download = asset.filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    markDesktopDownloaded();

    toast.success(`Downloading Stigmer Desktop for ${asset.label}`, {
      description:
        INSTALL_INSTRUCTIONS[asset.os ?? ""] ??
        "Check your downloads folder for the installer.",
      duration: 8000,
    });
  } catch (err) {
    console.warn("[desktop-download] Unexpected error", err);
    toast.warning("Something went wrong.", {
      description: "Visit the download page to download Stigmer Desktop.",
      action: DOWNLOAD_PAGE_ACTION,
      duration: 8000,
    });
  }
}

// ---------------------------------------------------------------------------
// Download signal — suppresses the desktop banner after a successful download
// ---------------------------------------------------------------------------

function markDesktopDownloaded(): void {
  try {
    localStorage.setItem(DOWNLOADED_KEY, new Date().toISOString());
    window.dispatchEvent(
      new StorageEvent("storage", { key: DOWNLOADED_KEY }),
    );
  } catch {
    /* private browsing */
  }
}

// ---------------------------------------------------------------------------
// React hook for components that need platform info at render time
// ---------------------------------------------------------------------------

export { type DetectedPlatform as Platform };
