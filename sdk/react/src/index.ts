// @stigmer/react-sdk — what a product embeds: the components, and with them
// every hook and helper of ./headless, re-exported here.
//
// The package's entries are tiers over one module graph, so a context is the
// same object whichever entry it is imported from:
//   - "@stigmer/react-sdk": this file;
//   - "@stigmer/react-sdk/headless": the hooks, logic and contexts alone
//     (./headless.ts);
//   - "@stigmer/react-sdk/console": the Stigmer console's own parts, not
//     designed for embedding (./console.ts);
//   - "@stigmer/react-sdk/test": test builders and the scenario catalogue.
// A name belongs at the root when a platform builder embedding Stigmer could
// need it; a type an embedder needs is exported from every entry that names
// it.

export * from "./headless.js";

// Provider and context
export { StigmerProvider, type StigmerProviderProps } from "./provider.js";
export type { MermaidLoader, MermaidModule } from "./mermaid-loader-context.js";

// Fetch cache
export { FetchCacheProvider } from "./internal/FetchCacheProvider.js";

// Deployment mode and resource availability
export { CloudFeatureNotice, type CloudFeatureNoticeProps } from "./internal/CloudFeatureNotice.js";

// Models — data hook, styled components, and registry data
export {
  ModelSelector,
  HarnessSelector,
  ModelsHub,
  ProviderCard,
  ProviderKeyForm,
  ModelDefaults,
  ConnectProviderPanel,
  ModelNeedsProvider,
  SetupCommand,
} from "./models/index.js";
export type {
  ModelSelectorProps,
  HarnessSelectorProps,
  ModelsHubProps,
  ProviderCardProps,
  SetupCommandProps,
  ProviderKeyFormProps,
  ModelDefaultsProps,
  ConnectProviderPanelProps,
  ModelNeedsProviderProps,
} from "./models/index.js";

// Workspace — behavior hooks and styled components
export {
  WorkspaceEditor,
  WorkspaceFileSearch,
  WorkspaceContentSearch,
  WorkspaceSummary,
  FileViewer,
  WorkspaceSurface,
  PanelChip,
  ExplorerTree,
} from "./workspace/index.js";
export type {
  WorkspaceFileSearchProps,
  WorkspaceContentSearchProps,
  FileViewerProps,
  WorkspaceEditorProps,
  WorkspaceSummaryProps,
  WorkspaceSurfaceProps,
  PanelChipProps,
  ExplorerTreeProps,
} from "./workspace/index.js";

// Session — data hooks, behavior hooks, utilities (Session aggregate + conversation lifecycle)
export {
  useExportTranscript,
  TranscriptExportMenu,
  AgentVersionNotice,
  SessionViewer,
  SessionInspector,
  NewSessionViewer,
  SessionViewerLayout,
  useSessionRailViews,
  PlanEditor,
  PlanStreamingDocument,
  SetupTab,
} from "./session/index.js";
export type {
  TranscriptExportMenuProps,
  AgentVersionNoticeProps,
  SessionViewerProps,
  SessionInspectorProps,
  NewSessionViewerProps,
  SessionViewerLayoutProps,
  PlanEditorProps,
  PlanStreamingDocumentProps,
  SetupTabProps,
} from "./session/index.js";

