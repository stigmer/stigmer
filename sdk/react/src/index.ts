// Provider and context
export { StigmerProvider, type StigmerProviderProps } from "./provider";
export { StigmerContext } from "./context";

// Runner adapter
export { type RunnerAdapter, useRunnerAdapter } from "./runner-adapter";
// Construction helper lives in @stigmer/sdk (framework-agnostic); re-exported
// here so React embedders import it alongside the adapter interface.
export { type RunnerWorkerHost, createRunnerAdapter } from "@stigmer/sdk";

// Fetch cache
export { FetchCacheProvider } from "./internal/FetchCacheProvider";
export type { FetchCacheOptions } from "./internal/fetch-cache";

// Hooks
export { useStigmer } from "./hooks";

// Color mode
export { ColorModeContext, useColorMode } from "./color-mode";
export type { ColorMode, ResolvedColorMode } from "./color-mode";

// Portal container
export { useStigmerPortalContainer } from "./portal-container";

// Deployment mode and resource availability
export {
  DeploymentModeContext,
  useDeploymentMode,
  useResourceAvailable,
} from "./deployment-mode";
export { type DeploymentMode, isResourceAvailable, ApiResourceKind } from "@stigmer/sdk";
export { CloudFeatureNotice, type CloudFeatureNoticeProps } from "./internal/CloudFeatureNotice";

// Models — data hook, styled components, and registry data
export {
  DEFAULT_MODEL_ID,
  DEFAULT_CURSOR_MODEL_ID,
  DISABLED_PROVIDERS,
  modelKey,
  parseModelKey,
  fetchModelRegistry,
  parseRegistryJson,
  useModelRegistry,
  ModelRegistryContext,
  ModelSelector,
  HarnessSelector,
  DEFAULT_HARNESS,
  HARNESS_LABELS,
  toProtoHarness,
  fromProtoHarness,
} from "./models";
export type {
  ModelInfo,
  ModelRegistryState,
  ParsedModelKey,
  Provider,
  CostTier,
  UseModelRegistryReturn,
  UseModelRegistryOptions,
  ModelSelectorProps,
  HarnessSelectorProps,
  HarnessOption,
} from "./models";

// Workspace — behavior hooks and styled components
export {
  useWorkspaceEntries,
  useWorkspaceFiles,
  useWorkspaceSources,
  WorkspaceEditor,
  WorkspaceEntryFiles,
  WorkspaceSummary,
} from "./workspace";
export type {
  WorkspaceEntry,
  WorkspaceFileEntry,
  WorkspaceFileLister,
  UseWorkspaceEntriesReturn,
  UseWorkspaceFilesOptions,
  UseWorkspaceFilesReturn,
  WorkspaceEntryFilesProps,
  UseWorkspaceSourcesOptions,
  UseWorkspaceSourcesReturn,
  WorkspaceEditorProps,
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
  useNewSessionFlow,
  useSessionPageFlow,
  usePersistedModel,
  useEditSessionPrep,
  CREATOR_AGENTS,
  parseDraftType,
  parseDraftParams,
  groupSessionsByTime,
  groupSearchResultsByTime,
  useSessionSearch,
  PENDING_SUBJECT,
  resolvedSubject,
  SessionViewer,
  NewSessionViewer,
  SessionInspector,
  useSessionInspector,
  buildVisibleTabs,
  SetupTab,
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
  UseSessionSearchOptions,
  UseSessionSearchReturn,
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
  UseNewSessionFlowOptions,
  UseNewSessionFlowReturn,
  UseSessionPageFlowOptions,
  UseSessionPageFlowReturn,
  UsePersistedModelOptions,
  UsePersistedModelReturn,
  UseEditSessionPrepReturn,
  DraftResourceType,
  DraftParams,
  SessionGroup,
  SearchResultGroup,
  SessionViewerProps,
  NewSessionViewerProps,
  ExecutionTargetOption,
  RuntimeEnvProvider,
  SessionAudience,
  SessionInspectorProps,
  SessionInspectorTabId,
  UseSessionInspectorOptions,
  UseSessionInspectorReturn,
  SetupTabProps,
  SetupTabMutationCallbacks,
  SelectedThreadItem,
} from "./session";

// Activity — unified recent activity (sessions + workflow executions)
export {
  useRecentActivity,
  groupRecentActivityByTime,
} from "./activity";
export type {
  RecentActivityType,
  RecentActivityEntry,
  RecentActivityGroup,
  UseRecentActivityOptions,
  UseRecentActivityReturn,
} from "./activity";

