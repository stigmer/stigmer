/**
 * Site-wide configuration and constants.
 * Single source of truth for all static configuration.
 */

export const SITE_CONFIG = {
  /** Site name */
  name: "Stigmer",

  /** Site tagline */
  tagline: "Agents as Microservices",

  /** Full site description */
  description:
    "Build agents in YAML or Go SDKs. Deploy once. Call from everywhere via gRPC. Update agents independently—all consumers benefit instantly. Stigmer handles sandboxing, orchestration, and MCP connections.",

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
    title: "Start Simple, Scale Naturally",
    description:
      "5-line YAML agent today. Type-safe Go SDK when you need conditionals, loops, error handling. No migration—both work together. Start with YAML for experiments, grow into SDK for production. No rip-and-replace.",
    icon: "file-code",
  },
  {
    title: "One Command, Zero Config",
    description:
      "Run `stigmer server` and you're building. No Docker to configure. No databases to set up. No YAML hell. Stigmer auto-downloads Temporal, configures SQLite for local dev. The 2 weeks of DevOps work happens in 30 seconds.",
    icon: "terminal",
  },
  {
    title: "Production-Grade Stack",
    description:
      "Temporal workflows. gRPC contracts. Go SDK with full type safety and IDE autocomplete. Event sourcing patterns. Your local setup mirrors production architecture—just scaled down. Graduate to Stigmer Cloud when ready. Same code, managed infrastructure.",
    icon: "cpu",
  },
  {
    title: "Bring Your Own AI",
    description:
      "Ollama for free local development. OpenAI or Anthropic for production. Or your own model via LangChain integration. API key optional, not required.",
    icon: "activity",
  },
  {
    title: "Fully Open Source",
    description:
      "Source code on GitHub. Fork it. Modify it. Self-host it. Public gRPC contracts at github.com/stigmer/stigmer/apis/. Build on Stigmer, extend Stigmer, or learn from Stigmer.",
    icon: "unlock",
  },
  {
    title: "Integrate Agents Anywhere",
    description:
      "Public gRPC protos. Type-safe contracts. Call agents from Go, Python, Java, TypeScript, Rust—any language with gRPC support. Agents are microservices, not libraries. Update once, all consumers benefit instantly.",
    icon: "network",
  },
] as const;
