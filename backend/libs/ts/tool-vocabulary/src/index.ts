// The package entry: re-exports the tool vocabulary (vocabulary.ts) and the
// MCP server names (mcp-servers.ts) that the runner and the control plane
// both read, so neither reaches into a file path. Nothing else lives here;
// the tables and their trade-offs are documented and pinned beside them.

export {
  CLAUDE_TOOLS,
  CLAUDE_TOOL_ALIASES,
  CLAUDE_TOOL_COVERS,
  CURSOR_HOOK_TOOL_COVERS,
  CURSOR_SDK_EXTRA_TOOLS,
  CURSOR_SDK_TOOL_COVERS,
  NATIVE_TOOL_COVERS,
  READ_ONLY_EVAL_TOOLS,
  claudeNameOf,
  isClaudeTool,
  type ClaudeTool,
  type ToolEngine,
} from "./vocabulary.js";
export {
  ACCESS_TOKEN_VAR_SUFFIX,
  CHANNELS_MCP_SERVER,
  CONVERSATION_MCP_SERVER,
  MCP_SERVER_NAME_PATTERN,
  MEMORY_MCP_SERVER,
  PLATFORM_MCP_SERVERS,
  accessTokenVariable,
  isReservedMcpServerName,
} from "./mcp-servers.js";