// Execution — behavior hooks, styled components, and utilities (AgentExecution aggregate)
export {
  isTerminalPhase,
  useCreateAgentExecution,
  useExecutionStream,
  useSubmitApproval,
  ExecutionPhaseBadge,
  InteractionModeBadge,
  SetupProgress,
  ExecutionProgress,
  TodoList,
  TodoInProgressIcon,
  findActiveTodo,
  todoCompletionSummary,
  UsageWidget,
  ContextGauge,
  SummarizationBadge,
  SummarizationCard,
  PlanCompletionCard,
  useContextWindow,
  formatCost,
  formatTokenCount,
  ToolCallGroup,
  ToolCallDetail,
  ResultView,
  summarizeResultView,
  useToolPresentation,
  registerToolPresenter,
  getToolPresenter,
  resolveToolCategory,
  resolveToolCategoryFromCall,
  resolveToolCategoryFromKind,
  toolKindToCategoryInfo,
  McpToolDetail,
  parseMcpResult,
  formatDuration,
  humanizeToolName,
  ToolCallItem,
  SubAgentSection,
  MessageEntry,
  MessageThread,
  ThreadSkeleton,
  FollowUpInput,
  ApprovalCard,
  ArtifactCard,
  ArtifactContentRenderer,
  ArtifactPreviewContent,
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
  InteractionModeBadgeProps,
  SetupProgressProps,
  ExecutionProgressProps,
  TodoListProps,
  UsageWidgetProps,
  ContextGaugeProps,
  SummarizationBadgeProps,
  SummarizationCardProps,
  PlanCompletionCardProps,
  ContextHealth,
  SummarizationEventView,
  UseContextWindowReturn,
  ToolCallGroupProps,
  ToolCallDetailProps,
  ResultViewProps,
  ToolPresentation,
  ToolPresenter,
  McpToolDetailProps,
  McpArgsViewProps,
  McpMetadataRowProps,
  ToolArgsViewProps,
  ToolCallItemProps,
  SubAgentSectionProps,
  MessageEntryProps,
  MessageThreadProps,
  ThreadSkeletonProps,
  FollowUpInputProps,
  ApprovalCardProps,
  ArtifactCardProps,
  ArtifactContentRendererProps,
  ArtifactRenderMode,
  ArtifactPreviewContentProps,
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

// File Reference — workspace file-reference behavior hook and styled chip list
export {
  useFileReferences,
  FileReferenceChipList,
} from "./file-reference";
export type {
  UseFileReferencesReturn,
  FileReferenceChipListProps,
} from "./file-reference";
export { FILE_REF_MIME } from "./internal/file-tree";

// Composer — unified message input with model, workspace, and file attachments
export {
  useComposer,
  SessionComposer,
  InteractionModePicker,
} from "./composer";
export type {
  UseComposerOptions,
  UseComposerReturn,
  SessionComposerHandle,
  SessionComposerProps,
  SessionComposerSubmitContext,
  InteractionModePickerProps,
  InteractionModeOption,
} from "./composer";

// MCP Server — data hook, count hook, list hook, search hook, picker, config panel, tool selector, detail view, setup orchestration, OAuth connect, and update
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
  McpServerConnectDialog,
  McpServerCreationWizard,
  McpToolSelector,
  useCreateMcpServer,
  useUpdateMcpServer,
  mcpServerToInput,
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
  McpServerConnectDialogProps,
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
  UseCreateMcpServerReturn,
  UseUpdateMcpServerReturn,
  McpServerCreationWizardProps,
  McpServerCreationResult,
  McpServerWizardData,
} from "./mcp-server";

// Skill — data hooks, upload, file browser, and mutation
export {
  useSkill,
  useSkillCount,
  useSkillList,
  useSkillSearch,
  SkillPicker,
  SkillDetailView,
  usePushSkill,
  useSkillUpload,
  useSkillArtifact,
  useSkillVersions,
  useSkillDiff,
  useSkillDuplicateCheck,
  SkillUploader,
  SkillFileBrowser,
  SkillDiffDialog,
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
  PushSkillInput,
  UsePushSkillReturn,
  SkillUploadPreview,
  SkillFileEntry,
  UseSkillUploadReturn,
  UseSkillArtifactReturn,
  UseSkillVersionsReturn,
  UseSkillDiffReturn,
  UseSkillDuplicateCheckReturn,
  SkillDiffDialogProps,
  SkillDiffDialogState,
  SkillUploaderProps,
  SkillFileBrowserProps,
} from "./skill";

