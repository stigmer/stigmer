// MCP server names the runner and the control plane must agree on, owned
// here because neither reads the other and no other library owns them: the
// names of the platform's own servers, the grammar of a server name an
// agent writes, and the name of the variable a server's login is read from.
//
// The platform's servers are attached by the runner to every turn that
// needs them, under these names; an agent's own server may never take one,
// nor any name starting "stigmer", so a later platform server cannot
// collide with a saved agent. Nor may it be named "plugin": its tools would
// read `mcp__plugin__<tool>`, which every reader of a plugin's tools
// (`mcp__plugin_<plugin>_<server>`) would take for a plugin's. The name
// grammar is the tool-list grammar's server segment (agent spec `tools`),
// so `mcp__<name>__<tool>` stays parseable. The login variable is how install names the token of a plugin
// server it found asks for a sign-in, and how a run names the login of an
// agent's own server; one function, so both read the same key.
//
// Proven by __tests__/mcp-servers.test.ts.

/** The runner's channel tools. */
export const CHANNELS_MCP_SERVER = "stigmer-channels";

/** The runner's conversation participation tools. */
export const CONVERSATION_MCP_SERVER = "stigmer-conversation";

/** The runner's memory tools. */
export const MEMORY_MCP_SERVER = "stigmer-memory";

/** Every MCP server name the platform attaches to a turn itself. */
export const PLATFORM_MCP_SERVERS: ReadonlySet<string> = new Set([
  CHANNELS_MCP_SERVER,
  CONVERSATION_MCP_SERVER,
  MEMORY_MCP_SERVER,
]);

/** The name an agent gives a server it writes itself: the tool lists' server segment. */
export const MCP_SERVER_NAME_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/** The prefix every platform server name carries, reserved for the platform. */
const PLATFORM_PREFIX = "stigmer";

/** The name Claude Code begins every plugin server's tool name with (`mcp__plugin_…`). */
const PLUGIN_PREFIX = "plugin";

/** Whether `name` is kept from an agent: one of the platform's servers, any name starting "stigmer", or "plugin". */
export function isReservedMcpServerName(name: string): boolean {
  return PLATFORM_MCP_SERVERS.has(name) || name.startsWith(PLATFORM_PREFIX) || name === PLUGIN_PREFIX;
}

/** The suffix of the variable a server's login is read from. */
export const ACCESS_TOKEN_VAR_SUFFIX = "_ACCESS_TOKEN";

/** `<SERVER>_ACCESS_TOKEN`, the server's name upper-cased with every non-alphanumeric run as one underscore. */
export function accessTokenVariable(serverName: string): string {
  const folded = serverName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  // Trimmed by index rather than by an anchored regex, which backtracks on
  // a long run of underscores.
  let start = 0;
  let end = folded.length;
  while (start < end && folded[start] === "_") start++;
  while (end > start && folded[end - 1] === "_") end--;
  const stem = folded.slice(start, end);
  return `${stem === "" ? "MCP" : stem}${ACCESS_TOKEN_VAR_SUFFIX}`;
}
