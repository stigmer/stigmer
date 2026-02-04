/**
 * Site-wide configuration and constants.
 * Single source of truth for all static configuration.
 */

export const SITE_CONFIG = {
  /** Site name */
  name: "Stigmer",

  /** Site tagline */
  tagline: "Build Agents. Skip the Infrastructure.",

  /** Full site description */
  description:
    "Open source platform for building AI agents. We handle sandboxing, orchestration, and MCP security. You write YAML or Go. Agents run locally with zero cloud dependency or scale to production. gRPC integration works with any language.",

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
    // Add more as needed:
    // twitter: "https://twitter.com/stigmer",
    // discord: "https://discord.gg/stigmer",
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
  { label: "Examples", href: "/examples" },
  { label: "GitHub", href: SITE_CONFIG.githubUrl, external: true },
] as const;

/**
 * Footer navigation sections.
 */
export const FOOTER_LINKS = {
  product: [
    { label: "Features", href: "/#features" },
    { label: "Documentation", href: "/docs" },
    { label: "Examples", href: "/examples" },
    { label: "Changelog", href: "/changelog" },
  ],
  resources: [
    { label: "Getting Started", href: "/docs/getting-started" },
    { label: "CLI Reference", href: "/docs/cli" },
    { label: "SDK Guide", href: "/docs/sdk" },
    { label: "API Reference", href: "/docs/api" },
  ],
  community: [
    { label: "GitHub", href: SITE_CONFIG.githubUrl, external: true },
    { label: "Contributing", href: `${SITE_CONFIG.githubUrl}/blob/main/CONTRIBUTING.md`, external: true },
    { label: "Issues", href: `${SITE_CONFIG.githubUrl}/issues`, external: true },
  ],
} as const;

/**
 * Feature highlights for the landing page.
 */
export const FEATURES = [
  {
    title: "Isolated Execution Environments",
    description:
      "Every agent runs in its own sandbox. MCP servers are isolated. File system access is controlled. Your agents can't interfere with each other or your system.",
    icon: "shield",
  },
  {
    title: "Temporal Workflows Under the Hood",
    description:
      "Agent execution is Temporal workflows. Automatic retries. Durable state. Event sourcing. You don't write workflow code—Stigmer generates it from your agent spec.",
    icon: "cpu",
  },
  {
    title: "Zero Cloud Dependency",
    description:
      "Runs 100% locally with SQLite. No auth, no network, no Docker setup. One command: stigmer server. Your agents execute in seconds.",
    icon: "terminal",
  },
  {
    title: "Start Simple, Grow into Code",
    description:
      "5-line YAML agent today. Type-safe Go SDK tomorrow. Both work together. Your choice, your timeline.",
    icon: "file-code",
  },
  {
    title: "Call from Any Language",
    description:
      "Public gRPC contracts. Generated clients for Go, Python, Java, TypeScript, Rust. Your apps call agents like any microservice.",
    icon: "network",
  },
  {
    title: "Apache 2.0. Fork It. Own It.",
    description:
      "Source code on GitHub. Public proto contracts. No vendor lock-in. Build on Stigmer, extend Stigmer, or learn from Stigmer.",
    icon: "unlock",
  },
] as const;
