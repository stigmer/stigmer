// Provider and context
export { StigmerProvider, type StigmerProviderProps } from "./provider";
export { StigmerContext } from "./context";

// Hooks
export { useStigmer } from "./hooks";

// Deployment mode and resource availability
export { useDeploymentMode, useResourceAvailable } from "./deployment-mode";
export { type DeploymentMode, isResourceAvailable, ApiResourceKind } from "@stigmer/sdk";
export { CloudFeatureNotice, type CloudFeatureNoticeProps } from "./internal/CloudFeatureNotice";

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
  useSessionArtifacts,
  useSessionWriteBacks,
  useSessionUsage,
  useAgentRefFromSession,
  groupSessionsByTime,
  PENDING_SUBJECT,
  resolvedSubject,
} from "./session";
export type {
  SharedSessionFields,
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
  SessionArtifactEntry,
  UseSessionArtifactsReturn,
  SessionWriteBackEntry,
  UseSessionWriteBacksReturn,
  ModelCostEntry,
  UseSessionUsageReturn,
  UseAgentRefFromSessionReturn,
  SessionGroup,
} from "./session";

// Execution — behavior hooks, styled components, and utilities (AgentExecution aggregate)
export {
  isTerminalPhase,
  useCreateAgentExecution,
  useExecutionStream,
  useSubmitApproval,
  ExecutionPhaseBadge,
  SetupProgress,
  ExecutionProgress,
  TodoList,
  TodoInProgressIcon,
  findActiveTodo,
  todoCompletionSummary,
  UsageWidget,
  formatCost,
  formatTokenCount,
  ToolCallGroup,
  ToolCallDetail,
  McpToolDetail,
  parseMcpResult,
  formatDuration,
  humanizeToolName,
  ToolCallItem,
  SubAgentSection,
  MessageEntry,
  MessageThread,
  FollowUpInput,
  ApprovalCard,
  ArtifactCard,
  ArtifactContentRenderer,
  ArtifactPreviewModal,
  ArtifactsWidget,
  WriteBacksWidget,
  ToolArgsView,
  McpArgsView,
  McpMetadataRow,
  FilePathLink,
  FilePathContext,
  classifyPath,
  resolveGitBrowseUrl,
  resolvePathAction,
  useSessionVariables,
  SessionVariablesInput,
  useExecutionArtifacts,
  useArtifactContent,
  useWorkspaceWriteBacks,
  WriteBackCard,
  isTextArtifact,
  isArtifactExpired,
  formatArtifactSize,
  getArtifactExtension,
  getFileExtension,
  getArtifactRenderMode,
} from "./execution";
export type {
  CreateAgentExecutionInput,
  CreateAgentExecutionResult,
  UseCreateAgentExecutionReturn,
  UseExecutionStreamReturn,
  UseSubmitApprovalReturn,
  ExecutionPhaseBadgeProps,
  SetupProgressProps,
  ExecutionProgressProps,
  TodoListProps,
  UsageWidgetProps,
  ToolCallGroupProps,
  ToolCallDetailProps,
  McpToolDetailProps,
  McpArgsViewProps,
  McpMetadataRowProps,
  ToolArgsViewProps,
  ToolCallItemProps,
  SubAgentSectionProps,
  MessageEntryProps,
  MessageThreadProps,
  FollowUpInputProps,
  ApprovalCardProps,
  ArtifactCardProps,
  ArtifactContentRendererProps,
  ArtifactRenderMode,
  ArtifactPreviewModalProps,
  ArtifactsWidgetProps,
  WriteBacksWidgetProps,
  FilePathLinkProps,
  FilePathContextValue,
  PathClassification,
  ResolvedPathAction,
  SessionVariableEntry,
  UseSessionVariablesReturn,
  SessionVariablesInputProps,
  UseExecutionArtifactsReturn,
  UseArtifactContentReturn,
  UseWorkspaceWriteBacksReturn,
  WriteBackCardProps,
} from "./execution";

