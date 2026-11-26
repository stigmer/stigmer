/**
 * Stigmer is in Beta: the word, the one line every surface says it in, and the
 * public page that says what it means and the bar for lifting it.
 *
 * Beta is the product's own statement, the same in every edition (Stigmer
 * Cloud, a self-hosted server, `stigmer up` on a laptop, the desktop app), so
 * no deployment sets it and no host can turn it off. It is said once per
 * surface where a newcomer meets Stigmer, and never inside a developer's own
 * product: the embedded chat (`AgentChat`, the embed) stays theirs.
 *
 * The site imports it: the "Beta" mark beside the brand in both headers
 * (site/src/components/layout/BetaMark.tsx). Every other surface spells it
 * out, because none of them can import this file:
 *   - the console kit's constant (sdk/react/src/internal/beta.ts), in a
 *     published package: the sidebar's mark and the sign-in screen's line;
 *   - the CLI's constant (client-apps/cli/src/beta.ts), in a published
 *     package: the hint after `stigmer auth login` and `stigmer up`;
 *   - the setup guide a coding agent follows
 *     (coding-agents/plugin/skills/stigmer-setup/SKILL.md), printed by
 *     `stigmer coding-agent`;
 *   - the coding-agent setup page (docs/getting-started/coding-agent.mdx);
 *   - the Beta page itself (docs/beta.mdx);
 *   - the GitHub README (README.md);
 *   - the vocabulary's **Beta** entry (docs/vocabulary.md).
 * brand/__tests__/beta.test.ts holds every copy to this one, whitespace
 * collapsed, and the page to `path`. Lifting Beta deletes this file, and that
 * test then names every copy left to remove.
 */
const path = "/docs/beta";

export const BETA = {
  /** The mark's word, beside the brand. */
  word: "Beta",
  /** The one line, wherever there is room for a sentence. */
  line: "Stigmer is in Beta: things may change, and your work is kept. Tell us what breaks.",
  /** The page on stigmer.ai, as the site links it. */
  path,
  /** The page, as every surface off the site links it. */
  url: `https://stigmer.ai${path}`,
} as const;