// Run — behavior hooks, styled components, and utilities (Run aggregate)
export {
  RunPhaseBadge,
  InteractionModeBadge,
  SetupProgress,
  LivenessStatusLine,
  RunProgress,
  TodoList,
  TodoCard,
  TodoInProgressIcon,
  UsageWidget,
  SummarizationCard,
  RecalledMemoriesCard,
  PlanCompletionCard,
  PlanFileCard,
  PlanStreamingCard,
  PlanDocumentMessage,
  ToolCallGroup,
  ToolCallDetail,
  ResultView,
  TerminalSession,
  TerminalTail,
  McpToolDetail,
  ToolCallItem,
  SubagentSection,
  MessageEntry,
  MessageThread,
  RunErrorNotice,
  ThreadSkeleton,
  FollowUpInput,
  ApprovalCard,
  ApprovalCardHeader,
  ApprovalCardBody,
  FileReviewCard,
  FileReviewDock,
  FileChangeProgressBar,
  BackgroundCommandTrail,
  FileRow,
  FileRowView,
  TextContentRenderer,
  FileBody,
  FileDeleteAction,
  FileAddAsSkillAction,
  TextContentView,
  FileDocument,
  FilePreviewContent,
  FilePreviewModal,
  WriteBacksWidget,
  ToolArgsView,
  McpArgsView,
  McpMetadataRow,
  FilePathLink,
  WriteBackCard,
  FileChangesView,
  FileChangeDiff,
  EmptyChangeNotice,
} from "./run/index.js";
export type {
  RunPhaseBadgeProps,
  InteractionModeBadgeProps,
  SetupProgressProps,
  LivenessStatusLineProps,
  RunProgressProps,
  TodoListProps,
  TodoCardProps,
  UsageWidgetProps,
  SummarizationCardProps,
  RecalledMemoriesCardProps,
  PlanCompletionCardProps,
  PlanFileCardProps,
  PlanStreamingCardProps,
  PlanDocumentMessageProps,
  ToolCallGroupProps,
  ToolCallDetailProps,
  ResultViewProps,
  TerminalSessionProps,
  TerminalTailProps,
  McpToolDetailProps,
  McpArgsViewProps,
  McpMetadataRowProps,
  ToolArgsViewProps,
  ToolCallItemProps,
  SubagentSectionProps,
  MessageEntryProps,
  MessageThreadProps,
  RunErrorNoticeProps,
  ThreadSkeletonProps,
  FollowUpInputProps,
  ApprovalCardProps,
  ApprovalCardHeaderProps,
  ApprovalCardBodyProps,
  FileReviewCardProps,
  FileReviewDockProps,
  FileChangeProgressBarProps,
  FileRowProps,
  FileRowViewProps,
  TextContentRendererProps,
  FileBodyProps,
  FileDeleteActionProps,
  FileAddAsSkillActionProps,
  TextContentViewProps,
  FileDocumentProps,
  FilePreviewContentProps,
  FilePreviewModalProps,
  WriteBacksWidgetProps,
  FilePathLinkProps,
  WriteBackCardProps,
  FileChangesViewProps,
  FileChangeDiffProps,
  EmptyChangeNoticeProps,
} from "./run/index.js";

// Upload — the chat box's file uploads (Stigmer Files), styled chip list,
// clipboard paste, vision-resolution image preparation, and vision
// preflight warnings
export { FileChipList } from "./upload/index.js";
export type { FileChipListProps } from "./upload/index.js";

// File — one Stigmer File's record, link and download; the Library's Files
export {
  createFileColumns,
  FileUploadButton,
  FilePicker,
  LibraryFilePreview,
} from "./file/index.js";
export type {
  FileUploadButtonProps,
  FilePickerProps,
  LibraryFilePreviewProps,
} from "./file/index.js";

// File Reference — workspace file-reference behavior hook and styled chip list
export { FileReferenceChipList } from "./file-reference/index.js";
export type { FileReferenceChipListProps } from "./file-reference/index.js";

// Composer — unified message input with model, workspace, and file uploads
export { SessionComposer, PersonalKeyDisclosure, InteractionModePicker } from "./composer/index.js";
export type {
  SessionComposerProps,
  PersonalKeyDisclosureProps,
  InteractionModePickerProps,
} from "./composer/index.js";

// Skill — data hooks, upload, file browser, and mutation
export {
  SkillPicker,
  SkillDetailView,
  SkillUploader,
  SkillFileBrowser,
  SkillDiffDialog,
} from "./skill/index.js";
export type {
  SkillPickerProps,
  SkillDetailViewProps,
  SkillDiffDialogProps,
  SkillUploaderProps,
  SkillFileBrowserProps,
} from "./skill/index.js";

