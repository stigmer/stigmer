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
export { useAgentSearch } from "./hooks/useAgentSearch";
export type {
  UseAgentSearchOptions,
  UseAgentSearchReturn,
  AgentSearchResult,
} from "./hooks/useAgentSearch";

// ---------------------------------------------------------------------------
// Components (embeddable UI)
// ---------------------------------------------------------------------------

export { AgentCard } from "./components/AgentCard";
export type { AgentCardProps } from "./components/AgentCard";

export { AgentOverview } from "./components/AgentOverview";
export type { AgentOverviewProps } from "./components/AgentOverview";

export { AgentPicker } from "./components/AgentPicker";
export type {
  AgentPickerProps,
  SelectedAgent,
} from "./components/AgentPicker";
