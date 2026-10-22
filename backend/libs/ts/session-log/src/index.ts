// The package entry: a session's event log as every client reads it. The
// fold (fold.ts) turns events into turns, threads, tool uses and asks; the
// catalog (catalog.ts) names each event's Managed Agents type from the
// contract; the renderer (render.ts) writes an event as Managed Agents
// JSON; the to-do rule (todos.ts) is the one the runner applies too.

export {
  SESSION_EVENT_TYPES,
  STIGMER_EVENT_TYPE_PREFIX,
  eventCaseOf,
  eventIdOf,
  eventTypeOf,
  isStigmerEventType,
  processedAtOf,
  type SessionEventCase,
} from "./catalog.js";
export { SessionLog, foldSession, previewPlaceOf, textOf, turnOf } from "./fold.js";
export { toManagedAgentsJson, toManagedAgentsStreamJson } from "./render.js";
export { applyTodoUpdate, isTodoTool } from "./todos.js";
export {
  TURN_ENDED_PHASES,
  type CompactedItem,
  type FileReviewDecision,
  type FileReviewFile,
  type FileReviewReconcile,
  type FileReviewSet,
  type MemoryRecall,
  type MessageItem,
  type NoteItem,
  type PermissionGrant,
  type QueuedMessage,
  type SessionFold,
  type SessionStatusView,
  type ThinkingItem,
  type Thread,
  type Todo,
  type ToolAsk,
  type ToolConfirmation,
  type ToolFullOutput,
  type ToolResult,
  type ToolUse,
  type ToolUseState,
  type Turn,
  type TurnError,
  type TurnItem,
  type TurnLiveness,
  type TurnOpenOperation,
  type TurnPhase,
  type TurnStatus,
  type UserMessage,
  type UserMessageItem,
} from "./types.js";