// Plugin — the installed kind's data hooks, the marketplace layer a browser reads, install, "Add MCP server", detail view, a server's sign-in and tools, the picker, and the "installed by a plugin" rule
export {
  PluginDetailView,
  PluginServerRow,
  PluginPicker,
  MarketplaceCatalog,
  PluginCard,
  UploadTile,
  PluginFace,
  SourceMark,
  SourceChips,
  ManageSourcesDialog,
  PluginUploader,
  PluginInstallDialog,
  PluginServerSignIn,
  PluginServerSignIns,
  AddMcpServerDialog,
  HeaderRowsEditor,
  AddPluginToAgentDialog,
  HookConfigList,
  InstallPreview,
  PrepareRefusal,
  ManagedByPluginNotice,
  PluginIcon,
} from "./plugin/index.js";
export type {
  InstallPreviewProps,
  PluginDetailViewProps,
  PluginServerRowProps,
  PluginPickerProps,
  PluginServerSignInProps,
  PluginServerSignInsProps,
  AddMcpServerDialogProps,
  HeaderRowsEditorProps,
  AddPluginToAgentDialogProps,
  HookConfigListProps,
  MarketplaceCatalogProps,
  PluginCardProps,
  UploadTileProps,
  PluginFaceProps,
  SourceMarkProps,
  SourceChipsProps,
  ManageSourcesDialogProps,
  PluginUploaderProps,
  PluginInstallDialogProps,
  ManagedByPluginNoticeProps,
} from "./plugin/index.js";

// GitHub — OAuth connection, repo picker, tree lister, and hooks
export { GitHubRepoPicker } from "./github/index.js";
export type { GitHubRepoPickerProps } from "./github/index.js";

// Agent — data hook, count hook, list hook, search hook, picker, detail view, versions, env form, setup orchestration, env diffing, creation wizard, update
export {
  AgentPicker,
  AgentDetailView,
  AgentVersionsTab,
  AgentQualityTab,
  AgentEnvForm,
  AgentCreationWizard,
  AgentCreationDenied,
  AgentMcpServersSection,
} from "./agent/index.js";
export type {
  AgentPickerProps,
  AgentDetailViewProps,
  AgentVersionsTabProps,
  AgentQualityTabProps,
  AgentEnvFormProps,
  AgentCreationWizardProps,
  AgentCreationDeniedProps,
  AgentMcpServersSectionProps,
} from "./agent/index.js";

// Routine — the disabled-vs-paused state derivation, the direct-query
// list core + workbench adapter (routines are not search-backed), data
// hooks (get by reference, paginated list, count), behavior hooks
// (create via apply, resume, trigger once, owner enable/disable and
// per-field spec edits via lossless manifest apply), the cadence model
// (preset ⇄ cron, no cron parsing — recognition of builder-emitted
// shapes only), the cadence builder, the creation form, the tabbed
// detail view with inline editing, the paginated run-history table, the
// Run now dialog with its note, and the API panel with its curl
export {
  useResumeRoutine,
  useFireRoutine,
  useSetRoutineEnabled,
  useUpdateRoutineSpec,
  createRoutineColumns,
  CadenceField,
  RoutineForm,
  RoutineRowActions,
  RoutineDetailView,
  RoutineIcon,
  RoutineFiresTable,
  RunRoutineDialog,
  RoutineApiPanel,
} from "./routine/index.js";
export type {
  CadenceFieldProps,
  RoutineFormProps,
  RoutineRowActionsProps,
  RoutineDetailViewProps,
  RoutineFiresTableProps,
  RunRoutineDialogProps,
  RoutineApiPanelProps,
} from "./routine/index.js";

