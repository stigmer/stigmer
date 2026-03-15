// ---------------------------------------------------------------------------
// Services (Layer 1 — pure TS, no React)
// ---------------------------------------------------------------------------

export { createMcpServerQueryService } from "./services/mcp-server-query-service";
export type {
  McpServerQueryService,
  SearchMcpServersOptions,
} from "./services/mcp-server-query-service";

// ---------------------------------------------------------------------------
// Hooks (Layer 2 — binds transport from context)
// ---------------------------------------------------------------------------

export { useMcpServerQueryService } from "./services/useMcpServerQueryService";
