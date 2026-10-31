// Provider
export { InkStigmerProvider, type InkStigmerProviderProps } from "./provider.js";

// Transport (re-exported from @stigmer/client/node)
export {
  createNodeClient,
  createNodeTransport,
  ExitCode,
  exitCodeOf,
  type NodeClientConfig,
} from "@stigmer/client/node";

// Run a turn in the terminal and get control back
export {
  runInTerminal,
  TerminalRunError,
  type RunInTerminalOptions,
  type TerminalOutcome,
} from "./run/run-in-terminal.js";
export { terminalMode, type TerminalMode, type TerminalStreams } from "./terminal-mode.js";
export { describeConnectionFailure, type ConnectionFailure, type FailedStep } from "./errors.js";

// Theme: colours by role
export {
  DEFAULT_INK_THEME,
  resolveInkTheme,
  roleStyle,
  useInkTheme,
  useRoles,
  useTerminalBackground,
  type InkRole,
  type InkTheme,
  type InkThemeInput,
  type RoleStyle,
} from "./theme.js";
export {
  detectBackground,
  type DetectBackgroundOptions,
  type TerminalBackground,
} from "./terminal-background.js";

// Markdown: drawn as Ink elements, or to a string for output outside Ink
export { Markdown, MarkdownBlock, renderMarkdown, type MarkdownProps, type MarkdownBlockProps } from "./components/Markdown.js";
export { markdownBlocks } from "./markdown.js";

// Components
export { MessageEntry, type MessageEntryProps } from "./components/MessageEntry.js";
export { MessageThread, type MessageThreadProps } from "./components/MessageThread.js";
export { ToolCallItem, type ToolCallItemProps } from "./components/ToolCallItem.js";
export { ToolCallGroup, type ToolCallGroupProps } from "./components/ToolCallGroup.js";
export { SubagentBlock, type SubagentBlockProps } from "./components/SubagentBlock.js";
export { TodoList, type TodoListProps } from "./components/TodoList.js";
export { ApprovalPrompt, type ApprovalPromptProps } from "./components/ApprovalPrompt.js";
export { FileReviewPrompt, type FileReviewPromptProps } from "./components/FileReviewPrompt.js";
export { FileReviewRecord, type FileReviewRecordProps } from "./components/FileReviewRecord.js";
export { FileDiffBody, type FileDiffBodyProps } from "./components/FileDiffBody.js";
export {
  FileChangeProgressBar,
  type FileChangeProgressBarProps,
} from "./components/FileChangeProgressBar.js";
export { FileLineStats } from "./components/FileReviewAtoms.js";

// File-review pure helpers (kind letters, paths, block reasons, settled counts)
export {
  kindLetter,
  fileDisplayPath,
  progressEntryDisplayPath,
  blockReasonNote,
  changeSetLineStats,
  settledCounts,
  settledSummary,
  type LineStats,
  type SettledCounts,
} from "./file-review.js";
export { RunProgress, type RunProgressProps } from "./components/RunProgress.js";
export { WorkingLine, type WorkingLineProps } from "./components/WorkingLine.js";
export { Spinner, type SpinnerProps } from "./components/Spinner.js";
export { FollowUpInput, type FollowUpInputProps } from "./components/FollowUpInput.js";
export { UsageWidget, type UsageWidgetProps } from "./components/UsageWidget.js";

// Pickers (interactive search-and-select)
export { ResourcePicker, type ResourcePickerProps, type PickerItem } from "./components/ResourcePicker.js";
export { AgentPicker, type AgentPickerProps } from "./components/AgentPicker.js";
export { SessionPicker, type SessionPickerProps } from "./components/SessionPicker.js";

// Composed views
export { SessionView, type SessionViewProps, type InteractionMode } from "./app/SessionView.js";
export { SessionApp, type SessionAppProps } from "./app/SessionApp.js";