// Environment — the packages and network a conversation's sandbox gets:
// which one applies and why (the server's order, previewed), the words for
// it, the list, the picker, and whether Environments apply here at all
export {
  EnvironmentPicker,
  createEnvironmentColumns,
  NetworkingFields,
  PackagesFields,
  EnvironmentForm,
  EnvironmentDetailView,
  EnvironmentIcon,
  EnvironmentsNotOnServerNotice,
  EnvironmentCreationDenied,
} from "./environment/index.js";
export type {
  EnvironmentPickerProps,
  NetworkingFieldsProps,
  PackagesFieldsProps,
  EnvironmentFormProps,
  EnvironmentDetailViewProps,
  EnvironmentsNotOnServerNoticeProps,
  EnvironmentCreationDeniedProps,
} from "./environment/index.js";

// Vault — My vault and shared vaults (entry names only; values are write-only), the vault picker, the credential form, the session value pool, the platform-filled key set, and the address rule
export {
  VaultEntriesEditor,
  VaultListPanel,
  CreateVaultForm,
  VaultPicker,
  EnvVarForm,
  OAuthCallbackHandler,
} from "./vault/index.js";
export type {
  VaultEntriesEditorProps,
  VaultListPanelProps,
  CreateVaultFormProps,
  VaultPickerProps,
  EnvVarFormProps,
  OAuthCallbackHandlerProps,
} from "./vault/index.js";

// Identity Account — gate hook, self-account data/mutation hooks, the
// account preferences editor, and the composer-seeding execution defaults
export { AccountPreferencesPanel } from "./identity-account/index.js";
export type { AccountPreferencesPanelProps } from "./identity-account/index.js";

// Memory — agent-proposed, user-confirmed facts: data hook, decision
// hooks (confirm/reject/delete/edit), grouping helpers, and the list panel
export { MemoryListPanel, MemoryProposalCardBody } from "./memory/index.js";
export type { MemoryListPanelProps, MemoryProposalCardBodyProps } from "./memory/index.js";

// Scores — a person's thumbs on a run's final answer, the platform's free
// run-health checks, an AI judge's verdict and an eval run's checks, shown
// on every completed run its viewers can see
export { RunScores, AgentQualityReportView } from "./score/index.js";
export type { RunScoresProps, AgentQualityReportViewProps } from "./score/index.js";

// Charts — small inline-SVG charts drawn from the theme's chart tokens, with
// no charting dependency and a screen-reader table of their data
export { TrendChart } from "./charts/index.js";
export type { TrendChartProps } from "./charts/index.js";

// Eval runs — test cases run on an agent, or a plugin's own cases on the
// built-in assistant, optionally with and without a plugin (the Evals tab
// of an agent and of a plugin), two eval runs compared side by side, and a
// run made into a test case
export { EvalRunsTab, EvalRunResults } from "./eval-run/index.js";
export type { EvalRunsTabProps, EvalRunResultsProps } from "./eval-run/index.js";

// Grant — data hooks, behavior hooks, headless hook, and styled components for access management
export {
  RoleSelector,
  PrincipalPicker,
  ProviderBadge,
  GrantAccessForm,
  PeopleWithAccess,
  OrgMembersPanel,
  SharePanel,
} from "./grant/index.js";
export type {
  RoleSelectorProps,
  PrincipalPickerProps,
  ProviderBadgeProps,
  GrantAccessFormProps,
  PeopleWithAccessProps,
  OrgMembersPanelProps,
  SharePanelProps,
  PermissionGateProps,
} from "./grant/index.js";

// Access — unified "Manage access" experience (visibility + people) as one
// dialog, with a kebab hook and a visible-button trigger.
export { ManageAccessDialog, ManageAccessButton, useManageAccess } from "./access/index.js";
export type { ManageAccessDialogProps, ManageAccessButtonProps } from "./access/index.js";

// Organization — context provider, hooks, data hooks, behavior hooks, styled form, profile panel, org switcher, and child organizations
export {
  OrgProvider,
  OrgSlugText,
  CreateOrganizationForm,
  OrgProfilePanel,
  OrgPreferencesPanel,
  OrgPoliciesPanel,
  OrgEmbeddingPanel,
  OrgSwitcher,
  ChildOrganizationsList,
} from "./organization/index.js";
export type {
  OrgSlugTextProps,
  CreateOrganizationFormProps,
  OrgProfilePanelProps,
  OrgPreferencesPanelProps,
  OrgPoliciesPanelProps,
  OrgEmbeddingPanelProps,
  OrgSwitcherProps,
  ChildOrganizationsListProps,
} from "./organization/index.js";