// Execution — proto type re-exports for artifact consumers
export type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
export { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// Attachment — file upload behavior hook and styled chip list
export {
  useAttachments,
  AttachmentChipList,
  MAX_ATTACHMENT_BYTES,
  detectContentType,
  formatFileSize,
  validateAttachmentSize,
} from "./attachment";
export type {
  AttachmentPhase,
  AttachmentEntry,
  UseAttachmentsOptions,
  UseAttachmentsReturn,
  AttachmentChipListProps,
} from "./attachment";

// Composer — unified message input with model, workspace, and file attachments
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

// MCP Server — data hook, count hook, list hook, search hook, picker, config panel, tool selector, detail view, setup orchestration, and OAuth connect
export {
  useMcpServer,
  useMcpServerCount,
  useMcpServerList,
  useMcpServerSearch,
  useMcpServerSetup,
  useMcpServerConnect,
  useMcpServerOAuthConnect,
  useMcpServerCredentials,
  useOAuthGrantStatus,
  useDisconnectOAuth,
  OAuthCallbackHandler,
  McpServerPicker,
  McpServerConfigPanel,
  McpServerDetailView,
  McpToolSelector,
  toServerKey,
} from "./mcp-server";
export type {
  UseMcpServerReturn,
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
  McpServerOAuthSignInProps,
  McpServerDetailViewProps,
  CapabilityTab,
  McpToolSelectorProps,
  UseMcpServerConnectReturn,
  UseMcpServerOAuthConnectReturn,
  OAuthConnectPhase,
  OAuthCallbackHandlerProps,
  OAuthCallbackParams,
  UseMcpServerCredentialsReturn,
  UseOAuthGrantStatusReturn,
  UseDisconnectOAuthReturn,
  McpServerAuthMode,
} from "./mcp-server";

// Skill — data hook, count hook, list hook, search hook, picker, and detail view component
export {
  useSkill,
  useSkillCount,
  useSkillList,
  useSkillSearch,
  SkillPicker,
  SkillDetailView,
} from "./skill";
export type {
  UseSkillReturn,
  UseSkillCountOptions,
  UseSkillCountReturn,
  UseSkillListOptions,
  UseSkillListReturn,
  UseSkillSearchOptions,
  UseSkillSearchReturn,
  SkillPickerProps,
  SkillDetailViewProps,
} from "./skill";

// GitHub — OAuth connection, repo picker, and hooks
export {
  useGitHubConnection,
  useGitHubRepos,
  useGitHubSearch,
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
  UseGitHubSearchReturn,
  GitHubRepoPickerProps,
} from "./github";

// Agent — data hook, count hook, list hook, search hook, picker, detail view, env form, setup orchestration, env diffing, and default agent
export {
  useAgent,
  useAgentCount,
  useAgentList,
  useAgentSearch,
  AgentPicker,
  AgentDetailView,
  AgentEnvForm,
  diffEnv,
  useAgentSetup,
  useDefaultAgent,
} from "./agent";
export type {
  UseAgentReturn,
  UseAgentCountOptions,
  UseAgentCountReturn,
  UseAgentListOptions,
  UseAgentListReturn,
  UseAgentSearchOptions,
  UseAgentSearchReturn,
  AgentPickerProps,
  AgentDetailViewProps,
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
  UseDefaultAgentReturn,
} from "./agent";

// Environment — data hooks, list hook, personal convenience hook, secret reveal, variable management, env var form, system env vars, and styled components
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
  useSessionEnvPool,
  SYSTEM_ENV_VAR_KEYS,
  toGrpcAddress,
  buildSystemEnvVars,
  resolveSystemEnvVarValues,
  resolveDeclaredSystemEnvVars,
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
  SessionEnvPoolInput,
  UseSessionEnvPoolReturn,
} from "./environment";

// IAM Policy — data hooks, behavior hooks, headless hook, and styled components for access management
export {
  useGrantableRoles,
  useRoleSelector,
  useResourceAccess,
  usePrincipalsCount,
  useWhoAmI,
  useCreateIamPolicy,
  useDeleteIamPolicy,
  useRevokeOrgAccess,
  RoleSelector,
  GrantAccessForm,
  OrgMembersPanel,
} from "./iam-policy";
export type {
  UseGrantableRolesReturn,
  RoleOption,
  UseRoleSelectorReturn,
  ResourceAccessRef,
  UseResourceAccessOptions,
  UseResourceAccessReturn,
  UsePrincipalsCountReturn,
  UseWhoAmIReturn,
  UseCreateIamPolicyReturn,
  UseDeleteIamPolicyReturn,
  UseRevokeOrgAccessReturn,
  RoleSelectorProps,
  GrantAccessFormProps,
  OrgMembersPanelProps,
} from "./iam-policy";