// GitHub — OAuth connection, repo picker, tree lister, and hooks
export {
  useGitHubConnection,
  useGitHubRepos,
  useGitHubSearch,
  useGitHubTreeLister,
  parseGitUrl,
  GitHubRepoPicker,
  GITHUB_CALLBACK_MESSAGE_TYPE,
} from "./github";
export type {
  GitHubUser,
  GitHubConnectOptions,
  UseGitHubConnectionConfig,
  UseGitHubConnectionReturn,
  GitHubRepo,
  GitHubBranch,
  UseGitHubReposReturn,
  UseGitHubSearchReturn,
  GitHubRepoPickerProps,
  ParsedGitRepo,
} from "./github";

// Agent — data hook, count hook, list hook, search hook, picker, detail view, env form, setup orchestration, env diffing, default agent, creation wizard, update
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
  useCreateAgent,
  useUpdateAgent,
  agentToInput,
  AgentCreationWizard,
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
  UseCreateAgentReturn,
  UseUpdateAgentReturn,
  AgentCreationWizardProps,
  AgentCreationResult,
  AgentWizardData,
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
  EnvironmentPicker,
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
  EnvironmentPickerProps,
} from "./environment";

// Identity Account — gate hook for ensuring the caller's identity account exists before app render
export {
  useIdentityAccountGate,
} from "./identity-account";
export type {
  IdentityAccountGateState,
  UseIdentityAccountGateReturn,
} from "./identity-account";

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
  useShareFlow,
  useCheckPermission,
  RoleSelector,
  PrincipalPicker,
  ProviderBadge,
  providerLabel,
  GrantAccessForm,
  PeopleWithAccess,
  OrgMembersPanel,
  SharePanel,
  PermissionGate,
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
  UseShareFlowReturn,
  ShareFlowResource,
  UseCheckPermissionReturn,
  PermissionCheckResource,
  RoleSelectorProps,
  PrincipalPickerProps,
  SelectedPrincipal,
  ProviderBadgeProps,
  GrantAccessFormProps,
  PeopleWithAccessProps,
  OrgMembersPanelProps,
  SharePanelProps,
  PermissionGateProps,
} from "./iam-policy";

// Access — unified "Manage access" experience (visibility + people) as one
// dialog, with a kebab hook and a visible-button trigger.
export {
  ManageAccessDialog,
  ManageAccessButton,
  useManageAccess,
} from "./access";
export type {
  ManageAccessDialogProps,
  ManageAccessButtonProps,
  UseManageAccessArgs,
  UseManageAccessReturn,
  AccessResource,
  AccessVisibility,
  AccessExtraSection,
} from "./access";

// Organization — context provider, hooks, data hooks, behavior hooks, styled form, profile panel, and org switcher
export {
  OrgProvider,
  useOrg,
  useActiveOrgSlug,
  useActiveOrgId,
  useOrgGate,
  useOrganization,
  useCreateOrganization,
  useUpdateOrganization,
  CreateOrganizationForm,
  OrgProfilePanel,
  OrgSwitcher,
} from "./organization";
export type {
  OrgContextValue,
  UseOrgGateOptions,
  OrgGateState,
  UseOrgGateReturn,
  UseOrganizationReturn,
  UseCreateOrganizationReturn,
  UseUpdateOrganizationReturn,
  CreateOrganizationFormProps,
  OrgProfilePanelProps,
  OrgSwitcherProps,
} from "./organization";

// Billing — data hooks, behavior hooks, styled components, catalog, and formatting utilities
export {
  useBillingAccount,
  useCreditLedger,
  useBillingUsageReport,
  useCustomerModelPricing,
  useCreateCheckoutSession,
  useCreateBillingPortalSession,
  useSetAutoRechargeConfig,
  BillingSection,
  CreditBalanceCard,
  PaymentMethodCard,
  AutoRechargeCard,
  CreditPackGrid,
  CreditLedgerTable,
  LowBalanceBanner,
  CREDIT_PACKS,
  formatPackPrice,
  formatCreditCount,
  formatCreditBalance,
  formatLedgerAmount,
  ledgerEntryLabel,
  isCredit,
  isHold,
  formatLedgerDate,
} from "./billing";
export type {
  UseBillingAccountReturn,
  UseCreditLedgerReturn,
  UseCreditLedgerOptions,
  UseBillingUsageReportReturn,
  UseCustomerModelPricingReturn,
  CreateCheckoutSessionInput,
  UseCreateCheckoutSessionReturn,
  UseCreateBillingPortalSessionReturn,
  SetAutoRechargeConfigInput,
  UseSetAutoRechargeConfigReturn,
  BillingSectionProps,
  CreditBalanceCardProps,
  PaymentMethodCardProps,
  AutoRechargeCardProps,
  CreditPackGridProps,
  CreditLedgerTableProps,
  LowBalanceBannerProps,
  CreditPackInfo,
} from "./billing";

