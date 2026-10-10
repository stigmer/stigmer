/**
 * An eval's `allow_tools` in Stigmer's names. Claude Code names a plugin's
 * MCP tools `mcp__plugin_<plugin>_<server>__<tool>`; Stigmer names the same
 * server by the slug install gave it (`mcp__<server-slug>__<tool>`,
 * domain/plugin/materialize/mcp-servers.ts), so a suite's CI line written
 * for `claude plugin eval --allow-tools` works unchanged here. Create
 * rewrites each such entry once, so the stored spec and every try's tool
 * list hold Stigmer names only.
 *
 * The plugin part must be the eval's own plugin (its name or its slug): a
 * try attaches no other plugin, so an entry naming another one could never
 * grant anything and is refused rather than silently kept.
 *
 * Proven by __tests__/allow-tools.test.ts.
 */
import { generateSlug } from "../../pipeline/steps/slug.js";

const CLAUDE_PLUGIN_MCP = /^mcp__plugin_([A-Za-z0-9.-]+)_([A-Za-z0-9_.-]+?)(__(?:\*|[A-Za-z0-9_.-]+))?$/;

/** The rewrite's outcome: Stigmer names, or the entry that names another plugin. */
export type AllowToolsOutcome =
  | { readonly ok: true; readonly tools: readonly string[] }
  | { readonly ok: false; readonly entry: string; readonly plugin: string };

/** Rewrites Claude Code's plugin MCP names of `plugin` (its name and slug) to Stigmer's. */
export function stigmerAllowTools(
  tools: readonly string[],
  plugin: { readonly name: string; readonly slug: string },
): AllowToolsOutcome {
  const own = new Set([plugin.name, plugin.slug].filter((n) => n !== ""));
  const out: string[] = [];
  for (const entry of tools) {
    const match = CLAUDE_PLUGIN_MCP.exec(entry);
    if (match === null) {
      out.push(entry);
      continue;
    }
    const [, named = "", server = "", rest = ""] = match;
    if (!own.has(named)) {
      return { ok: false, entry, plugin: named };
    }
    out.push(`mcp__${generateSlug(server)}${rest}`);
  }
  return { ok: true, tools: out };
}
