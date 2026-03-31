/**
 * Site-wide configuration and constants.
 * Single source of truth for all static configuration.
 */

export const SITE_CONFIG = {
  /** Site name */
  name: "Stigmer",

  /** Site tagline — placeholder until Phase 2 messaging is defined */
  tagline: "AI Agent Platform",

  /** Full site description — placeholder until Phase 2 messaging is defined */
  description:
    "Open-source platform for building AI agents that work for your business.",

  /** Production URL */
  url: "https://stigmer.ai",

  /** GitHub repository URL */
  githubUrl: "https://github.com/stigmer/stigmer",

  /** GitHub organization */
  githubOrg: "stigmer",

  /** GitHub repository name */
  githubRepo: "stigmer",

  /** Social links */
  social: {
    github: "https://github.com/stigmer/stigmer",
  },

  /** Copyright */
  copyright: {
    holder: "Stigmer",
    license: "Apache 2.0",
  },
} as const;

/**
 * Navigation links for the site header.
 */
export const NAV_LINKS = [
  { label: "Docs", href: "/docs" },
  { label: "GitHub", href: SITE_CONFIG.githubUrl, external: true },
] as const;

/**
 * Footer navigation sections.
 */
export const FOOTER_LINKS = {
  product: [
    { label: "Documentation", href: "/docs" },
  ],
  community: [
    { label: "GitHub", href: SITE_CONFIG.githubUrl, external: true },
    {
      label: "Contributing",
      href: `${SITE_CONFIG.githubUrl}/blob/main/CONTRIBUTING.md`,
      external: true,
    },
    {
      label: "Issues",
      href: `${SITE_CONFIG.githubUrl}/issues`,
      external: true,
    },
  ],
} as const;

/**
 * Feature highlights for the landing page.
 * Empty until Phase 2 defines new positioning.
 */
export const FEATURES = [] as const;
