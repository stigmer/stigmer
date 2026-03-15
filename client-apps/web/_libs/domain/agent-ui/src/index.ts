// ---------------------------------------------------------------------------
// Services (Layer 1 — pure TS, no React)
// ---------------------------------------------------------------------------

export { createAgentQueryService } from "./services/agent-query-service";
export type {
  AgentQueryService,
  SearchAgentsOptions,
} from "./services/agent-query-service";

// ---------------------------------------------------------------------------
// Hooks (Layer 2 — binds transport from context)
// ---------------------------------------------------------------------------

export { useAgentQueryService } from "./services/useAgentQueryService";
