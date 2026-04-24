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

  contactSalesUrl: "/contact-sales",
  waitlistUrl: "/pricing#waitlist",

  leadsFormUrl: "https://stigmer-prod-leads-form-receiver.planton.live",
} as const;

/**
 * Stigmer Desktop app release configuration.
 * Artifact filenames follow Tauri 2 bundler conventions for productName "Stigmer".
 * Verify against actual GitHub Release assets after the first published desktop-v* tag.
 */
export const DESKTOP_CONFIG = {
  version: "0.1.0",
  releaseTag: "desktop-v0.1.0",
  releasesUrl: `${SITE_CONFIG.githubUrl}/releases`,
  releaseUrl: `${SITE_CONFIG.githubUrl}/releases/tag/desktop-v0.1.0`,
  platforms: [
    {
      os: "macos" as const,
      arch: "arm64" as const,
      label: "macOS",
      archLabel: "Apple Silicon",
      filename: "Stigmer_0.1.0_aarch64.dmg",
      fileExt: ".dmg",
    },
    {
      os: "macos" as const,
      arch: "x64" as const,
      label: "macOS",
      archLabel: "Intel",
      filename: "Stigmer_0.1.0_x64.dmg",
      fileExt: ".dmg",
    },
    {
      os: "windows" as const,
      arch: "x64" as const,
      label: "Windows",
      archLabel: "64-bit",
      filename: "Stigmer_0.1.0_x64-setup.exe",
      fileExt: ".exe",
    },
    {
      os: "linux" as const,
      arch: "x64" as const,
      label: "Linux",
      archLabel: ".deb",
      filename: "stigmer_0.1.0_amd64.deb",
      fileExt: ".deb",
    },
    {
      os: "linux" as const,
      arch: "x64-appimage" as const,
      label: "Linux",
      archLabel: ".AppImage",
      filename: "stigmer_0.1.0_amd64.AppImage",
      fileExt: ".AppImage",
    },
  ],
} as const;

export type DesktopPlatform = (typeof DESKTOP_CONFIG.platforms)[number];

export function getDownloadUrl(platform: DesktopPlatform): string {
  return `${SITE_CONFIG.githubUrl}/releases/download/${DESKTOP_CONFIG.releaseTag}/${platform.filename}`;
}

/**
 * Navigation links for the site header.
 * Layout: Logo | Use Cases | Docs | Blog | Pricing | Download | GitHub | Discord | Sign In | [Start Free]
 */
export const NAV_LINKS = [
  { label: "Use Cases", href: "/use-cases" },
  { label: "Docs", href: "/docs" },
  { label: "Blog", href: "/blog" },
  { label: "Pricing", href: "/pricing" },
  { label: "Download", href: "/download" },
  { label: "GitHub", href: SITE_CONFIG.githubUrl, external: true },
] as const;

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
