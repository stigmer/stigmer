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
} as const;

/**
 * Navigation links for the site header.
 * Per IA Section 2: Logo | Use Cases | Docs | Pricing | GitHub | Sign In | [Start Free]
 */
export const NAV_LINKS = [
  { label: "Use Cases", href: "/use-cases" },
  { label: "Docs", href: "/docs" },
  { label: "Blog", href: "/blog" },
  { label: "Pricing", href: "/pricing" },
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
