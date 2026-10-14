/**
 * An eval's `allow_tools`, checked against the plugin it runs. A turn names
 * a plugin's MCP tools as Claude Code does,
 * `mcp__plugin_<plugin>_<server>__<tool>` (`toolServerSegment`), so a
 * suite's CI line written for `claude plugin eval --allow-tools` works
 * unchanged here and is stored as written; it names a server an agent
 * writes itself by that server's own name, `mcp__<server>__<tool>`.
 *
 * An entry naming a plugin server must name a server of a plugin the try
 * attaches (the plugin eval's own; each plugin an agent eval's agent
 * attaches), and in an agent eval an entry naming any other server must
 * name one the agent writes itself: an entry naming another one could
 * never grant anything and is refused rather than silently kept. A plugin
 * eval runs no agent's servers, so it leaves such entries as they are. The
 * segment is compared whole, never split back into a plugin and a server,
 * since either name may hold `_`.
 *
 * Proven by __tests__/allow-tools.test.ts.
 */
import { toolServerSegment } from "@stigmer/plugin-package";

const MCP_PREFIX = "mcp__";
const PLUGIN_MCP_PREFIX = "mcp__plugin_";

/** The check's outcome: the entries as written, or the first that names a server of another plugin. */
export type AllowToolsOutcome =
  | { readonly ok: true; readonly tools: readonly string[] }
  | { readonly ok: false; readonly entry: string; readonly server: string };

/** The server part of a plugin MCP entry: everything between `mcp__` and the next `__`. */
function serverPartOf(entry: string): string {
  const rest = entry.slice(MCP_PREFIX.length);
  const end = rest.indexOf("__");
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Checks that every plugin MCP entry names a server of one of `plugins`,
 * and, when `agentServers` is given (an agent eval), that every other MCP
 * entry names one of them.
 */
export function checkAllowTools(
  tools: readonly string[],
  plugins: ReadonlyArray<{ readonly name: string; readonly servers: readonly string[] }>,
  agentServers?: readonly string[],
): AllowToolsOutcome {
  const own = new Set(
    plugins.flatMap((plugin) => plugin.servers.map((server) => toolServerSegment(plugin.name, server))),
  );
  const written = new Set(agentServers ?? []);
  for (const entry of tools) {
    if (entry.startsWith(PLUGIN_MCP_PREFIX)) {
      const server = serverPartOf(entry);
      if (!own.has(server)) {
        return { ok: false, entry, server };
      }
      continue;
    }
    if (agentServers === undefined || !entry.startsWith(MCP_PREFIX)) {
      continue;
    }
    const server = serverPartOf(entry);
    if (server !== "*" && !written.has(server)) {
      return { ok: false, entry, server };
    }
  }
  return { ok: true, tools: [...tools] };
}
