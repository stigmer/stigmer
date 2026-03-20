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
  useExecutionArtifacts,
  useArtifactContent,
  isTextArtifact,
  isArtifactExpired,
  formatArtifactSize,
  getArtifactExtension,
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
  UseExecutionArtifactsReturn,
  UseArtifactContentReturn,
} from "./execution";

// Execution — proto type re-exports for artifact consumers
export type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
export { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// Composer — unified message input with model + workspace attachments
export {
  useComposer,
  SessionComposer,
} from "./composer";
export type {
  UseComposerOptions,
  UseComposerReturn,
  SessionComposerProps,
  SessionComposerSubmitContext,
} from "./composer";

// MCP Server — count hook, list hook, search hook, picker, config panel, tool selector, and setup orchestration
export {
  useMcpServerCount,
  useMcpServerList,
  useMcpServerSearch,
  useMcpServerSetup,
  McpServerPicker,
  McpServerConfigPanel,
  McpToolSelector,
  toServerKey,
} from "./mcp-server";
export type {
  UseMcpServerCountOptions,
  UseMcpServerCountReturn,
  UseMcpServerListOptions,
  UseMcpServerListReturn,
  UseMcpServerSearchOptions,
  UseMcpServerSearchReturn,
  UseMcpServerSetupReturn,
  SubmitMcpEnvVarsOptions,
  McpServerSetupEntry,
  McpServerSetupPhase,
  McpServerSetupState,
  McpServerPickerProps,
  McpServerSetupIntegration,
  McpServerConfigPanelProps,
  McpServerCredentialsProps,
  McpToolSelectorProps,
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
  GITHUB_CALLBACK_MESSAGE_TYPE,
} from "./github";
export type {
  GitHubUser,
  GitHubConnectOptions,
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

// Environment — data hooks, list hook, personal convenience hook, secret reveal, variable management, env var form, and styled components
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
  EnvVarForm,
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
  EnvVarFormProps,
  EnvVarFormVariable,
  EnvVarFormSubmitOptions,
} from "./environment";

// Organization — behavior hook and styled form for organization creation
export {
  useCreateOrganization,
  CreateOrganizationForm,
} from "./organization";
export type {
  UseCreateOrganizationReturn,
  CreateOrganizationFormProps,
} from "./organization";

// Error — structured error display with classification, retry, and contextual guidance
export { ErrorMessage, SecretFlowErrorGuide, isSecretFlowError } from "./error";
export type { ErrorMessageProps, SecretFlowErrorGuideProps } from "./error";

// Library — cross-resource UI components, resource detection, apply flow, and browsing
export {
  ScopeToggle,
  ResourceListView,
  ResourceCountCard,
  detectStigmerResource,
  useDetectStigmerResource,
  isSkillPackage,
  detectSkillPackage,
  useDetectSkillPackage,
  parseResourceYaml,
  useApplyResource,
} from "./library";
export type {
  ScopeToggleProps,
  ResourceListViewProps,
  ResourceCountCardProps,
  ResourceListScope,
  StigmerResourceKind,
  StigmerResourceDetection,
  SkillPackageDetection,
  UseDetectSkillPackageReturn,
  ParsedResource,
  UseApplyResourceReturn,
  ApplyResourceResult,
  PushSkillParams,
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
