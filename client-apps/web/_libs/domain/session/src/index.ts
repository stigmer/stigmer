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
export { useAgentSessionList } from "./hooks/useAgentSessionList";
export type {
  UseAgentSessionListOptions,
  UseAgentSessionListReturn,
} from "./hooks/useAgentSessionList";

// ---------------------------------------------------------------------------
// Components (embeddable UI)
// ---------------------------------------------------------------------------

export { SessionCard } from "./components/SessionCard";
export type { SessionCardProps } from "./components/SessionCard";

export { AgentSessionHistory } from "./components/AgentSessionHistory";
export type { AgentSessionHistoryProps } from "./components/AgentSessionHistory";
