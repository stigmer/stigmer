// Provider and context
export { StigmerProvider, type StigmerProviderProps } from "./provider";
export { StigmerContext } from "./context";

// Hooks
export { useStigmer } from "./hooks";

// Models — data hook, styled component, and registry data
export {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  useModelRegistry,
  ModelSelector,
} from "./models";
export type {
  ModelInfo,
  Provider,
  CostTier,
  UseModelRegistryReturn,
  ModelSelectorProps,
} from "./models";

// Workspace — behavior hooks, data hook, and styled components
export {
  useWorkspaceEntries,
  WorkspaceEditor,
  useFolderListing,
  FolderBrowser,
  WorkspaceSummary,
} from "./workspace";
export type {
  WorkspaceEntry,
  UseWorkspaceEntriesReturn,
  WorkspaceEditorProps,
  FolderEntry,
  FolderListing,
  UseFolderListingReturn,
  FolderBrowserProps,
  WorkspaceSummaryProps,
} from "./workspace";

// Session — data hooks, behavior hooks, utilities (Session aggregate + conversation lifecycle)
export {
  useCreateSession,
  useUpdateSession,
  useSession,
  useSessionList,
  useSessionExecutions,
  useSessionConversation,
  groupSessionsByTime,
} from "./session";
export type {
  CreateSessionInput,
  CreateSessionResult,
  UseCreateSessionReturn,
  UseUpdateSessionReturn,
  UseSessionReturn,
  UseSessionListOptions,
  UseSessionListReturn,
  UseSessionExecutionsReturn,
  UseSessionConversationReturn,
  SessionGroup,
} from "./session";

// Execution — behavior hooks, styled components, and utilities (AgentExecution aggregate)
export {
  isTerminalPhase,
  useCreateAgentExecution,
  useExecutionStream,
  useSubmitApproval,
  ExecutionPhaseBadge,
  ToolCallGroup,
  ToolCallDetail,
  formatDuration,
  ToolCallItem,
  SubAgentSection,
  MessageEntry,
  MessageThread,
  FollowUpInput,
  ExecutionDetails,
  ExecutionSummary,
  ContextWindowMeter,
  ApprovalCard,
} from "./execution";
export type {
  CreateAgentExecutionInput,
  CreateAgentExecutionResult,
  UseCreateAgentExecutionReturn,
  UseExecutionStreamReturn,
  UseSubmitApprovalReturn,
  ExecutionPhaseBadgeProps,
  ToolCallGroupProps,
  ToolCallDetailProps,
  ToolCallItemProps,
  SubAgentSectionProps,
  MessageEntryProps,
  MessageThreadProps,
  FollowUpInputProps,
  ExecutionDetailsProps,
  ExecutionSummaryProps,
  ContextWindowMeterProps,
  ApprovalCardProps,
} from "./execution";

// Composer — unified message input with model + workspace attachments
export {
  useComposer,
  SessionComposer,
} from "./composer";
export type {
  UseComposerOptions,
  UseComposerReturn,
  SessionComposerProps,
} from "./composer";

// GitHub — OAuth connection, repo picker, and hooks
export {
  useGitHubConnection,
  useGitHubRepos,
  GitHubRepoPicker,
} from "./github";
export type {
  GitHubUser,
  UseGitHubConnectionReturn,
  GitHubRepo,
  GitHubBranch,
  UseGitHubReposReturn,
  GitHubRepoPickerProps,
} from "./github";
