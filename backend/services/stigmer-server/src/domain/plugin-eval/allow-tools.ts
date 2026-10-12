/**
 * An eval's `allow_tools`, checked against the plugin it runs. A turn names
 * a plugin's MCP tools as Claude Code does,
 * `mcp__plugin_<plugin>_<server>__<tool>` (`toolServerSegment`), so a
 * suite's CI line written for `claude plugin eval --allow-tools` works
 * unchanged here and is stored as written.
 *
 * An entry naming a plugin server must name a server of a plugin the try
 * attaches (the plugin eval's own; each plugin an agent eval's agent
 * attaches): an entry naming another one could never grant anything and is
 * refused rather than silently kept. The
 * segment is compared whole, never split back into a plugin and a server,
 * since either name may hold `_`.
 *
 * Proven by __tests__/allow-tools.test.ts.
 */
import { toolServerSegment } from "@stigmer/plugin-package";

const PLUGIN_MCP_PREFIX = "mcp__plugin_";

/** The check's outcome: the entries as written, or the first that names a server of another plugin. */
export type AllowToolsOutcome =
  | { readonly ok: true; readonly tools: readonly string[] }
  | { readonly ok: false; readonly entry: string; readonly server: string };

/** The server part of a plugin MCP entry: everything between `mcp__` and the next `__`. */
function serverPartOf(entry: string): string {
  const rest = entry.slice("mcp__".length);
  const end = rest.indexOf("__");
  return end === -1 ? rest : rest.slice(0, end);
}

/** Checks that every plugin MCP entry names a server of one of `plugins`. */
export function checkAllowTools(
  tools: readonly string[],
  plugins: ReadonlyArray<{ readonly name: string; readonly servers: readonly string[] }>,
): AllowToolsOutcome {
  const own = new Set(
    plugins.flatMap((plugin) => plugin.servers.map((server) => toolServerSegment(plugin.name, server))),
  );
  for (const entry of tools) {
    if (!entry.startsWith(PLUGIN_MCP_PREFIX)) {
      continue;
    }
    const server = serverPartOf(entry);
    if (!own.has(server)) {
      return { ok: false, entry, server };
    }
  }
  return { ok: true, tools: [...tools] };
}