// Settings — navigation structure + section components shared across app shells
export { SETTINGS_NAV_GROUPS } from "./settings";
export type { SettingsNavItem, SettingsNavGroup } from "./settings";
export { ApiKeysSection } from "./settings";
export { MembersSection } from "./settings";
export { OrgProfileSection } from "./settings";
export { EnvironmentsSection } from "./settings";
export { InvitationsSection } from "./settings";
export { IdentityProvidersSection } from "./settings";
export type { IdentityProvidersSectionProps } from "./settings";
export { PlatformClientsSection } from "./settings";
export { OAuthAppsSection } from "./settings";
export { UsageSection } from "./settings";

// User — app shell user menu
export { UserMenu } from "./user";
export type { UserMenuProps } from "./user";

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

// Platform Client — data hooks, mutation hooks, and styled components for platform client lifecycle
export {
  usePlatformClientList,
  usePlatformClient,
  useCreatePlatformClient,
  useUpdatePlatformClient,
  useDeletePlatformClient,
  useRotatePlatformClientSecret,
  PlatformClientListPanel,
  CreatePlatformClientForm,
  PlatformClientDetailPanel,
  PlatformClientSecretAlert,
} from "./platform-client";
export type {
  UsePlatformClientListReturn,
  UsePlatformClientReturn,
  UseCreatePlatformClientReturn,
  UseUpdatePlatformClientReturn,
  UseDeletePlatformClientReturn,
  UseRotatePlatformClientSecretReturn,
  PlatformClientListPanelProps,
  CreatePlatformClientFormProps,
  PlatformClientDetailPanelProps,
  PlatformClientSecretAlertProps,
} from "./platform-client";

// OAuth App — data hooks, mutation hooks, and styled components for OAuth app management
export {
  useOAuthAppList,
  useCreateOAuthApp,
  useUpdateOAuthApp,
  useDeleteOAuthApp,
  OAuthAppListPanel,
  CreateOAuthAppForm,
  OAuthAppDetailPanel,
} from "./oauth-app";
export type {
  UseOAuthAppListReturn,
  UseCreateOAuthAppReturn,
  UseUpdateOAuthAppReturn,
  UseDeleteOAuthAppReturn,
  OAuthAppListPanelProps,
  CreateOAuthAppFormProps,
  OAuthAppDetailPanelProps,
} from "./oauth-app";

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
  LibraryBreadcrumbProvider,
  useBreadcrumbLabel,
  useBreadcrumbOverride,
  ScopeToggle,
  ResourceCountCard,
  detectStigmerResource,
  useDetectStigmerResource,
  isSkillPackage,
  detectSkillPackage,
  useDetectSkillPackage,
  isPlanArtifact,
  findPlanArtifact,
  parseResourceYaml,
  serializeAgentYaml,
  serializeMcpServerYaml,
  serializeAgentInputYaml,
  serializeMcpServerInputYaml,
  useApplyResource,
  useExportResource,
  useImportResource,
  ImportResourceDialog,
  VisibilitySelector,
  VisibilityBadge,
  blueprintVisibilityLevels,
  INSTANCE_VISIBILITY_LEVELS,
  visibilityLabel,
  useUpdateVisibility,
} from "./library";
export type {
  ScopeToggleProps,
  ResourceCountCardProps,
  StigmerResourceKind,
  StigmerResourceDetection,
  SkillPackageDetection,
  UseDetectSkillPackageReturn,
  ParsedResource,
  UseApplyResourceReturn,
  ApplyResourceResult,
  PushSkillParams,
  UseExportResourceOptions,
  UseExportResourceReturn,
  ImportFormat,
  ImportPreview,
  UseImportResourceReturn,
  ImportResourceDialogProps,
  VisibilitySelectorProps,
  VisibilityLevelOption,
  BlueprintVisibilityLevelsContext,
  VisibilityResourceKind,
  UseUpdateVisibilityReturn,
} from "./library";

