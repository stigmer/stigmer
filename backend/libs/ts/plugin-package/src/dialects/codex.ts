/**
 * The Codex compatibility manifest (`.codex-plugin/plugin.json`).
 *
 * New Codex packages are the open form: a root `plugin.json` with
 * OpenAI-specific presentation, app mappings and hooks under
 * `extensions["com.openai"]`, which the open reader records as an ignored
 * extension. The legacy `.codex-plugin/plugin.json` that Codex still
 * accepts is the Claude shape (`skills`, `mcpServers`, hooks) plus two
 * fields of its own: `apps` (registered ChatGPT app mappings, `.app.json`)
 * and `interface` (marketplace presentation). Nothing Codex-specific maps
 * to a Stigmer resource, so the reader is the Claude reader under the
 * `codex` dialect with the two extra fields known and `apps` ignored.
 */

import type { JsonObject } from "../documents.js";
import type { Findings } from "../messages.js";
import { CLAUDE_KNOWN_FIELDS, readClaudeShapedManifest } from "./claude.js";
import type { DialectManifest } from "./manifest.js";

const KNOWN_FIELDS: ReadonlySet<string> = new Set([...CLAUDE_KNOWN_FIELDS, "apps", "interface"]);

export function readCodexManifest(object: JsonObject, path: string, findings: Findings): DialectManifest {
  return readClaudeShapedManifest(object, path, "codex", KNOWN_FIELDS, findings);
}
