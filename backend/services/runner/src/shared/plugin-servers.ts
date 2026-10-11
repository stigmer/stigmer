/**
 * How a turn names a plugin's MCP server: `plugin_<plugin>_<server>`, the
 * segment Claude Code builds (`mcp__plugin_<plugin>_<server>__<tool>`),
 * with every character outside `A-Za-z0-9_-` in either name written as `_`.
 * The segment is built from the two names and compared whole, never split
 * back, because either name may hold `_`; the server refuses at install a
 * plugin whose segment would hold `__` or end in `_`, so the tool-list
 * reader's first-`__` split after `mcp__` still finds the server.
 *
 * The plugin library builds the same segment for the installer
 * (`backend/libs/ts/plugin-package/src/tool-names.ts`); the runner keeps
 * its own copy rather than depending on the library, and
 * __tests__/plugin-servers.test.ts holds the two equal.
 */

function claudeNamePart(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** `plugin_<plugin>_<server>`: the server part of a plugin tool's name. */
export function toolServerSegment(pluginName: string, serverName: string): string {
  return `plugin_${claudeNamePart(pluginName)}_${claudeNamePart(serverName)}`;
}
