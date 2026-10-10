/**
 * The name a plugin's MCP server gives its tools, as Claude Code builds it:
 * `mcp__plugin_<plugin>_<server>__<tool>`, with every character outside
 * `A-Za-z0-9_-` in either name written as `_`. The server segment is built
 * from the two names, never parsed back, because either name may hold `_`.
 * The installer refuses a plugin whose segment would hold `__` or end in
 * `_`, and the runner names each plugin server by this segment, so an
 * agent's tool list written for Claude Code scopes the same tools here.
 */

function claudeNamePart(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** `plugin_<plugin>_<server>`: the server part of a plugin tool's name. */
export function toolServerSegment(pluginName: string, serverName: string): string {
  return `plugin_${claudeNamePart(pluginName)}_${claudeNamePart(serverName)}`;
}