// Billing — customer-facing data hooks, behavior hooks, styled components
// and formatting utilities
export {
  PlanSection,
  PlanCard,
  PlanPicker,
  ChangePlanDialog,
  UpgradeNotice,
  ProviderKeyNotice,
  AgentHoursNotice,
  AgentHoursStanding,
  BillingSection,
  PaymentMethodCard,
} from "./billing/index.js";
export type {
  PlanSectionProps,
  PlanCardProps,
  PlanPickerProps,
  ChangePlanDialogProps,
  UpgradeNoticeProps,
  ProviderKeyNoticeProps,
  AgentHoursNoticeProps,
  AgentHoursStandingProps,
  BillingSectionProps,
  PaymentMethodCardProps,
} from "./billing/index.js";

// API Key — data hooks, behavior hooks, and styled components for API key lifecycle
export { ApiKeyListPanel, CreateApiKeyForm, ApiKeyCreatedAlert } from "./api-key/index.js";
export type {
  ApiKeyListPanelProps,
  CreateApiKeyFormProps,
  ApiKeyCreatedAlertProps,
} from "./api-key/index.js";

// Service Account — an organization's own accounts for automation and their API keys
export {
  ServiceAccountListPanel,
  ServiceAccountDetailPanel,
  ServiceAccountKeyListPanel,
  CreateServiceAccountForm,
  CreateServiceAccountKeyForm,
} from "./service-account/index.js";
export type {
  ServiceAccountListPanelProps,
  ServiceAccountDetailPanelProps,
  ServiceAccountKeyListPanelProps,
  CreateServiceAccountFormProps,
  CreateServiceAccountKeyFormProps,
} from "./service-account/index.js";

// OAuth App — data hooks, mutation hooks, and styled components for OAuth app management
export { OAuthAppListPanel, CreateOAuthAppForm, OAuthAppDetailPanel } from "./oauth-app/index.js";
export type {
  OAuthAppListPanelProps,
  CreateOAuthAppFormProps,
  OAuthAppDetailPanelProps,
} from "./oauth-app/index.js";

// Channel App — data hooks, mutation hooks, styled components, and Slack
// setup helpers for bring-your-own channel apps
export {
  ChannelAppListPanel,
  CreateChannelAppForm,
  ChannelAppDetailPanel,
} from "./channel-app/index.js";
export type {
  ChannelAppListPanelProps,
  CreateChannelAppFormProps,
  ChannelAppDetailPanelProps,
} from "./channel-app/index.js";

// Federation Issuer — data hooks, mutation hooks, styled components, presets, and guided wizard for managing the platforms whose tokens an organization trusts
export {
  FederationIssuerListPanel,
  CreateFederationIssuerForm,
  ProviderPicker,
  FederationIssuerWizard,
  FederationIssuerDetailPanel,
} from "./federation-issuer/index.js";
export type {
  FederationIssuerListPanelProps,
  CreateFederationIssuerFormProps,
  ProviderPickerProps,
  FederationIssuerWizardProps,
  FederationIssuerDetailPanelProps,
} from "./federation-issuer/index.js";

// Teams — an organization's named groups of people that access is shared
// with as one (Enterprise and Cloud editions)
export { TeamListPanel, CreateTeamForm, TeamMembersPanel, TeamDetailPanel } from "./team/index.js";
export type {
  TeamListPanelProps,
  CreateTeamFormProps,
  TeamMembersPanelProps,
  TeamDetailPanelProps,
} from "./team/index.js";

// Invitation — data hooks, behavior hooks, and feature components for org invite links
export {
  InvitationCreatedAlert,
  InvitationManager,
  InvitationRedemption,
} from "./invitation/index.js";
export type {
  InvitationCreatedAlertProps,
  InvitationManagerProps,
  InvitationRedemptionProps,
} from "./invitation/index.js";

