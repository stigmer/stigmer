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
  },

  copyright: {
    holder: "Stigmer",
    license: "Apache 2.0",
  },

  // TODO: Phase 3 — update to Stigmer Cloud sign-up URL
  cloudSignupUrl: "https://cloud.stigmer.ai/signup",
  // TODO: Phase 3 — update to Stigmer Cloud sign-in URL
  cloudSigninUrl: "https://cloud.stigmer.ai/signin",
} as const;

/**
 * Navigation links for the site header.
 * Per IA Section 2: Logo | Use Cases | Docs | Pricing | GitHub | Sign In | [Start Free]
 */
export const NAV_LINKS = [
  { label: "Use Cases", href: "/use-cases" },
  { label: "Docs", href: "/docs" },
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
    // TODO: Phase 3 — update to /docs/getting-started/quickstart
    { label: "Getting Started", href: "/docs" },
    // TODO: Phase 6 — update to /docs/tutorials/give-your-agent-tools
    { label: "Tutorials", href: "/docs" },
    // TODO: Phase 7 — update to /docs/reference/api
    { label: "API Reference", href: "/docs" },
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
