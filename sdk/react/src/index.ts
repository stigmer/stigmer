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
  SendFollowUpOptions,
  UseSessionConversationReturn,
  SessionGroup,
} from "./session";

// Execution — behavior hooks, styled components, and utilities (AgentExecution aggregate)
export {
  isTerminalPhase,
  useCreateAgentExecution,
  useExecutionStream,
  useExecutionUsage,
  aggregateUsage,
  useSubmitApproval,
  ExecutionPhaseBadge,
  ExecutionProgress,
  ExecutionCostSummary,
  ToolCallGroup,
  ToolCallDetail,
  formatDuration,
  ToolCallItem,
  SubAgentSection,
  MessageEntry,
  MessageThread,
  FollowUpInput,
  ApprovalCard,
  FilePathLink,
  FilePathContext,
  classifyPath,
  resolveGitBrowseUrl,
  resolvePathAction,
} from "./execution";
export type {
  CreateAgentExecutionInput,
  CreateAgentExecutionResult,
  UseCreateAgentExecutionReturn,
  UseExecutionStreamReturn,
  UseExecutionUsageReturn,
  UseSubmitApprovalReturn,
  ExecutionPhaseBadgeProps,
  ExecutionProgressProps,
  ExecutionCostSummaryProps,
  ToolCallGroupProps,
  ToolCallDetailProps,
  ToolCallItemProps,
  SubAgentSectionProps,
  MessageEntryProps,
  MessageThreadProps,
  FollowUpInputProps,
  ApprovalCardProps,
  FilePathLinkProps,
  FilePathContextValue,
  PathClassification,
  ResolvedPathAction,
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

// MCP Server — search hook and picker component
export {
  useMcpServerSearch,
  McpServerPicker,
} from "./mcp-server";
export type {
  UseMcpServerSearchOptions,
  UseMcpServerSearchReturn,
  McpServerPickerProps,
} from "./mcp-server";

// Skill — search hook and picker component
export {
  useSkillSearch,
  SkillPicker,
} from "./skill";
export type {
  UseSkillSearchOptions,
  UseSkillSearchReturn,
  SkillPickerProps,
} from "./skill";

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

// Agent — search hook and picker component
export {
  useAgentSearch,
  AgentPicker,
} from "./agent";
export type {
  UseAgentSearchOptions,
  UseAgentSearchReturn,
  AgentPickerProps,
} from "./agent";

// Environment — data hooks, list hook, personal convenience hook, secret reveal, and variable management
export {
  useEnvironment,
  useEnvironmentList,
  usePersonalEnvironment,
  useCreateEnvironment,
  useUpdateEnvironment,
  useUpdateEnvironmentVariables,
  useRemoveEnvironmentVariables,
  useRevealSecretValue,
} from "./environment";
export type {
  UseEnvironmentReturn,
  UseEnvironmentListReturn,
  UsePersonalEnvironmentReturn,
  UseCreateEnvironmentReturn,
  UseUpdateEnvironmentReturn,
  UpdateEnvironmentVariablesInput,
  UseUpdateEnvironmentVariablesReturn,
  RemoveEnvironmentVariablesInput,
  UseRemoveEnvironmentVariablesReturn,
  UseRevealSecretValueOptions,
  UseRevealSecretValueReturn,
} from "./environment";

// Agent Instance — data hooks, list hook, personal convenience hook, and behavior hook
export {
  useAgentInstance,
  useAgentInstanceList,
  usePersonalAgentInstance,
  useCreateAgentInstance,
} from "./agent-instance";
export type {
  UseAgentInstanceReturn,
  UseAgentInstanceListReturn,
  GetOrCreatePersonalInstanceInput,
  UsePersonalAgentInstanceReturn,
  UseCreateAgentInstanceReturn,
} from "./agent-instance";