// Action menu — compound component for resource item actions
export { ActionMenu } from "./action-menu";
export type {
  ActionMenuProps,
  ActionMenuTriggerProps,
  ActionMenuContentProps,
  ActionMenuItemProps,
  ActionMenuSeparatorProps,
  ActionMenuGroupProps,
} from "./action-menu";

// Feedback — toast notification system wrapping Sonner
export { StigmerToaster, toast } from "./feedback";
export type { StigmerToasterProps } from "./feedback";

// Empty state — reusable empty/zero/permission/error state primitives
export { EmptyState, useEmptyState } from "./empty-state";
export type {
  EmptyStateVariant,
  EmptyStateAction,
  EmptyStateProps,
  UseEmptyStateOptions,
  UseEmptyStateReturn,
} from "./empty-state";

// Search — shared search/list/count infrastructure re-exported for public API surface
export type {
  UseResourceSearchOptions,
  UseResourceSearchReturn,
} from "./search";

// Usage — org-level usage report hook, dashboard panel, and date-range utilities
export {
  useOrgUsageReport,
  OrgUsagePanel,
  CreditRunwayIndicator,
  AgentBreakdownList,
  HarnessSplitCard,
  useExportCSV,
  ExportButton,
  DATE_RANGE_PRESETS,
  dateRangeFromPreset,
  formatDateRange,
  presetLabel,
} from "./usage";
export type {
  UseOrgUsageReportReturn,
  OrgUsagePanelProps,
  CreditRunwayIndicatorProps,
  AgentBreakdownListProps,
  HarnessSplitCardProps,
  UseExportCSVReturn,
  ExportFormat,
  ExportButtonProps,
  DateRange,
  DateRangePreset,
} from "./usage";

// Agent Instance — data hooks, mutation hooks, management components, and behavior hook
export {
  useAgentInstance,
  useAgentInstanceList,
  useAgentInstances,
  usePersonalAgentInstance,
  useCreateAgentInstance,
  useUpdateAgentInstance,
  useDeleteAgentInstance,
  AgentInstanceList,
  AgentInstanceEmptyState,
  CreateAgentInstanceDialog,
  AgentInstanceDetailPanel,
} from "./agent-instance";
export type {
  UseAgentInstanceReturn,
  UseAgentInstanceListReturn,
  UseAgentInstancesReturn,
  GetOrCreatePersonalInstanceInput,
  UsePersonalAgentInstanceReturn,
  UseCreateAgentInstanceReturn,
  UseUpdateAgentInstanceReturn,
  UseDeleteAgentInstanceReturn,
  AgentInstanceListProps,
  AgentInstanceEmptyStateProps,
  CreateAgentInstanceDialogProps,
  AgentInstanceDetailPanelProps,
} from "./agent-instance";

// Tabs — accessible tabbed panel primitive
export { Tabs } from "./tabs";
export type { TabsProps, TabItem } from "./tabs";

// Resource Detail — headless hooks, action bar, and composed shell for resource detail pages
export {
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  ResourceActionBar,
  ResourceDetailShell,
  Section,
  ConfirmDialog,
} from "./resource-detail";
export type {
  AdditionalTab,
  DetailAction,
  ResourceHeaderMeta,
  ConfirmOptions,
  ConfirmState,
  ResourceDetailShellProps,
  SectionProps,
  UseCopyResourceReturn,
  UseConfirmActionReturn,
  DeletableResourceKind,
  UseDeleteResourceReturn,
  ResourceActionBarProps,
  ConfirmDialogProps,
} from "./resource-detail";

// Resource Creation — shared wizard infrastructure for multi-step creation flows
export {
  useWizardState,
  useTemplateFilter,
  WizardShell,
  WizardNav,
  StepIndicator,
  TemplateCard,
  TemplateGallery,
  CreationPicker,
  TEMPLATE_CATEGORY_LABELS,
  AGENT_TEMPLATES,
  MCP_SERVER_TEMPLATES,
  WORKFLOW_TEMPLATES,
} from "./resource-creation";
export type {
  EnvVarEntry,
  KeyValueEntry,
  WizardStepDef,
  WizardState,
  WizardShellProps,
  UseWizardStateOptions,
  UseWizardStateReturn,
  UseTemplateFilterOptions,
  UseTemplateFilterReturn,
  WizardNavProps,
  StepIndicatorProps,
  ResourceTemplate,
  TemplateCategory,
  TemplateCardProps,
  TemplateGalleryProps,
  CreationPickerProps,
  CreationPath,
} from "./resource-creation";

