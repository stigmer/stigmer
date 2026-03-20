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
  useOneTimeSecrets,
  OneTimeSecretsInput,
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
  OneTimeSecretEntry,
  UseOneTimeSecretsReturn,
  OneTimeSecretsInputProps,
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

// MCP Server — count hook, list hook, search hook, and picker component
export {
  useMcpServerCount,
  useMcpServerList,
  useMcpServerSearch,
  McpServerPicker,
} from "./mcp-server";
export type {
  UseMcpServerCountOptions,
  UseMcpServerCountReturn,
  UseMcpServerListOptions,
  UseMcpServerListReturn,
  UseMcpServerSearchOptions,
  UseMcpServerSearchReturn,
  McpServerPickerProps,
} from "./mcp-server";

// Skill — count hook, list hook, search hook, and picker component
export {
  useSkillCount,
  useSkillList,
  useSkillSearch,
  SkillPicker,
} from "./skill";
export type {
  UseSkillCountOptions,
  UseSkillCountReturn,
  UseSkillListOptions,
  UseSkillListReturn,
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

// Agent — count hook, list hook, search hook, picker, env form, setup orchestration, and env_spec diffing
export {
  useAgentCount,
  useAgentList,
  useAgentSearch,
  AgentPicker,
  AgentEnvForm,
  diffEnvSpec,
  useAgentSetup,
} from "./agent";
export type {
  UseAgentCountOptions,
  UseAgentCountReturn,
  UseAgentListOptions,
  UseAgentListReturn,
  UseAgentSearchOptions,
  UseAgentSearchReturn,
  AgentPickerProps,
  AgentEnvFormProps,
  AgentEnvFormSubmitOptions,
  AgentEnvFormVariable,
  AgentSetupResult,
  AgentSetupReadyResult,
  AgentSetupState,
  AgentSetupPhase,
  AgentResolution,
  SubmitEnvVarsOptions,
  UseAgentSetupReturn,
} from "./agent";

// Environment — data hooks, list hook, personal convenience hook, secret reveal, variable management, and styled components
export {
  useEnvironment,
  useEnvironmentList,
  usePersonalEnvironment,
  useCreateEnvironment,
  useUpdateEnvironment,
  useUpdateEnvironmentVariables,
  useRemoveEnvironmentVariables,
  useRevealSecretValue,
  EnvironmentVariableEditor,
  EnvironmentListPanel,
  CreateEnvironmentForm,
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
  EnvironmentVariableEditorProps,
  EnvironmentListPanelProps,
  CreateEnvironmentFormProps,
} from "./environment";

// Error — structured error display with classification, retry, and contextual guidance
export { ErrorMessage, SecretFlowErrorGuide, isSecretFlowError } from "./error";
export type { ErrorMessageProps, SecretFlowErrorGuideProps } from "./error";

// Library — cross-resource UI components for browsing and managing resources
export { ScopeToggle, ResourceListView, ResourceCountCard } from "./library";
export type {
  ScopeToggleProps,
  ResourceListViewProps,
  ResourceCountCardProps,
  ResourceListScope,
} from "./library";

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
