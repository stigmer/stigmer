/**
 * Stigmer's own reverse-domain folder, `ai.stigmer/`: read by nothing.
 *
 * The open format gives each client a folder other clients ignore. Stigmer
 * installs a plugin exactly as every other client does, from its skills,
 * agents, hooks and MCP configuration, so a plugin means the same thing
 * wherever it is installed. A plugin that still carries the folder is told
 * so once, as a warning: it installs, without it. The manifest's
 * `extensions["ai.stigmer"]` (presentation.ts) is the format's own host
 * slot and stays read.
 */

import type { PluginFileIndex } from "../files.js";
import type { Findings } from "../messages.js";

export const STIGMER_FOLDER = "ai.stigmer";

/** Warns once when the plugin carries anything under `ai.stigmer/`. */
export function warnStigmerFolder(index: PluginFileIndex, findings: Findings): void {
  if (index.filesUnder(STIGMER_FOLDER).length > 0) {
    findings.warn("stigmer-folder-ignored", { path: `${STIGMER_FOLDER}/` });
  }
}