// Dependency Graph — visual tree of agent dependencies (MCP servers, skills, sub-agents)
export { DependencyGraph, useDependencyGraph } from "./dependency-graph";
export type {
  NodeKind,
  DependencyNode,
  DependencyTree,
  DependencyGraphProps,
  UseDependencyGraphOptions,
  UseDependencyGraphReturn,
} from "./dependency-graph";

// Version History — generic timeline, diff infrastructure for versioned resources
export {
  VersionTimeline,
  VersionTimelineEntry,
  DiffViewer,
  DiffFileList,
  DiffSummary,
  MultiFileDiffView,
  computeDiff,
  computeMultiFileDiff,
} from "./version-history";
export type {
  VersionEntry,
  VersionTimelineProps,
  VersionTimelineEntryProps,
  DiffViewerProps,
  DiffFileListProps,
  DiffSummaryProps,
  MultiFileDiffViewProps,
  DiffLine,
  DiffHunk,
  FileDiffEntry,
  MultiFileDiffResult,
  DiffViewMode,
} from "./version-history";

// Inline Edit — click-to-edit field primitives for detail page inline editing
export {
  InlineEditText,
  InlineEditTextarea,
  InlineEditImage,
  InlineEditSelect,
  InlineEditKeyValue,
  InlineEditResourceList,
  useInlineFieldSave,
} from "./inline-edit";
export type {
  InlineEditTextProps,
  InlineEditTextareaProps,
  InlineEditImageProps,
  InlineEditSelectProps,
  InlineEditKeyValueProps,
  InlineEditResourceListProps,
  UseInlineFieldSaveReturn,
  InlineEditBaseProps,
  KeyValueRow,
  ResourceRefRow,
  SelectOption,
} from "./inline-edit";

// Resource Workbench — headless hooks, view components, and composed shell for resource collection management
export {
  useViewPreference,
  useResourceCollection,
  useResourceFilters,
  useResourceSelection,
  StatusBadge,
  ColumnHeader,
  SelectionCheckbox,
  ResourceTable,
  ResourceCards,
  ResourceList,
  BulkActionBar,
  FilterBar,
  ViewSwitcher,
  ResourceInspector,
  ResourceWorkbench,
  ResourceAvatar,
} from "./resource-workbench";
export type {
  ViewMode,
  StatusPhase,
  WorkbenchColumnDef,
  FilterOperator,
  FilterValue,
  FilterDef,
  FilterOption,
  SortDirection,
  SortValue,
  SortDef,
  ResourceAction,
  BulkAction,
  WorkbenchState,
  UseViewPreferenceReturn,
  UseResourceCollectionOptions,
  UseResourceCollectionReturn,
  UseResourceFiltersOptions,
  UseResourceFiltersReturn,
  FilterSortState,
  UseResourceSelectionReturn,
  StatusBadgeProps,
  ColumnHeaderProps,
  SelectionCheckboxProps,
  ResourceTableProps,
  ResourceCardsProps,
  ResourceListProps,
  BulkActionBarProps,
  FilterBarProps,
  ViewSwitcherProps,
  ResourceInspectorProps,
  ResourceWorkbenchProps,
  ResourceAvatarProps,
} from "./resource-workbench";

