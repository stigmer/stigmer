// The rule an eval's `allow_tools` entry follows, the API's own
// (plugineval/v1/spec.proto and agenteval/v1/spec.proto carry the same
// pattern): a Claude Code tool with an optional specifier, as `Write` or
// `Bash(npm test *)`, or MCP tools as `mcp__plugin_<plugin>_<server>__<tool>`
// (Claude Code's form) or `mcp__<server>__<tool>` (Stigmer's), `*` for every
// tool of a server, or `mcp__*`. One copy, so the CLI and the console refuse
// what the server would, before a request is sent. Pinned by
// `__tests__/allow-tools.test.ts`.

/** An entry an eval's `allow_tools` accepts. */
export const ALLOW_TOOL_PATTERN =
  /^(mcp__\*|mcp__plugin_[A-Za-z0-9.-]+_[A-Za-z0-9_.-]+?(__(\*|[A-Za-z0-9_.-]+))?|mcp__[a-z][a-z0-9-]*[a-z0-9](__(\*|[A-Za-z0-9_.-]+))?|[A-Z][A-Za-z0-9_]*(\([^()\r\n]+\))?)$/;