// Connect links — the public page a Connect link opens and its callback
export { ConnectLinkView, ConnectLinkCallback } from "./connect-link/index.js";
export type { ConnectLinkViewProps, ConnectLinkCallbackProps } from "./connect-link/index.js";

// Chat links — a web channel's public agent profile, the chat a link's
// visitors see, and the owner's chat-link dialog with the web channel draft
// and its save inputs. The agent's Channels tab lists the links
// (ChannelsPanel, below).
export { VisitorChat, ChatLinkDialog } from "./chat-link/index.js";
export type { VisitorChatProps, ChatLinkDialogProps } from "./chat-link/index.js";

// Channel — the one kind for every way people reach an agent (chat links,
// Slack, WhatsApp): the Channel hooks, the add-a-channel behaviour, the
// Channels tab panel (every type in one list), and the per-provider connect
// dialogs.
export {
  useAddChannelOptions,
  ChannelsPanel,
  ConnectSlackDialog,
  ConnectWhatsAppDialog,
  ChannelCredentialsDialog,
  ChannelRunConfigDialog,
  ChannelToolCredentials,
  ChannelConversationsDialog,
  ChannelTemplatesDialog,
} from "./channel/index.js";
export type {
  ChannelsPanelProps,
  ConnectSlackDialogProps,
  ConnectWhatsAppDialogProps,
  ChannelCredentialsDialogProps,
  ChannelRunConfigDialogProps,
  ChannelToolCredentialsProps,
  ChannelConversationsDialogProps,
  ChannelTemplatesDialogProps,
} from "./channel/index.js";

// Conversation — the channel conversation surface: the org-wide list, one
// conversation's row and timeline, the participation commands (reply / takeOver
// / handBack / clearAttention), and the pure render vocabulary shared by every
// conversation view.
export {
  ConversationsWorkbench,
  ConversationListPane,
  ConversationTimelineView,
  ConversationControlBanner,
  ConversationAttentionBanner,
  ConversationComposer,
  ConversationTemplatePickerDialog,
} from "./conversation/index.js";
export type {
  ConversationsWorkbenchProps,
  ConversationListPaneProps,
  ConversationTimelineViewProps,
  ConversationControlBannerProps,
  ConversationAttentionBannerProps,
  ConversationComposerProps,
  ConversationTemplatePickerDialogProps,
} from "./conversation/index.js";

// Error — structured error display with classification, retry, and contextual guidance
export { ErrorMessage, SecretFlowErrorGuide } from "./error/index.js";
export type { ErrorMessageProps, SecretFlowErrorGuideProps } from "./error/index.js";

// Library — cross-resource UI components, resource detection, apply flow, browsing, and visibility management
export {
  LibraryBreadcrumbProvider,
  ResourceCountCard,
  useExportResource,
  VisibilitySelector,
  VisibilityBadge,
} from "./library/index.js";
export type {
  ResourceCountCardProps,
  VisibilitySelectorProps,
  VisibilityBadgeProps,
} from "./library/index.js";

// Manifest — kind-agnostic YAML edit/apply (editor, hooks, dialogs)
export {
  YamlEditor,
  EditResourceYamlDialog,
  ApplyManifestDialog,
  RedactedSecretsNotice,
} from "./manifest/index.js";
export type {
  YamlEditorDiagnostic,
  YamlEditorProps,
  EditResourceYamlDialogProps,
  ApplyManifestDialogProps,
  RedactedSecretsNoticeProps,
} from "./manifest/index.js";

// Action menu — compound component for resource item actions
export { ActionMenu } from "./action-menu/index.js";
export type {
  ActionMenuProps,
  ActionMenuTriggerProps,
  ActionMenuContentProps,
  ActionMenuItemProps,
  ActionMenuSeparatorProps,
  ActionMenuGroupProps,
} from "./action-menu/index.js";