// Workflow — data hooks, styled components, task kind registry
export {
  TaskKindRegistryContext,
  useTaskKindRegistry,
  useWorkflow,
  useWorkflowList,
  useWorkflowCount,
  useWorkflowInstances,
  useWorkflowExecutionList,
  useWorkflowExecution,
  useWorkflowExecutionEventLog,
  useWorkflowExecutionArtifacts,
  useWorkflowExecutionEventStream,
  useWorkflowExecutionActions,
  WorkflowExecutionPhaseBadge,
  WorkflowTaskList,
  WorkflowDetailView,
  WorkflowExecutionViewer,
  WorkflowExecutionHeader,
  WorkflowExecutionTimeline,
  WorkflowExecutionTaskPanel,
  WorkflowExecutionCostPanel,
  WorkflowExecutionArtifactPanel,
  WorkflowExecutionApprovalCard,
  serializeWorkflowYaml,
  parseWorkflowYaml,
  useWorkflowYaml,
  useWorkflowSave,
  useWorkflowValidation,
  useWorkflowTopology,
  WorkflowYamlEditor,
  WorkflowCodePreviewGraph,
  useWorkflowEditor,
  WorkflowEditorView,
  useRunWorkflowFlow,
  WorkflowRunForm,
  WorkflowRunDialog,
  useWorkflowDashboardSummary,
  usePendingApprovals,
  ExecutionSummaryWidget,
  PendingApprovalsWidget,
  FailedRunsWidget,
  WorkflowDashboard,
  START_NODE_ID,
  END_NODE_ID,
  yamlToGraph,
  graphToYaml,
  graphToWorkflowInput,
  useWorkflowCanvas,
  TASK_KIND_DRAG_MIME,
  WorkflowCanvasEditor,
  WorkflowTaskPalette,
  TaskPickerPopover,
  CanvasContextMenu,
  WorkflowInspectorPanel,
  TaskConfigForm,
  BranchConditionBuilder,
  ApprovalFormBuilder,
  useResolveAgentExecutionSession,
  CostByWorkflowChart,
  ExecutionTrendChart,
  extractWorkflowYaml,
  useWorkflowArchitectFlow,
  WorkflowArchitectDialog,
  useRefineWorkflowFlow,
  WorkflowRefinePanel,
  computeUnifiedDiff,
  useDiagnoseExecutionFlow,
  WorkflowRepairCard,
  STARTER_WORKFLOW_YAML,
  useElkLayoutEngine,
  // T13: Execution history
  deriveExecutionRow,
  deriveExecutionRows,
  sortExecutionRows,
  filterExecutionRows,
  deriveFailureAnalysis,
  useExecutionHistoryData,
  ExecutionHistoryTable,
  ExecutionFilterBar,
  HealthMetricsStrip,
  FailureAnalysisPanel,
  WorkflowExecutionHistory,
  // Workflow Instance management
  useWorkflowInstance,
  useCreateWorkflowInstance,
  useUpdateWorkflowInstance,
  useUpdateWorkflowInstanceExecutionVisibility,
  useDeleteWorkflowInstance,
  WorkflowInstanceEmptyState,
  WorkflowInstanceList,
  CreateWorkflowInstanceDialog,
  WorkflowInstanceDetailPanel,
  RunVisibilityControl,
  // T15: Workflow Template Gallery
  PATTERN_LABELS,
  WORKFLOW_CATEGORY_LABELS,
  deriveTemplateMeta,
  WorkflowTemplateCard,
  WorkflowTemplatePreview,
  WorkflowTemplateGallery,
} from "./workflow";
export type {
  TaskKindDescriptor,
  TaskKindCategory,
  TaskFieldDescriptor,
  TaskFieldType,
  TaskFieldGroup,
  TaskKindRegistryState,
  UseTaskKindRegistryReturn,
  UseWorkflowReturn,
  UseWorkflowListOptions,
  UseWorkflowListReturn,
  UseWorkflowCountOptions,
  UseWorkflowCountReturn,
  UseWorkflowInstancesReturn,
  UseWorkflowExecutionListOptions,
  UseWorkflowExecutionListReturn,
  UseWorkflowExecutionReturn,
  UseWorkflowExecutionEventLogOptions,
  UseWorkflowExecutionEventLogReturn,
  UseWorkflowExecutionArtifactsReturn,
  UseWorkflowExecutionEventStreamOptions,
  UseWorkflowExecutionEventStreamReturn,
  UseWorkflowExecutionActionsReturn,
  WorkflowExecutionPhaseBadgeProps,
  WorkflowTaskListProps,
  WorkflowDetailViewProps,
  WorkflowExecutionViewerProps,
  WorkflowExecutionHeaderProps,
  WorkflowExecutionTimelineProps,
  WorkflowExecutionTaskPanelProps,
  WorkflowExecutionCostPanelProps,
  WorkflowExecutionArtifactPanelProps,
  WorkflowExecutionApprovalCardProps,
  UseWorkflowYamlReturn,
  UseWorkflowSaveReturn,
  UseWorkflowValidationReturn,
  UseWorkflowTopologyReturn,
  TopologyNode,
  TopologyEdge,
  TopologyNodeCategory,
  WorkflowYamlEditorProps,
  WorkflowCodePreviewGraphProps,
  UseWorkflowEditorOptions,
  UseWorkflowEditorReturn,
  WorkflowEditorViewProps,
  WorkflowEditorMode,
  UseRunWorkflowFlowOptions,
  UseRunWorkflowFlowReturn,
  RunWorkflowFieldErrors,
  WorkflowRunFormProps,
  WorkflowRunDialogProps,
  UseWorkflowDashboardSummaryOptions,
  UseWorkflowDashboardSummaryReturn,
  UsePendingApprovalsOptions,
  UsePendingApprovalsReturn,
  ExecutionSummaryWidgetProps,
  PendingApprovalsWidgetProps,
  FailedRunsWidgetProps,
  WorkflowDashboardProps,
  WorkflowGraphModel,
  WorkflowGraphNode,
  WorkflowGraphEdge,
  WorkflowGraphDocument,
  WorkflowGraphEnvVar,
  WorkflowGraphBudget,
  CanvasSelection,
  UseWorkflowCanvasOptions,
  UseWorkflowCanvasReturn,
  WorkflowCanvasEditorProps,
  WorkflowTaskPaletteProps,
  TaskPickerPopoverProps,
  CanvasContextMenuProps,
  CanvasContextMenuTarget,
  WorkflowInspectorPanelProps,
  TaskConfigFormProps,
  BranchConditionBuilderProps,
  ApprovalFormBuilderProps,
  UseResolveAgentExecutionSessionReturn,
  CostByWorkflowChartProps,
  ExecutionTrendChartProps,
  ExtractedWorkflowYaml,
  ArchitectPhase,
  UseWorkflowArchitectFlowOptions,
  UseWorkflowArchitectFlowReturn,
  WorkflowArchitectDialogProps,
  RefinePhase,
  UseRefineWorkflowFlowOptions,
  UseRefineWorkflowFlowReturn,
  WorkflowRefinePanelProps,
  DiffLine as WorkflowDiffLine,
  DiffLineType as WorkflowDiffLineType,
  DiagnosePhase,
  UseDiagnoseExecutionFlowOptions,
  UseDiagnoseExecutionFlowReturn,
  WorkflowRepairCardProps,
  UseElkLayoutEngineOptions,
  // T13: Execution history types
  ExecutionRow,
  ExecutionHistorySortField,
  ExecutionHistorySortDirection,
  ExecutionClientFilters,
  FailureGroup,
  FailureInstance,
  UseExecutionHistoryDataOptions,
  UseExecutionHistoryDataReturn,
  ExecutionHistoryTableProps,
  ExecutionFilterBarProps,
  HealthMetricsStripProps,
  FailureAnalysisPanelProps,
  WorkflowExecutionHistoryProps,
  // Workflow Instance management types
  UseWorkflowInstanceReturn,
  UseCreateWorkflowInstanceReturn,
  UseUpdateWorkflowInstanceReturn,
  UseUpdateWorkflowInstanceExecutionVisibilityReturn,
  UseDeleteWorkflowInstanceReturn,
  WorkflowInstanceEmptyStateProps,
  WorkflowInstanceListProps,
  CreateWorkflowInstanceDialogProps,
  WorkflowInstanceDetailPanelProps,
  RunVisibilityControlProps,
  // T15: Workflow Template Gallery types
  WorkflowTemplateData,
  WorkflowTemplateCategory,
  WorkflowTemplateMeta,
  WorkflowPattern,
  WorkflowTemplate,
  WorkflowTemplateCardProps,
  WorkflowTemplatePreviewProps,
  WorkflowTemplateGalleryProps,
} from "./workflow";

// ─── Dashboard (Unified Platform) ──────────────────────────────────────────
export {
  // Types
  type DashboardSummary,
  type DashboardFailedRun,
  // Data Hooks
  useAgentExecutionSummary,
  AgentExecutionSummaryTimeWindow,
  type UseAgentExecutionSummaryOptions,
  type UseAgentExecutionSummaryReturn,
  useDashboardSummary,
  type UseDashboardSummaryOptions,
  type UseDashboardSummaryReturn,
  useDashboardFailedRuns,
  type UseDashboardFailedRunsReturn,
  // Styled Components
  DashboardKPICards,
  type DashboardKPICardsProps,
  DashboardFailedRuns,
  type DashboardFailedRunsProps,
  OperationalDashboard,
  type OperationalDashboardProps,
} from "./dashboard";
