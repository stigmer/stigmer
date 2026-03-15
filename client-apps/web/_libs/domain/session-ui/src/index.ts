// ---------------------------------------------------------------------------
// Services (Layer 1 — pure TS, no React)
// ---------------------------------------------------------------------------

export { createSessionQueryService } from "./services/session-query-service";
export type {
  SessionQueryService,
  ListSessionsOptions,
  ListSessionsByAgentOptions,
} from "./services/session-query-service";

// ---------------------------------------------------------------------------
// Hooks (Layer 2 — binds transport from context)
// ---------------------------------------------------------------------------

export { useSessionQueryService } from "./services/useSessionQueryService";