// Organization — data hook, behavior hooks, styled form for creation, and profile panel
export {
  useOrganization,
  useCreateOrganization,
  useUpdateOrganization,
  CreateOrganizationForm,
  OrgProfilePanel,
} from "./organization";
export type {
  UseOrganizationReturn,
  UseCreateOrganizationReturn,
  UseUpdateOrganizationReturn,
  CreateOrganizationFormProps,
  OrgProfilePanelProps,
} from "./organization";

// API Key — data hooks, behavior hooks, and styled components for API key lifecycle
export {
  useApiKeyList,
  useCreateApiKey,
  useDeleteApiKey,
  ApiKeyListPanel,
  CreateApiKeyForm,
  ApiKeyCreatedAlert,
} from "./api-key";
export type {
  UseApiKeyListReturn,
  UseCreateApiKeyReturn,
  UseDeleteApiKeyReturn,
  ApiKeyListPanelProps,
  CreateApiKeyFormProps,
  ApiKeyCreatedAlertProps,
} from "./api-key";

// Identity Provider — data hooks, mutation hooks, styled components, presets, and guided wizard for IdP management and SSO discovery
export {
  useIdentityProviderList,
  useIdentityProvider,
  useSsoProvider,
  useCreateIdentityProvider,
  useUpdateIdentityProvider,
  useDeleteIdentityProvider,
  IdentityProviderListPanel,
  CreateIdentityProviderForm,
  PROVIDER_PRESETS,
  getPreset,
  ProviderPicker,
  IdentityProviderWizard,
  IdentityProviderDetailPanel,
  SsoLoginPrompt,
} from "./identity-provider";
export type {
  UseIdentityProviderListReturn,
  UseIdentityProviderReturn,
  UseSsoProviderReturn,
  UseCreateIdentityProviderReturn,
  UseUpdateIdentityProviderReturn,
  UseDeleteIdentityProviderReturn,
  IdentityProviderListPanelProps,
  CreateIdentityProviderFormProps,
  ProviderPreset,
  ProviderVariable,
  ProviderConfig,
  ProviderPickerProps,
  IdentityProviderWizardProps,
  IdentityProviderDetailPanelProps,
  SsoLoginPromptProps,
} from "./identity-provider";

// Invitation — data hooks, behavior hooks, and feature components for org invite links
export {
  useOrgInvitations,
  useCreateInvitation,
  useRevokeInvitation,
  useInvitationPreview,
  useRedeemInvitation,
  InvitationCreatedAlert,
  InvitationManager,
  InvitationRedemption,
} from "./invitation";
export type {
  UseOrgInvitationsReturn,
  UseCreateInvitationReturn,
  UseRevokeInvitationReturn,
  UseInvitationPreviewReturn,
  UseRedeemInvitationReturn,
  InvitationCreatedAlertProps,
  InvitationManagerProps,
  InvitationRedemptionProps,
} from "./invitation";

// Error — structured error display with classification, retry, and contextual guidance
export { ErrorMessage, SecretFlowErrorGuide, isSecretFlowError } from "./error";
export type { ErrorMessageProps, SecretFlowErrorGuideProps } from "./error";

// Library — cross-resource UI components, resource detection, apply flow, browsing, and visibility management
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
  serializeAgentYaml,
  serializeMcpServerYaml,
  useApplyResource,
  VisibilityToggle,
  useUpdateVisibility,
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
  VisibilityToggleProps,
  VisibilityResourceKind,
  UseUpdateVisibilityReturn,
} from "./library";

// Search — shared search/list/count infrastructure re-exported for public API surface
export type {
  UseResourceSearchOptions,
  UseResourceSearchReturn,
} from "./search";

// Usage — org-level usage report hook, dashboard panel, and date-range utilities
export {
  useOrgUsageReport,
  OrgUsagePanel,
  DATE_RANGE_PRESETS,
  dateRangeFromPreset,
  formatDateRange,
  presetLabel,
} from "./usage";
export type {
  UseOrgUsageReportReturn,
  OrgUsagePanelProps,
  DateRange,
  DateRangePreset,
} from "./usage";

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
