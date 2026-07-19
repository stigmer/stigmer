/**
 * Site-wide configuration and constants.
 * Single source of truth for all static configuration.
 */

export const SITE_CONFIG = {
  name: "Stigmer",

  tagline: "Build agents that work for your business",

  description:
    "Open-source AI agent platform that lets you turn domain knowledge and tools into agents your applications can call via API.",

  url: "https://stigmer.ai",

  githubUrl: "https://github.com/stigmer/stigmer",

  githubOrg: "stigmer",

  githubRepo: "stigmer",

  social: {
    github: "https://github.com/stigmer/stigmer",
    discord: "https://discord.gg/EtANnfsJ8B",
  },

  copyright: {
    holder: "Stigmer",
    license: "Apache 2.0",
  },

  cloudSignupUrl: "https://app.stigmer.ai",
  cloudSigninUrl: "https://app.stigmer.ai",
  cloudApiUrl: "https://api.stigmer.ai",

  contactSalesUrl: "/contact-sales",

  leadsFormUrl: "https://leads.stigmer.ai",
} as const;

// ---------------------------------------------------------------------------
// Desktop download — resolved dynamically from the GitHub Releases API
// ---------------------------------------------------------------------------

const GITHUB_RELEASES_API = `https://api.github.com/repos/${SITE_CONFIG.githubOrg}/${SITE_CONFIG.githubRepo}/releases/latest`;

/** Base platform metadata shape. */
export interface DesktopPlatform {
  os: "macos" | "windows" | "linux";
  arch: string;
  label: string;
  archLabel: string;
  fileExt: string;
}

/** Static platform metadata used for display regardless of the release. */
export const DESKTOP_PLATFORMS: DesktopPlatform[] = [
  { os: "macos", arch: "universal", label: "macOS", archLabel: "Universal", fileExt: ".dmg" },
  { os: "windows", arch: "x64", label: "Windows", archLabel: "64-bit", fileExt: ".exe" },
  { os: "linux", arch: "x64", label: "Linux", archLabel: ".deb", fileExt: ".deb" },
  { os: "linux", arch: "x64-appimage", label: "Linux", archLabel: ".AppImage", fileExt: ".AppImage" },
];

/** A platform entry enriched with a live download URL from the GitHub release. */
export interface ResolvedDesktopPlatform extends DesktopPlatform {
  downloadUrl: string;
  filename: string;
}

export interface DesktopRelease {
  version: string;
  releaseUrl: string;
  platforms: ResolvedDesktopPlatform[];
}

// Asset filename → platform matching rules (Tauri 2 naming conventions)
const ASSET_MATCHERS: { test: (name: string) => boolean; os: DesktopPlatform["os"]; arch: DesktopPlatform["arch"] }[] = [
  { test: (n) => n.endsWith(".dmg"), os: "macos", arch: "universal" },
  { test: (n) => n.endsWith("-setup.exe"), os: "windows", arch: "x64" },
  { test: (n) => n.endsWith(".deb"), os: "linux", arch: "x64" },
  { test: (n) => n.endsWith(".AppImage"), os: "linux", arch: "x64-appimage" },
];

let cachedRelease: DesktopRelease | null = null;

/**
 * Fetches the latest GitHub release and resolves desktop download URLs by
 * matching asset filenames against known Tauri 2 naming patterns.
 *
 * Results are cached for the lifetime of the page so repeat calls are free.
 * Returns `null` if the API is unreachable or the release has no desktop assets.
 */
export async function fetchDesktopRelease(): Promise<DesktopRelease | null> {
  if (cachedRelease) return cachedRelease;

  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const tagName: string = data.tag_name ?? "";
    const version = tagName.replace(/^v/, "");
    const releaseUrl: string = data.html_url ?? `${SITE_CONFIG.githubUrl}/releases/tag/${tagName}`;

    const resolved: ResolvedDesktopPlatform[] = [];
    for (const asset of data.assets ?? []) {
      const name: string = asset.name;
      const url: string = asset.browser_download_url;
      for (const matcher of ASSET_MATCHERS) {
        if (matcher.test(name)) {
          const meta = DESKTOP_PLATFORMS.find(
            (p) => p.os === matcher.os && p.arch === matcher.arch,
          );
          if (meta) {
            resolved.push({ ...meta, downloadUrl: url, filename: name });
          }
          break;
        }
      }
    }

    if (resolved.length === 0) return null;

    cachedRelease = { version, releaseUrl, platforms: resolved };
    return cachedRelease;
  } catch {
    return null;
  }
}

export const DESKTOP_RELEASES_URL = `${SITE_CONFIG.githubUrl}/releases`;

/**
 * Navigation link types for the site header.
 */
export interface NavLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavLink[];
}

/**
 * Header navigation structure.
 * Layout: Logo | Docs | Pricing | Resources ▾ | [GH] [DC] | Sign In | [Start Free]
 *
 * Primary links are rendered as top-level text links.
 * The resources group renders as a single dropdown trigger.
 */
export const NAV_PRIMARY: NavLink[] = [
  { label: "Docs", href: "/docs" },
  { label: "Pricing", href: "/pricing" },
];

export const NAV_RESOURCES: NavGroup = {
  label: "Resources",
  items: [
    { label: "Use Cases", href: "/use-cases" },
    { label: "Blog", href: "/blog" },
    { label: "Download", href: "/download" },
  ],
};

/**
 * Flat list of all nav links for contexts that need them (mobile menu, SEO).
 */
export const NAV_LINKS_ALL: NavLink[] = [
  ...NAV_PRIMARY,
  ...NAV_RESOURCES.items,
];

/**
 * Footer navigation sections.
 * Per IA Section 2: Product | Developers | Open Source
 */
export const FOOTER_LINKS = {
  product: [
    { label: "Use Cases", href: "/use-cases" },
    { label: "Pricing", href: "/pricing" },
    { label: "Documentation", href: "/docs" },
    { label: "Download", href: "/download" },
  ],
  developers: [
    { label: "Getting Started", href: "/docs/getting-started/quickstart" },
    { label: "Tutorials", href: "/docs" },
    { label: "SDK Reference", href: "/docs/sdk" },
  ],
  openSource: [
    { label: "GitHub", href: SITE_CONFIG.githubUrl, external: true },
    {
      label: "Contributing",
      href: `${SITE_CONFIG.githubUrl}/blob/main/CONTRIBUTING.md`,
      external: true,
    },
    {
      label: "Apache 2.0 License",
      href: `${SITE_CONFIG.githubUrl}/blob/main/LICENSE`,
      external: true,
    },
  ],
} as const;
