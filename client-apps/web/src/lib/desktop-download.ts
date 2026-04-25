/**
 * Desktop app download utilities.
 *
 * Resolves download URLs dynamically from the GitHub Releases API so we never
 * hardcode version strings. Platform detection + cached release resolution +
 * one-click download trigger with Sonner toast instructions.
 */

import { toast } from "sonner";
import { EXTERNAL_LINKS } from "@/config/external-links";

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
  arch: DetectedArch;
  url: string;
  filename: string;
  label: string;
}

interface ReleaseResult {
  version: string;
  assets: DesktopAsset[];
}

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
    test: (n) => n.endsWith(".dmg") && /aarch64|arm64/.test(n),
    os: "macos",
    arch: "arm64",
    label: "macOS (Apple Silicon)",
  },
  {
    test: (n) => n.endsWith(".dmg") && /x64|x86_64/.test(n),
    os: "macos",
    arch: "x64",
    label: "macOS (Intel)",
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

export async function fetchLatestDesktopRelease(): Promise<ReleaseResult | null> {
  if (cachedRelease) return cachedRelease;

  try {
    const res = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const tagName: string = data.tag_name ?? "";
    const version = tagName.replace(/^v/, "");

    const assets: DesktopAsset[] = [];
    for (const asset of data.assets ?? []) {
      const classified = classifyAsset(asset.name, asset.browser_download_url);
      if (classified) assets.push(classified);
    }

    if (assets.length === 0) return null;

    cachedRelease = { version, assets };
    return cachedRelease;
  } catch {
    return null;
  }
}

/**
 * Find the best-matching asset for the detected platform.
 * For Linux, prefers `.deb` over `.AppImage`.
 */
export function findAssetForPlatform(
  assets: DesktopAsset[],
  platform: DetectedPlatform,
): DesktopAsset | null {
  if (!platform.os) return null;

  const matches = assets.filter(
    (a) =>
      a.os === platform.os &&
      (platform.arch ? a.arch === platform.arch : true),
  );

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Prefer .deb over .AppImage for Linux
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

/**
 * Attempts a direct download of the desktop app for the user's platform.
 *
 * 1. Detects platform
 * 2. Fetches the latest release from GitHub
 * 3. Triggers a browser download for the matching asset
 * 4. Shows a Sonner toast with platform-specific install instructions
 *
 * Falls back to opening the marketing site download page if any step fails.
 */
export async function triggerDesktopDownload(): Promise<void> {
  try {
    const [platform, release] = await Promise.all([
      detectPlatform(),
      fetchLatestDesktopRelease(),
    ]);

    if (!release || !platform.os) {
      openFallbackDownloadPage();
      return;
    }

    const asset = findAssetForPlatform(release.assets, platform);
    if (!asset) {
      openFallbackDownloadPage();
      return;
    }

    // Trigger browser download via a temporary anchor element
    const anchor = document.createElement("a");
    anchor.href = asset.url;
    anchor.download = asset.filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    toast.success(`Downloading Stigmer Desktop for ${asset.label}`, {
      description:
        INSTALL_INSTRUCTIONS[asset.os ?? ""] ??
        "Check your downloads folder for the installer.",
      duration: 8000,
    });
  } catch {
    openFallbackDownloadPage();
  }
}

function openFallbackDownloadPage(): void {
  window.open(EXTERNAL_LINKS.download, "_blank", "noopener,noreferrer");
  toast.info("Opening download page\u2026", {
    description:
      "We couldn\u2019t detect your platform automatically. Pick the right installer on the download page.",
    duration: 5000,
  });
}

// ---------------------------------------------------------------------------
// React hook for components that need platform info at render time
// ---------------------------------------------------------------------------

export { type DetectedPlatform as Platform };