// Feedback — toast notification system wrapping Sonner
export { StigmerToaster, toast } from "./feedback/index.js";
export type { StigmerToasterProps } from "./feedback/index.js";

// Empty state — reusable empty/zero/permission/error state primitives
export { EmptyState, useEmptyState } from "./empty-state/index.js";
export type { EmptyStateProps } from "./empty-state/index.js";

// Usage — org-level usage report hook, dashboard panel, and date-range utilities
export {
  OrgUsagePanel,
  AgentBreakdownList,
  HarnessSplitCard,
  ExportButton,
} from "./usage/index.js";
export type {
  OrgUsagePanelProps,
  AgentBreakdownListProps,
  HarnessSplitCardProps,
  ExportButtonProps,
} from "./usage/index.js";

// Tabs — accessible tabbed panel primitive
export { Tabs } from "./tabs/index.js";
export type { TabsProps } from "./tabs/index.js";

// Switch — accessible on/off toggle primitive (WAI-ARIA Switch pattern)
export { Switch } from "./switch/index.js";
export type { SwitchProps } from "./switch/index.js";

// Button — shared action primitive (variants for the console's action tiers)
export { Button } from "./button/index.js";
export type { ButtonProps } from "./button/index.js";

// Resource Detail — headless hooks, action bar, and composed shell for resource detail pages
export {
  useCopyResource,
  useDeleteResource,
  ResourceActionBar,
  ResourceDetailShell,
  Section,
  ConfirmDialog,
  RenameSlugField,
  ResourceSlugField,
} from "./resource-detail/index.js";
export type {
  ResourceDetailShellProps,
  SectionProps,
  RenameSlugFieldProps,
  ResourceSlugFieldProps,
  ResourceActionBarProps,
  ConfirmDialogProps,
} from "./resource-detail/index.js";

// Resource Creation — shared wizard infrastructure for multi-step creation flows
export {
  WizardShell,
  WizardNav,
  StepIndicator,
  TemplateCard,
  TemplateGallery,
  CreationPicker,
} from "./resource-creation/index.js";
export type {
  WizardShellProps,
  WizardNavProps,
  StepIndicatorProps,
  TemplateCardProps,
  TemplateGalleryProps,
  CreationPickerProps,
} from "./resource-creation/index.js";

// Dependency Graph — visual tree of agent dependencies (plugins, skills, subagents)
export { DependencyGraph } from "./dependency-graph/index.js";
export type { DependencyGraphProps } from "./dependency-graph/index.js";

// Version History — generic timeline, diff infrastructure for versioned resources
export {
  VersionTimeline,
  VersionTimelineEntry,
  DiffViewer,
  DiffFileList,
  DiffSummary,
  MultiFileDiffView,
} from "./version-history/index.js";
export type {
  VersionTimelineProps,
  VersionTimelineEntryProps,
  DiffViewerProps,
  DiffFileListProps,
  DiffSummaryProps,
  MultiFileDiffViewProps,
} from "./version-history/index.js";

// Inline Edit — click-to-edit field primitives for detail page inline editing
export {
  InlineEditText,
  InlineEditTextarea,
  InlineEditImage,
  InlineEditSelect,
  InlineEditKeyValue,
  InlineEditResourceList,
} from "./inline-edit/index.js";
export type {
  InlineEditTextProps,
  InlineEditTextareaProps,
  InlineEditImageProps,
  InlineEditSelectProps,
  InlineEditKeyValueProps,
  InlineEditResourceListProps,
  InlineEditBaseProps,
} from "./inline-edit/index.js";

// Resource Workbench — headless hooks, view components, and composed shell for resource collection management
export {
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
} from "./resource-workbench/index.js";
export type {
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
} from "./resource-workbench/index.js";

// ─── Dashboard (Unified Platform) ──────────────────────────────────────────
export {
  // Styled Components
  DashboardKPICards,
  type DashboardKPICardsProps,
  DashboardFailedRuns,
  type DashboardFailedRunsProps,
  OperationalDashboard,
  type OperationalDashboardProps,
} from "./dashboard/index.js";
