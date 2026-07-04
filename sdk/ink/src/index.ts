// Provider
export { InkStigmerProvider, type InkStigmerProviderProps } from "./provider.js";

// Transport (re-exported from @stigmer/sdk/node)
export {
  createNodeClient,
  createNodeTransport,
  type NodeClientConfig,
} from "@stigmer/sdk/node";

// Markdown
export { renderMarkdown } from "./markdown.js";

// Components
export { MessageEntry, type MessageEntryProps } from "./components/MessageEntry.js";
export { MessageThread, type MessageThreadProps } from "./components/MessageThread.js";
export { ToolCallItem, type ToolCallItemProps } from "./components/ToolCallItem.js";
export { ToolCallGroup, type ToolCallGroupProps } from "./components/ToolCallGroup.js";
export { SubAgentBlock, type SubAgentBlockProps } from "./components/SubAgentBlock.js";
export { TodoList, type TodoListProps } from "./components/TodoList.js";
export { ApprovalPrompt, type ApprovalPromptProps } from "./components/ApprovalPrompt.js";
export { FileReviewPrompt, type FileReviewPromptProps } from "./components/FileReviewPrompt.js";
export { FileReviewRecord, type FileReviewRecordProps } from "./components/FileReviewRecord.js";

// File-review pure helpers (kind letters, paths, block reasons, settled counts)
export {
  kindLetter,
  changeDisplayPath,
  blockReasonNote,
  settledCounts,
  settledSummary,
  type SettledCounts,
} from "./file-review.js";
export { ExecutionProgress, type ExecutionProgressProps } from "./components/ExecutionProgress.js";
export { FollowUpInput, type FollowUpInputProps } from "./components/FollowUpInput.js";
export { UsageWidget, type UsageWidgetProps } from "./components/UsageWidget.js";
export { ContextGauge, type ContextGaugeProps } from "./components/ContextGauge.js";

// Pickers (interactive search-and-select)
export { ResourcePicker, type ResourcePickerProps, type PickerItem } from "./components/ResourcePicker.js";
export { AgentPicker, type AgentPickerProps } from "./components/AgentPicker.js";
export { SessionPicker, type SessionPickerProps } from "./components/SessionPicker.js";

// Composed views
export { SessionView, type SessionViewProps, type InteractionMode } from "./app/SessionView.js";
export { SessionApp, type SessionAppProps } from "./app/SessionApp.js";
