// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export { ExecutionStream } from "./components/ExecutionStream";
export { ExecutionStatus } from "./components/ExecutionStatus";
export { OutputBlock } from "./components/OutputBlock";
export { ToolCallCard } from "./components/ToolCallCard";
export { ApprovalControls } from "./components/ApprovalControls";
export { SubAgentCard } from "./components/SubAgentCard";
export { MessageInput } from "./components/MessageInput";
export {
  MessageEntry,
  HumanMessageBubble,
  SystemMessageBlock,
} from "./components/MessageEntry";

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export { useAgentExecution } from "./hooks/useAgentExecution";
export type {
  UseAgentExecutionOptions,
  UseAgentExecutionReturn,
} from "./hooks/useAgentExecution";

export { useApproval } from "./hooks/useApproval";
export type {
  UseApprovalOptions,
  UseApprovalReturn,
} from "./hooks/useApproval";

export { useExecutionService } from "./hooks/useExecutionService";

// ---------------------------------------------------------------------------
// Services (for non-React usage or custom wiring)
// ---------------------------------------------------------------------------

export { createExecutionService } from "./services/execution-service";
export type {
  ExecutionService,
  CreateExecutionInput,
  ListExecutionsBySessionOptions,
} from "./services/execution-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export {
  isTerminalPhase,
  phaseLabel,
  phaseVariant,
  toolCallStatusLabel,
  toolCallStatusVariant,
  isToolCallTerminal,
  subAgentStatusLabel,
  subAgentStatusVariant,
  isHumanMessage,
  isAiMessage,
  isToolMessage,
  isSystemMessage,
  buildSubAgentIndex,
  qualifiedToolName,
  formatDuration,
} from "./helpers";
