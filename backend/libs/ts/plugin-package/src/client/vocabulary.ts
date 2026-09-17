/**
 * The words every client prints for the same thing.
 *
 * The CLI's `validate -f`, `push plugin --dry-run` and `install`, and the
 * console's install preview, all describe a package to the user; a
 * platform where the same fact is named differently on two surfaces has
 * two vocabularies. The labels here are the docs' words
 * (`docs/vocabulary.md`), kept once.
 */

import type { PluginDialect } from "../types.js";

/** Human labels for the four dialects, in the vocabulary the docs use. */
export const DIALECT_LABELS: Readonly<Record<PluginDialect, string>> = {
  "agent-plugins": "Agent Plugins 1.0",
  claude: "Claude Code plugin",
  cursor: "Cursor plugin",
  codex: "Codex plugin",
};
