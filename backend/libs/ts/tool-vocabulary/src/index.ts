// The package entry: re-exports the tool vocabulary (vocabulary.ts), the
// MCP server names (mcp-servers.ts) and the secret argument names
// (secret-args.ts) that the runner, the control plane and the browser kits
// read, so none reaches into a file path. Nothing else
// lives here; the tables and their trade-offs are documented and pinned
// beside them. The custom-tool check is its own entry,
// `@stigmer/tool-vocabulary/custom-tools`: it runs a JSON Schema validator
// under `node:vm`, which neither a browser bundle can hold nor a kit needs.

export {
  CLAUDE_TOOLS,
  CLAUDE_TOOL_ALIASES,
  CLAUDE_TOOL_COVERS,
  STIGMER_TOOL_COVERS,
  READ_ONLY_EVAL_TOOLS,
  SHELL_TOOL,
  builtinToolOf,
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
export { SECRET_ARG_KEYS, isSecretArgKey } from "./secret-args.js";
