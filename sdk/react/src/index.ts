// Provider and context
export { StigmerProvider, type StigmerProviderProps } from "./provider.js";
export { type ApprovalDefaults } from "./approval-defaults-context.js";
export { StigmerContext } from "./context.js";

// Runner adapter
export { type RunnerAdapter, useRunnerAdapter } from "./runner-adapter.js";
// Construction helper lives in @stigmer/sdk (framework-agnostic); re-exported
// here so React embedders import it alongside the adapter interface.
export { type RunnerWorkerHost, createRunnerAdapter } from "@stigmer/sdk";

// Fetch cache
export { FetchCacheProvider } from "./internal/FetchCacheProvider.js";
export type { FetchCacheOptions } from "./internal/fetch-cache.js";

// Hooks
export { useStigmer } from "./hooks.js";

// Color mode
export { ColorModeContext, useColorMode } from "./color-mode.js";
export type { ColorMode, ResolvedColorMode } from "./color-mode.js";

// Portal container
export { useStigmerPortalContainer } from "./portal-container.js";

// Server identity: edition, version and authentication posture
export { useServerInfo, useSingleOrg } from "./server-info.js";
export type { UseServerInfoReturn } from "./server-info.js";

// Deployment mode and resource availability
export {
  DeploymentModeContext,
  useDeploymentMode,
  useResourceAvailable,
} from "./deployment-mode.js";
export {
  type DeploymentMode,
  isResourceAvailable,
  ApiResourceKind,
} from "@stigmer/sdk";
export {
  CloudFeatureNotice,
  type CloudFeatureNoticeProps,
} from "./internal/CloudFeatureNotice.js";

// Models — data hook, styled components, and registry data
export {
  DEFAULT_MODEL_ID,
  DEFAULT_CURSOR_MODEL_ID,
  DISABLED_PROVIDERS,
  modelKey,
  parseModelKey,
  fetchModelRegistry,
  fetchModelRegistryDocument,
  parseRegistryJson,
  parseRegistryDocument,
  useModelRegistry,
  ModelRegistryContext,
  ModelSelector,
  HarnessSelector,
  DEFAULT_HARNESS,
  HARNESS_LABELS,
  toProtoHarness,
  fromProtoHarness,
  thinkingSelectable,
  thinkingLocked,
} from "./models/index.js";
export type {
  ModelInfo,
  ModelRegistryDocument,
  ModelRegistryState,
  ParsedModelKey,
  Provider,
  CostTier,
  UseModelRegistryReturn,
  UseModelRegistryOptions,
  InheritedModel,
  ModelSelectorProps,
  HarnessSelectorProps,
  HarnessOption,
  VisionLimits,
} from "./models/index.js";

// Workspace — behavior hooks and styled components
export {
  useWorkspaceEntries,
  useWorkspaceFiles,
  useWorkspaceFileContent,
  useWorkspaceFileSearch,
  useWorkspaceContentSearch,
  useWorkspaceSources,
  MAX_WORKSPACE_FILE_READ_BYTES,
  MAX_WORKSPACE_IMAGE_READ_BYTES,
  WorkspaceFileNotFoundError,
  workspaceImageMimeType,
  WorkspaceEditor,
  WorkspaceFileSearch,
  WorkspaceContentSearch,
  WorkspaceSummary,
  FileViewer,
  WorkspaceSurface,
  PanelChip,
  ExplorerTree,
  virtualEntryId,
  isVirtualEntryId,
} from "./workspace/index.js";
export type {
  WorkspaceEntry,
  WorkspaceFileEntry,
  WorkspaceFileLister,
  WorkspaceFileContent,
  WorkspaceFileReader,
  UseWorkspaceEntriesReturn,
  UseWorkspaceFilesOptions,
  UseWorkspaceFilesReturn,
  UseWorkspaceFileContentOptions,
  UseWorkspaceFileContentReturn,
  UseWorkspaceFileSearchOptions,
  UseWorkspaceFileSearchReturn,
  WorkspaceFileSearchGroup,
  WorkspaceFileMatch,
  WorkspaceFileSearchProps,
  WorkspaceContentMatch,
  WorkspaceContentSearchResult,
  WorkspaceContentSearcher,
  UseWorkspaceContentSearchOptions,
  UseWorkspaceContentSearchReturn,
  WorkspaceContentSearchGroup,
  WorkspaceContentSearchProps,
  FileViewerProps,
  FileViewerHandle,
  SelectedWorkspaceFile,
  UseWorkspaceSourcesOptions,
  UseWorkspaceSourcesReturn,
  WorkspaceEditorProps,
  WorkspaceSummaryProps,
  WorkspaceSurfaceProps,
  SurfaceRailView,
  SurfaceVirtualDocument,
  BuiltInViewId,
  PanelChipProps,
  ExplorerTreeProps,
  OpenEditor,
  OpenFileOptions,
  RevealTarget,
} from "./workspace/index.js";

// Session — data hooks, behavior hooks, utilities (Session aggregate + conversation lifecycle)
export {
  useCreateSession,
  useUpdateSession,
  useSession,
  useSessionList,
  useSessionRuns,
  useSessionConversation,
  useExportTranscript,
  TranscriptExportMenu,
  useSessionArtifacts,
  artifactKey,
  useSessionWriteBacks,
  useWorkspaceReadRefs,
  useSessionFileChanges,
  useSessionUsage,
  agentRefOfSession,
  isSameAgent,
  useSessionAgentVersion,
  AgentVersionNotice,
  useNewSessionFlow,
  useSessionPageFlow,
  usePersistedModel,
  groupSessionsByTime,
  groupSearchResultsByTime,
  useSessionSearch,
  BUILT_IN_ASSISTANT_NAME,
  PENDING_SUBJECT,
  isBuiltInAssistant,
  resolvedSubject,
  CHANNEL_SESSION_LABELS,
  isChannelOriginSession,
  channelSessionExternalUserKey,
  SessionViewer,
  NewSessionViewer,
  SessionViewerLayout,
  useSessionPanel,
  useSessionRailViews,
  usePlanDraft,
  planDraftKey,
  PlanEditor,
  PlanStreamingDocument,
  PLAN_DOCUMENT_ENTRY_ID,
  PLAN_DOCUMENT_PATH,
  ARTIFACT_DOCUMENT_ENTRY_ID,
  SetupTab,
} from "./session/index.js";
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
  UseSessionRunsReturn,
  SendFollowUpOptions,
  UseSessionConversationReturn,
  UseExportTranscriptOptions,
  UseExportTranscriptReturn,
  TranscriptExportMenuProps,
  SessionArtifactEntry,
  UseSessionArtifactsReturn,
  SessionWriteBackEntry,
  UseSessionWriteBacksReturn,
  UseSessionFileChangesReturn,
  ModelCostEntry,
  UseSessionUsageReturn,
  RunUsageEntry,
  UseSessionAgentVersionOptions,
  UseSessionAgentVersionReturn,
  AgentVersionNoticeProps,
  UseNewSessionFlowOptions,
  UseNewSessionFlowReturn,
  UseSessionPageFlowOptions,
  UseSessionPageFlowReturn,
  UsePersistedModelOptions,
  UsePersistedModelReturn,
  SessionGroup,
  SearchResultGroup,
  SessionViewerProps,
  NewSessionViewerProps,
  SessionViewerLayoutProps,
  SessionPanelController,
  UseSessionPanelOptions,
  UseSessionRailViewsOptions,
  PlanDraftController,
  PlanEditorProps,
  PlanStreamingDocumentProps,
  ExecutionTargetOption,
  SessionAudience,
  SessionPanelMode,
  // The #664 pinning seam's contract type: SessionViewer/NewSessionViewer/
  // useNewSessionFlow all accept it, and the docs name it — embedders must
  // be able to import it from the root (oss#802; the exports map exposes no
  // ./session subpath on purpose).
  SessionRunConfig,
  SetupTabProps,
  SetupTabMutationCallbacks,
  SetupTabAutoApprove,
} from "./session/index.js";

// Activity — recent sessions for the sidebar recents section
export {
  useRecentActivity,
  groupRecentActivityByTime,
  formatRelativeTime,
} from "./activity/index.js";
export type {
  RecentActivityEntry,
  RecentActivityGroup,
  UseRecentActivityOptions,
  UseRecentActivityReturn,
} from "./activity/index.js";

// Run — behavior hooks, styled components, and utilities (Run aggregate)
export {
  isTerminalPhase,
  useCreateRun,
  useRunStream,
  useLiveRun,
  useRunActions,
  useResolveRunSession,
  useSubmitApproval,
  useFileReview,
  fileDecisionKey,
  fileReviewability,
  changeSetReviewability,
  deriveEffectiveVerdicts,
  changeForRowPath,
  fileReviewRowState,
  fileReviewRowChange,
  foldFileReviewEventStream,
  displayFileChangeSets,
  toDisplayFileChange,
  RunPhaseBadge,
  InteractionModeBadge,
  SetupProgress,
  LivenessStatusLine,
  RunProgress,
  TodoList,
  TodoCard,
  TodoInProgressIcon,
  findActiveTodo,
  todoCompletionSummary,
  UsageWidget,
  ContextGauge,
  SummarizationBadge,
  SummarizationCard,
  RecalledMemoriesCard,
  resolveInjectedFacts,
  PlanCompletionCard,
  PlanArtifactCard,
  PlanStreamingCard,
  PlanDocumentMessage,
  useContextWindow,
  formatCost,
  formatTokenCount,
  ToolCallGroup,
  ToolCallDetail,
  ResultView,
  summarizeResultView,
  TerminalSession,
  TerminalTail,
  useToolPresentation,
  registerToolPresenter,
  getToolPresenter,
  resolveToolCategory,
  resolveToolCategoryFromCall,
  resolveToolCategoryFromKind,
  toolKindToCategoryInfo,
  defaultDisclosureForCategory,
  extractPrimaryArg,
  extractShellIntent,
  extractShellIntentFromPreview,
  SHELL_INTENT_ARG_FIELD,
  McpToolDetail,
  parseMcpResult,
  formatDuration,
  humanizeToolName,
  ToolCallItem,
  SubAgentSection,
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
  ApprovalContext,
  useApproval,
  FileReviewContext,
  useFileReviewRowState,
  useFileReviewRowChange,
  ArtifactRow,
  ArtifactRowView,
  fromRunArtifact,
  ArtifactContentRenderer,
  ArtifactContentBody,
  ArtifactFileContent,
  ArtifactDocument,
  useArtifactInspection,
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
  useRunArtifacts,
  useArtifactContent,
  useArtifactDownloadUrl,
  useArtifactDownload,
  useArtifactCopy,
  useToolOutputContent,
  useFileChangeContent,
  runIdFromStorageKey,
  useWorkspaceWriteBacks,
  WriteBackCard,
  parseDiffStatSummary,
  trailingDiffStatLine,
  writeBackDisplayName,
  FileChangesView,
  FileChangeDiff,
  deriveRunFileChanges,
  toFileDiffEntry,
  EmptyChangeNotice,
  isTextArtifact,
  formatArtifactSize,
  getArtifactExtension,
  getFileExtension,
  getArtifactRenderMode,
} from "./run/index.js";
export type {
  BootstrapSessionSpec,
  CreateRunInput,
  CreateRunResult,
  SharedRunFields,
  UseCreateRunReturn,
  UseRunStreamReturn,
  UseLiveRunOptions,
  UseLiveRunReturn,
  UseRunActionsOptions,
  UseRunActionsReturn,
  UseResolveRunSessionReturn,
  UseSubmitApprovalReturn,
  UseFileReviewReturn,
  FileDecisionOptions,
  FileReviewability,
  FileBlockReason,
  ChangeSetReviewability,
  FileReviewRowState,
  RunPhaseBadgeProps,
  InteractionModeBadgeProps,
  SetupProgressProps,
  LivenessStatusLineProps,
  RunProgressProps,
  TodoListProps,
  TodoCardProps,
  UsageWidgetProps,
  ContextGaugeProps,
  SummarizationBadgeProps,
  SummarizationCardProps,
  RecalledMemoriesCardProps,
  PlanCompletionCardProps,
  PlanArtifactCardProps,
  PlanStreamingCardProps,
  PlanDocumentMessageProps,
  ContextHealth,
  SummarizationEventView,
  UseContextWindowReturn,
  ToolCallGroupProps,
  ToolCallDetailProps,
  ResultViewProps,
  TerminalSessionProps,
  TerminalTailProps,
  ToolPresentation,
  ToolPresenter,
  ToolDisclosure,
  McpToolDetailProps,
  McpArgsViewProps,
  McpMetadataRowProps,
  ToolArgsViewProps,
  ToolCallItemProps,
  SubAgentSectionProps,
  MessageEntryProps,
  MessageThreadProps,
  MessageThreadSlots,
  RunErrorNoticeProps,
  ThreadContentColumn,
  ThreadSkeletonProps,
  FollowUpInputProps,
  ApprovalCardProps,
  ApprovalCardHeaderProps,
  ApprovalCardBodyProps,
  FileReviewCardProps,
  FileReviewDockProps,
  FileChangeProgressBarProps,
  ApprovalContextValue,
  UseApprovalResult,
  FileReviewContextValue,
  ArtifactRowProps,
  ArtifactRowViewProps,
  ArtifactRowItem,
  ArtifactContentRendererProps,
  ArtifactContentBodyProps,
  ArtifactFileContentProps,
  ArtifactDocumentProps,
  ArtifactInspection,
  UseArtifactInspectionOptions,
  ArtifactRenderMode,
  ArtifactPreviewContentProps,
  ArtifactPreviewModalProps,
  ArtifactsWidgetProps,
  WriteBacksWidgetProps,
  FilePathLinkProps,
  FilePathContextValue,
  PathClassification,
  ResolvedPathAction,
  UseRunArtifactsReturn,
  UseArtifactContentReturn,
  UseArtifactDownloadUrlReturn,
  UseArtifactDownloadUrlOptions,
  UseArtifactDownloadReturn,
  UseArtifactCopyReturn,
  UseToolOutputContentReturn,
  ToolOutputRefLike,
  UseFileChangeContentReturn,
  UseWorkspaceWriteBacksReturn,
  WriteBackCardProps,
  DiffStatSummary,
  FileChangesViewProps,
  FileChangeDiffProps,
  EmptyChangeNoticeProps,
  EmptyChangeKind,
} from "./run/index.js";

// Run — proto type re-exports for artifact consumers
export type { RunArtifact } from "@stigmer/protos/ai/stigmer/agentic/run/v1/artifact_pb";
export { RunArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

// Attachment — file upload behavior hook, styled chip list, clipboard paste,
// vision-resolution image preparation, and vision preflight warnings
export {
  useAttachments,
  AttachmentChipList,
  MAX_ATTACHMENT_BYTES,
  MAX_VISION_LONG_EDGE_PX,
  MAX_VISION_PIXELS,
  assessVisionPreflight,
  detectContentType,
  exceedsVisionResolution,
  extractClipboardFiles,
  fitToVisionResolution,
  formatFileSize,
  prepareImageForVision,
  uniquifyFilename,
  validateAttachmentSize,
  visionPreflightMessage,
} from "./attachment/index.js";
export type {
  AddFilesOptions,
  AttachmentPhase,
  AttachmentEntry,
  AssessVisionPreflightOptions,
  ClipboardFilesSource,
  UseAttachmentsOptions,
  UseAttachmentsReturn,
  AttachmentChipListProps,
  VisionFitSize,
  VisionPreflight,
  VisionPreflightAttachment,
  VisionPreflightMessageOptions,
  VisionPreflightReason,
  VisionPreflightWarning,
} from "./attachment/index.js";

// File Reference — workspace file-reference behavior hook and styled chip list
export {
  useFileReferences,
  FileReferenceChipList,
} from "./file-reference/index.js";
export type {
  UseFileReferencesReturn,
  FileReferenceChipListProps,
} from "./file-reference/index.js";
export { FILE_REF_MIME } from "./internal/file-tree/index.js";

// Composer — unified message input with model, workspace, and file attachments
export {
  useComposer,
  SessionComposer,
  PersonalKeyDisclosure,
  InteractionModePicker,
} from "./composer/index.js";
export type {
  UseComposerOptions,
  UseComposerReturn,
  SessionComposerHandle,
  SessionComposerProps,
  SessionComposerSubmitContext,
  PersonalKeyDisclosureProps,
  InteractionModePickerProps,
  InteractionModeOption,
} from "./composer/index.js";

// MCP Server — data hook, count hook, list hook, search hook, picker, config panel, tool selector, detail view, setup orchestration, OAuth connect, and update
export {
  useMcpServer,
  useMcpServerCount,
  useMcpServerList,
  useMcpServerSearch,
  useMcpServerSetup,
  useMcpServerConnect,
  useMcpServerOAuthConnect,
  getOAuthConnectErrorMessage,
  useMcpServerCredentials,
  useOAuthGrantStatus,
  useDisconnectOAuth,
  OAuthCallbackHandler,
  McpServerPicker,
  McpServerConfigPanel,
  McpServerDetailView,
  McpServerConnectDialog,
  McpServerCreationWizard,
  useCreateMcpServer,
  useUpdateMcpServer,
  toServerKey,
  IdentityTransportStep,
  EnvironmentAuthStep,
  ReviewStep,
  createInitialMcpServerWizardData,
} from "./mcp-server/index.js";
export type {
  UseMcpServerReturn,
  UseMcpServerCountOptions,
  UseMcpServerCountReturn,
  UseMcpServerListOptions,
  UseMcpServerListReturn,
  UseMcpServerSearchOptions,
  UseMcpServerSearchReturn,
  UseMcpServerSetupReturn,
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
  UseMcpServerConnectReturn,
  UseMcpServerOAuthConnectReturn,
  OAuthConnectPhase,
  SignInVault,
  StartOAuthOptions,
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
  IdentityTransportStepProps,
  EnvironmentAuthStepProps,
  ReviewStepProps,
} from "./mcp-server/index.js";

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
} from "./skill/index.js";
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
} from "./skill/index.js";

// Plugin — the installed kind's data hooks, the marketplace layer a browser reads, install, detail view, and the "installed by a plugin" rule
export {
  usePlugin,
  usePluginList,
  usePluginCount,
  usePluginMembers,
  usePluginVersions,
  useManagingPlugin,
  PLUGIN_LABEL,
  useMarketplaces,
  useMarketplace,
  useMarketplaceCatalog,
  catalogEntries,
  MarketplaceCatalogStore,
  sourceKeyOf,
  usePluginPresentation,
  usePreparePluginInstall,
  useInstallRelation,
  useInstallPlugin,
  BUILT_IN_SOURCES,
  MARKETPLACES_STORAGE_KEY,
  MARKETPLACE_TREE_LIMITS,
  OFFICIAL_MARKETPLACE,
  OFFICIAL_MARKETPLACE_NAME,
  OFFICIAL_PUBLISHER,
  MarketplaceSourceError,
  PluginReadRefusal,
  narrowStoredEntry,
  findEntry,
  entryCandidates,
  openMarketplace,
  openMarketplaceSource,
  openGitHubTree,
  openOfficialTree,
  prepareEntry,
  isPublishedVersion,
  officialFileUrl,
  officialListingUrl,
  rawUrl,
  treesUrl,
  githubAvatarUrl,
  githubOwner,
  PluginDetailView,
  MarketplaceCatalog,
  CATALOG_PAGE_SIZE,
  filterEntries,
  matchesQuery,
  PluginCard,
  UploadTile,
  PluginFace,
  monogramRing,
  SourceMark,
  publisherOf,
  SourceChips,
  ManageSourcesDialog,
  describeSource,
  PluginUploader,
  usePluginUpload,
  looksLikeDroppedDotfiles,
  PluginInstallDialog,
  summariseInstall,
  McpServerReadiness,
  useMcpServerReadiness,
  AddPluginToAgentDialog,
  useAddPluginToAgent,
  hookVariablesToDeclare,
  listsPluginHooks,
  withPluginHooks,
  HookConfigList,
  InstallPreview,
  PrepareRefusal,
  describeOrigin,
  LocalPluginError,
  folderPick,
  folderPickFromInput,
  zipPick,
  prepareLocalPlugin,
  formatMib,
  ManagedByPluginNotice,
  PluginIcon,
  pluginMemberKindLabel,
} from "./plugin/index.js";
export type {
  UsePluginReturn,
  UsePluginListOptions,
  UsePluginListReturn,
  UsePluginCountOptions,
  UsePluginCountReturn,
  PluginMembersByKind,
  UsePluginMembersReturn,
  UsePluginVersionsReturn,
  UseManagingPluginReturn,
  UnreadableMarketplace,
  UseMarketplacesReturn,
  UseMarketplacesOptions,
  AddSourceOutcome,
  UseMarketplaceOptions,
  UseMarketplaceReturn,
  UseMarketplaceCatalogOptions,
  UseMarketplaceCatalogReturn,
  CatalogEntry,
  SourceRead,
  SourceReadState,
  OpenSource,
  UsePluginPresentationReturn,
  InstallRelation,
  UseInstallRelationReturn,
  InstallOrigin,
  LocalFile,
  LocalPick,
  InstallPreviewProps,
  UsePreparePluginInstallReturn,
  InstallPluginOptions,
  InstallPluginOutcome,
  UseInstallPluginReturn,
  FetchImpl,
  GitHubMarketplaceSource,
  KnownMarketplace,
  MarketplaceSource,
  MarketplaceTree,
  OpenedMarketplace,
  PreparedInstall,
  OpenSourceOptions,
  PluginDetailViewProps,
  PluginMemberRef,
  McpServerReadinessProps,
  McpServerReadinessKind,
  UseMcpServerReadinessReturn,
  AddPluginToAgentDialogProps,
  AddableHooks,
  AddableServer,
  AddPluginOutcome,
  AddPluginPhase,
  PluginOffer,
  UseAddPluginToAgentReturn,
  HookConfigListProps,
  MarketplaceCatalogProps,
  PluginCardProps,
  UploadTileProps,
  PluginFaceProps,
  SourceMarkProps,
  SourceChipsProps,
  ManageSourcesDialogProps,
  PluginUploaderProps,
  PluginUploadPhase,
  UsePluginUploadReturn,
  PluginInstallDialogProps,
  ManagedByPluginNoticeProps,
} from "./plugin/index.js";

// GitHub — OAuth connection, repo picker, tree lister, and hooks
export {
  useGitHubConnection,
  useGitHubRepos,
  useGitHubSearch,
  useGitHubTreeLister,
  useGitHubFileReader,
  parseGitUrl,
  GitHubRepoPicker,
} from "./github/index.js";
export type {
  GitHubUser,
  UseGitHubConnectionConfig,
  UseGitHubConnectionReturn,
  GitHubRepo,
  GitHubBranch,
  UseGitHubReposReturn,
  UseGitHubSearchReturn,
  GitHubRepoPickerProps,
  ParsedGitRepo,
} from "./github/index.js";

// Agent — data hook, count hook, list hook, search hook, picker, detail view, versions, env form, setup orchestration, env diffing, creation wizard, update
export {
  useAgent,
  useAgentCount,
  useAgentList,
  useAgentSearch,
  AgentPicker,
  AgentDetailView,
  useAgentVersions,
  useAgentVersionCount,
  agentVersionLabel,
  AgentVersionsTab,
  AgentQualityTab,
  AgentEnvForm,
  diffEnv,
  useAgentSetup,
  useCreateAgent,
  useUpdateAgent,
  AgentCreationWizard,
  agentHarnessOf,
  agentRunDefaultsFor,
  useRunAgentSpec,
} from "./agent/index.js";
export type {
  UseAgentReturn,
  AgentRunDefaults,
  UseRunAgentSpecReturn,
  UseAgentCountOptions,
  UseAgentCountReturn,
  UseAgentListOptions,
  UseAgentListReturn,
  UseAgentSearchOptions,
  UseAgentSearchReturn,
  AgentPickerProps,
  AgentDetailViewProps,
  UseAgentVersionsReturn,
  AgentVersionsTabProps,
  AgentQualityTabProps,
  AgentEnvFormProps,
  AgentEnvFormSubmitOptions,
  AgentEnvFormVariable,
  AgentSetupResult,
  AgentSetupReadyResult,
  AgentSetupState,
  AgentSetupPhase,
  PendingSignIn,
  AgentResolution,
  UseAgentSetupReturn,
  UseCreateAgentReturn,
  UseUpdateAgentReturn,
  AgentCreationWizardProps,
  AgentCreationResult,
  AgentWizardData,
} from "./agent/index.js";

// Schedule — the disabled-vs-paused state derivation, the direct-query
// list core + workbench adapter (schedules are not search-backed), data
// hooks (get by reference, paginated list, count), behavior hooks
// (create via apply, resume, trigger once, owner enable/disable and
// per-field spec edits via lossless manifest apply), the cadence model
// (preset ⇄ cron, no cron parsing — recognition of builder-emitted
// shapes only), the cadence builder, the creation form, the tabbed
// detail view with inline editing, and the paginated run-history table
export {
  deriveScheduleState,
  formatNextFire,
  createScheduleListFn,
  listSchedulesPage,
  useSchedule,
  useScheduleList,
  useScheduleCount,
  useCreateSchedule,
  useResumeSchedule,
  useTriggerSchedule,
  useSetScheduleEnabled,
  useUpdateScheduleSpec,
  createScheduleColumns,
  cadenceToCron,
  cronToCadence,
  describeCadence,
  validateCron,
  validateTimeZone,
  WEEKDAY_LABELS,
  CadenceField,
  ScheduleForm,
  ScheduleRowActions,
  ScheduleDetailView,
  ScheduleIcon,
  ScheduleFiresTable,
} from "./schedule/index.js";
export type {
  ScheduleState,
  ScheduleStateInfo,
  ScheduleListClient,
  SchedulePage,
  UseScheduleReturn,
  UseScheduleListOptions,
  UseScheduleListReturn,
  UseScheduleCountOptions,
  UseScheduleCountReturn,
  UseCreateScheduleReturn,
  UseResumeScheduleReturn,
  UseTriggerScheduleReturn,
  UseSetScheduleEnabledReturn,
  CadencePreset,
  CadenceKind,
  CadenceFieldProps,
  ScheduleFormProps,
  ScheduleColumnsOptions,
  ScheduleRowActionsProps,
  ScheduleDetailViewProps,
  ScheduleFiresTableProps,
  UseUpdateScheduleSpecReturn,
} from "./schedule/index.js";

// Vault — My vault and shared vaults (entry names only; values are write-only), the vault picker, the credential form, the session value pool, the platform-filled key set, and the address rule
export {
  useMyVault,
  useVault,
  useVaultList,
  isMyVault,
  useCreateVault,
  useUpdateVault,
  useVaultEntries,
  VaultEntriesEditor,
  VaultListPanel,
  CreateVaultForm,
  VaultPicker,
  MY_VAULT_LABEL,
  EnvVarForm,
  SYSTEM_ENV_VAR_KEYS,
  useToolCredentialsReadiness,
  normalizeAddress,
  toolAddressOf,
  toolLoginKeyOf,
  gitHostOf,
  GITHUB_HOST,
  useVaultSignIn,
} from "./vault/index.js";
export type {
  UseMyVaultReturn,
  VaultSecretValue,
  UseVaultReturn,
  UseVaultListReturn,
  CreateVaultInput,
  UseCreateVaultReturn,
  UpdateVaultInput,
  UseUpdateVaultReturn,
  UseVaultEntriesReturn,
  VaultEntriesEditorProps,
  VaultListPanelProps,
  CreateVaultFormProps,
  VaultPickerProps,
  VaultPickerMyVault,
  ConversationVaults,
  EnvVarFormProps,
  EnvVarFormVariable,
  EnvVarFormSubmitOptions,
  EnvVarInput,
  SignInDestination,
  SignInReturnTo,
  UseVaultSignInReturn,
  VaultSignInPhase,
  ToolCredentialsReadiness,
} from "./vault/index.js";

// Identity Account — gate hook, self-account data/mutation hooks, the
// account preferences editor, and the composer-seeding execution defaults
export {
  useIdentityAccountGate,
  useMyIdentityAccount,
  useAccountExecutionDefaults,
  useUpdateIdentityAccount,
  AccountPreferencesPanel,
} from "./identity-account/index.js";
export type {
  IdentityAccountGateState,
  UseIdentityAccountGateReturn,
  UseMyIdentityAccountOptions,
  UseMyIdentityAccountReturn,
  AccountExecutionDefaults,
  UseUpdateIdentityAccountReturn,
  AccountPreferencesPanelProps,
} from "./identity-account/index.js";
// The first-sign-in flow the gate hook delegates to, for consumers who want
// it without the hook (the `isResourceAvailable` re-export is the precedent).
export {
  ensureMyIdentityAccount,
  type EnsuredIdentityAccount,
  type EnsureMyIdentityAccountOptions,
  type IdentityAccountLane,
} from "@stigmer/sdk";

// Memory — agent-proposed, user-confirmed facts: data hook, decision
// hooks (confirm/reject/delete/edit), grouping helpers, and the list panel
export {
  useMemories,
  useMemory,
  useConfirmMemory,
  useRejectMemory,
  useDeleteMemory,
  useUpdateMemoryContent,
  groupMemoriesByLifecycle,
  formatMemoryProvenance,
  MemoryListPanel,
  MemoryProposalCardBody,
} from "./memory/index.js";
export type {
  UseMemoriesReturn,
  UseMemoryReturn,
  UseConfirmMemoryReturn,
  UseRejectMemoryReturn,
  UseDeleteMemoryReturn,
  UseUpdateMemoryContentReturn,
  MemoryGroups,
  MemoryListPanelProps,
  MemoryProposalCardBodyProps,
} from "./memory/index.js";

// Scores — a person's thumbs on a run's final answer, the platform's free
// run-health checks, an AI judge's verdict and a plugin eval's checks, shown
// on every completed run its viewers can see
export {
  RunScores,
  useSessionScores,
  useRateRun,
  useUpdateRating,
} from "./score/index.js";
export type {
  RunScoresProps,
  UseSessionScoresReturn,
  UseRateRunReturn,
  UseUpdateRatingReturn,
  RunRating,
} from "./score/index.js";

// Evaluators — AI grading switched on per agent: its sample, its monthly
// spending limit and its judge model (the agent's Quality tab)
export {
  useAgentEvaluator,
  useSaveEvaluator,
  DEFAULT_GRADING_SETTINGS,
  MAX_ONE_IN,
} from "./evaluator/index.js";
export type {
  UseAgentEvaluatorReturn,
  UseSaveEvaluatorReturn,
  GradingSettings,
} from "./evaluator/index.js";

// Plugin evals — a plugin's own evals/ test cases run with and without it
// on the models an eval names (the plugin's Evals tab), and a run made into
// a test case
export {
  PluginEvalsTab,
  PluginEvalResults,
  usePluginEvals,
  usePluginEval,
  useStartPluginEval,
  useCancelPluginEval,
  PLUGIN_EVAL_POLL_MS,
  DEFAULT_EVAL_FORM,
  MAX_EVAL_CONCURRENCY,
  MAX_EVAL_COST_USD,
  MAX_EVAL_RUNS,
  MAX_EVAL_TARGETS,
  evalCaseRowsOf,
  compareEvals,
  evalFormProblem,
  evalLabelOf,
  pluginEvalInputOf,
  evalTargetLabelsOf,
  testCaseOfRun,
  zipTestCase,
} from "./plugin-eval/index.js";
export type {
  PluginEvalsTabProps,
  PluginEvalResultsProps,
  UsePluginEvalsReturn,
  UsePluginEvalReturn,
  UseStartPluginEvalReturn,
  UseCancelPluginEvalReturn,
  EvalCaseRow,
  EvalCaseCell,
  EvalCompareRow,
  EvalCompareSide,
  EvalFormSettings,
  EvalFormTarget,
  EvalPluginRef,
  EvalTryView,
  RunForTestCase,
} from "./plugin-eval/index.js";

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
  useGranteeCandidates,
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
} from "./iam-policy/index.js";
export type {
  UseGrantableRolesReturn,
  RoleOption,
  UseRoleSelectorReturn,
  ResourceAccessRef,
  UseResourceAccessOptions,
  UseResourceAccessReturn,
  UsePrincipalsCountReturn,
  UseWhoAmIOptions,
  UseWhoAmIReturn,
  UseCreateIamPolicyReturn,
  UseDeleteIamPolicyReturn,
  UseRevokeOrgAccessReturn,
  UseShareFlowReturn,
  ShareFlowResource,
  UseCheckPermissionReturn,
  CheckPermissionOptions,
  PermissionCheckResource,
  RoleSelectorProps,
  PrincipalPickerProps,
  SelectedGrantee,
  GranteeCandidate,
  PersonCandidate,
  TeamCandidate,
  UseGranteeCandidatesOptions,
  UseGranteeCandidatesReturn,
  ProviderBadgeProps,
  GrantAccessFormProps,
  PeopleWithAccessProps,
  OrgMembersPanelProps,
  SharePanelProps,
  PermissionGateProps,
} from "./iam-policy/index.js";

// Access — unified "Manage access" experience (visibility + people) as one
// dialog, with a kebab hook and a visible-button trigger.
export {
  ManageAccessDialog,
  ManageAccessButton,
  useManageAccess,
} from "./access/index.js";
export type {
  ManageAccessDialogProps,
  ManageAccessButtonProps,
  UseManageAccessArgs,
  UseManageAccessReturn,
  AccessResource,
  AccessVisibility,
} from "./access/index.js";

// Organization — context provider, hooks, data hooks, behavior hooks, styled form, profile panel, org switcher, and child organizations
export {
  OrgProvider,
  useOrg,
  useActiveOrgSlug,
  useActiveOrgId,
  useFollowSessionOrganization,
  useOrgGate,
  useOrganization,
  useCreateOrganization,
  useUpdateOrganization,
  useRenameOrganization,
  useOrgSlugForId,
  useOrgIdForRef,
  useCanonicalOrgSlug,
  OrgSlugText,
  CreateOrganizationForm,
  OrgProfilePanel,
  OrgPreferencesPanel,
  OrgSwitcher,
  useChildOrganizations,
  ChildOrganizationsList,
} from "./organization/index.js";
export type {
  OrgContextValue,
  UseOrgGateOptions,
  OrgGateState,
  UseOrgGateReturn,
  UseOrganizationReturn,
  UseCreateOrganizationReturn,
  UseUpdateOrganizationReturn,
  UseRenameOrganizationReturn,
  OrgSlugTextProps,
  CreateOrganizationFormProps,
  OrgProfilePanelProps,
  OrgPreferencesPanelProps,
  OrgSwitcherProps,
  UseChildOrganizationsOptions,
  UseChildOrganizationsReturn,
  ChildOrganizationsListProps,
} from "./organization/index.js";

// Billing — customer-facing data hooks, behavior hooks, styled components,
// catalog, and formatting utilities
export {
  useBillingAccount,
  useCreditLedger,
  useBillingUsageReport,
  useCustomerModelPricing,
  useCreateCheckoutSession,
  useCreateBillingPortalSession,
  useSetAutoRechargeConfig,
  usePlans,
  useSubscription,
  useEntitlements,
  usePeriodEstimate,
  useProviderKeys,
  useProviderKeyActions,
  ProviderKeysSection,
  useChangePlan,
  useCancelSubscription,
  useCreatePaymentMethodSetupSession,
  planStanding,
  planMove,
  PlanSection,
  PlanCard,
  PlanPicker,
  ENTERPRISE_CONTACT_URL,
  ChangePlanDialog,
  PAYMENT_METHOD_REQUIRED,
  UpgradeNotice,
  planUpgradeFeature,
  PLAN_UPGRADE_REQUIRED,
  DEFAULT_BILLING_HREF,
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
} from "./billing/index.js";
export type {
  UseBillingAccountOptions,
  UseBillingAccountReturn,
  UsePlansOptions,
  UsePlansReturn,
  UseSubscriptionReturn,
  UseEntitlementsOptions,
  UseEntitlementsReturn,
  UsePeriodEstimateOptions,
  UsePeriodEstimateReturn,
  ProviderKeyProvider,
  UseProviderKeysOptions,
  UseProviderKeysReturn,
  UseProviderKeyActionsReturn,
  ProviderKeysSectionProps,
  UseChangePlanReturn,
  UseCancelSubscriptionReturn,
  UseCreatePaymentMethodSetupSessionReturn,
  BillingRedirect,
  PlanStanding,
  PlanMove,
  PlanSectionProps,
  PlanCardProps,
  PlanPickerProps,
  ChangePlanDialogProps,
  UpgradeNoticeProps,
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
} from "./billing/index.js";

// Pricing governance — platform-operator authoring of the model registry
// baseline and pricing-override sign-offs (gated on can_manage_model_pricing)
export {
  usePricingGovernance,
  useModelPricingBaselines,
  useModelGovernanceView,
  useDecidePricingOverride,
  useUpsertModelPricingBaseline,
  useRetireModelPricingBaseline,
  PricingGovernancePanel,
  ModelCatalogPanel,
  PricingGovernanceConsole,
} from "./pricing-governance/index.js";
export type {
  UsePricingGovernanceReturn,
  UseModelPricingBaselinesOptions,
  UseModelPricingBaselinesReturn,
  GovernanceFlow,
  ModelGovernanceRow,
  UseModelGovernanceViewReturn,
  DecidePricingOverrideInput,
  UseDecidePricingOverrideReturn,
  UpsertModelPricingBaselineInput,
  UseUpsertModelPricingBaselineReturn,
  RetireModelPricingBaselineInput,
  UseRetireModelPricingBaselineReturn,
  PricingGovernancePanelProps,
  ModelCatalogPanelProps,
  PricingGovernanceConsoleProps,
  PricingGovernanceTab,
} from "./pricing-governance/index.js";

// Cursor accounts — platform-operator management of managed Cursor teams
// (admin keys, member execution keys, org assignments, roster/spend)
export {
  useCursorAccounts,
  useCursorAccountView,
  useUpsertCursorAccount,
  useDeleteCursorAccount,
  useCursorMemberKeyActions,
  useSyncCursorAccount,
  CursorAccountsConsole,
  CursorAccountEditor,
  CursorAccountsAccessNotice,
} from "./cursor-accounts/index.js";
export type {
  UseCursorAccountsReturn,
  UseCursorAccountViewReturn,
  UseUpsertCursorAccountReturn,
  DeleteCursorAccountInput,
  UseDeleteCursorAccountReturn,
  AddCursorMemberKeyInput,
  RemoveCursorMemberKeyInput,
  UseCursorMemberKeyActionsReturn,
  UseSyncCursorAccountReturn,
  CursorAccountsConsoleProps,
  CursorAccountEditorProps,
} from "./cursor-accounts/index.js";

// Provider standing — read-only platform-operator view of the platform's
// LLM provider account health (canary-probe verdicts)
export {
  useProviderStanding,
  ProviderStandingConsole,
  ProviderStandingAccessNotice,
} from "./provider-standing/index.js";
export type {
  UseProviderStandingReturn,
  ProviderStandingConsoleProps,
} from "./provider-standing/index.js";

// Licenses — platform-operator issuing of Stigmer licenses: the renewal
// calendar, the issue form and the signed ticket (gated on can_issue_license)
export {
  useLicenses,
  useLicense,
  useIssueLicense,
  LicensesConsole,
  LicensesAccessNotice,
} from "./licenses/index.js";
export type {
  UseLicensesReturn,
  UseLicenseReturn,
  UseIssueLicenseReturn,
  LicensesConsoleProps,
} from "./licenses/index.js";

// Plan catalog — platform-operator management of the Stigmer Cloud plans
// organizations subscribe to (gated on can_manage_plans)
export {
  useCreatePlan,
  useRetirePlan,
  PlanCatalogConsole,
  PlanCreateForm,
  PlansAccessNotice,
} from "./plan-catalog/index.js";
export type {
  UseCreatePlanReturn,
  UseRetirePlanReturn,
  PlanCatalogConsoleProps,
  PlanCreateFormProps,
} from "./plan-catalog/index.js";

// Settings — navigation structure + section components shared across app shells
export {
  SETTINGS_NAV_GROUPS,
  SINGLE_ORG_SETTINGS_NAV_GROUPS,
  PLATFORM_SETTINGS_NAV_GROUP,
  useSettingsNavGroups,
} from "./settings/index.js";
export type { SettingsNavItem, SettingsNavGroup } from "./settings/index.js";
export { ApiKeysSection } from "./settings/index.js";
export { MembersSection } from "./settings/index.js";
export { OrgProfileSection } from "./settings/index.js";
export { OrgPreferencesSection } from "./settings/index.js";
export { AccountPreferencesSection } from "./settings/index.js";
export { MemorySection } from "./settings/index.js";
export { VaultsSection } from "./settings/index.js";
export { InvitationsSection } from "./settings/index.js";
export { IdentityProvidersSection } from "./settings/index.js";
export type { IdentityProvidersSectionProps } from "./settings/index.js";
export { PlatformClientsSection } from "./settings/index.js";
export { TeamsSection } from "./settings/index.js";
export { OAuthAppsSection } from "./settings/index.js";
export { ChannelAppsSection } from "./settings/index.js";
export { UsageSection } from "./settings/index.js";

// User — app shell user menu
export { UserMenu } from "./user/index.js";
export type { UserMenuProps } from "./user/index.js";

// Sidebar — the console's navigation chrome (workspace + settings zones).
// The web console, desktop app, and documentation tours all render these;
// hosts inject routing via `renderLink` and identity via the footer slot.
export { WorkspaceSidebar, SettingsSidebar } from "./sidebar/index.js";
export type {
  WorkspaceSidebarProps,
  WorkspaceSidebarActivity,
  WorkspaceNavId,
  SettingsSidebarProps,
  SidebarLinkRenderProps,
  RenderSidebarLink,
} from "./sidebar/index.js";

// API Key — data hooks, behavior hooks, and styled components for API key lifecycle
export {
  useApiKeyList,
  useCreateApiKey,
  useDeleteApiKey,
  ApiKeyListPanel,
  CreateApiKeyForm,
  ApiKeyCreatedAlert,
} from "./api-key/index.js";
export type {
  UseApiKeyListReturn,
  UseCreateApiKeyReturn,
  UseDeleteApiKeyReturn,
  ApiKeyListPanelProps,
  CreateApiKeyFormProps,
  ApiKeyCreatedAlertProps,
} from "./api-key/index.js";

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
} from "./platform-client/index.js";
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
} from "./platform-client/index.js";

// OAuth App — data hooks, mutation hooks, and styled components for OAuth app management
export {
  useOAuthAppList,
  useCreateOAuthApp,
  useUpdateOAuthApp,
  useDeleteOAuthApp,
  OAuthAppListPanel,
  CreateOAuthAppForm,
  OAuthAppDetailPanel,
} from "./oauth-app/index.js";
export type {
  UseOAuthAppListReturn,
  UseCreateOAuthAppReturn,
  UseUpdateOAuthAppReturn,
  UseDeleteOAuthAppReturn,
  OAuthAppListPanelProps,
  CreateOAuthAppFormProps,
  OAuthAppDetailPanelProps,
} from "./oauth-app/index.js";

// Channel App — data hooks, mutation hooks, styled components, and Slack
// setup helpers for bring-your-own channel apps
export {
  useChannelAppList,
  useCreateChannelApp,
  useUpdateChannelApp,
  useDeleteChannelApp,
  ChannelAppListPanel,
  CreateChannelAppForm,
  ChannelAppDetailPanel,
  buildSlackChannelAppManifest,
  slackChannelAppRedirectUrl,
  slackChannelAppWebhookUrl,
  SLACK_CHANNEL_APP_BOT_EVENTS,
  SLACK_CHANNEL_APP_BOT_SCOPES,
} from "./channel-app/index.js";
export type {
  UseChannelAppListReturn,
  UseCreateChannelAppReturn,
  UseUpdateChannelAppReturn,
  UseDeleteChannelAppReturn,
  ChannelAppListPanelProps,
  CreateChannelAppFormProps,
  ChannelAppDetailPanelProps,
  SlackChannelAppManifestInput,
} from "./channel-app/index.js";

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
} from "./identity-provider/index.js";
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
} from "./identity-provider/index.js";

// Teams — an organization's named groups of people that access is shared
// with as one (Enterprise and Cloud editions)
export {
  useTeamList,
  useTeam,
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
  TeamListPanel,
  CreateTeamForm,
  TEAM_DESCRIPTION_MAX_LENGTH,
  TeamMembersPanel,
  TeamDetailPanel,
} from "./team/index.js";
export type {
  UseTeamListReturn,
  UseTeamReturn,
  UseCreateTeamReturn,
  UseUpdateTeamReturn,
  UseDeleteTeamReturn,
  TeamListPanelProps,
  CreateTeamFormProps,
  TeamMembersPanelProps,
  TeamDetailPanelProps,
} from "./team/index.js";

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
} from "./invitation/index.js";
export type {
  UseOrgInvitationsOptions,
  UseOrgInvitationsReturn,
  UseCreateInvitationReturn,
  UseRevokeInvitationReturn,
  UseInvitationPreviewReturn,
  UseRedeemInvitationReturn,
  InvitationCreatedAlertProps,
  InvitationManagerProps,
  InvitationRedemptionProps,
} from "./invitation/index.js";

// Connect links — the public page a Connect link opens and its callback
export {
  useConnectLink,
  pendingConnectLinkToken,
  clearPendingConnectLinkToken,
  CONNECT_LINK_PENDING_KEY,
  DEAD_CONNECT_LINK_MESSAGE,
  ConnectLinkView,
  ConnectLinkCallback,
} from "./connect-link/index.js";
export type {
  UseConnectLinkReturn,
  ConnectLinkViewProps,
  ConnectLinkCallbackProps,
} from "./connect-link/index.js";

// Sharing — shared-agent public profile, the anonymous-visitor chat organism,
// and the owner-side Share experience (Shares tab list, dialog, AgentShare hooks).
export {
  useSharedAgentProfile,
  SharedAgentChat,
  draftFromShare,
  sharingAudienceFromProto,
  useAgentShares,
  useCanCreateAgentShare,
  useSaveAgentShare,
  useDeleteAgentShare,
  useRotateShareLink,
  ShareAgentDialog,
  AgentShareList,
  useShareToolReadiness,
  validateOrigin,
  MAX_ALLOWED_ORIGINS,
} from "./sharing/index.js";
export type {
  UseSharedAgentProfileOptions,
  UseSharedAgentProfileReturn,
  SharedAgentChatProps,
  AgentShareCreateIdentity,
  AgentShareDraft,
  SharingAudience,
  UseAgentSharesReturn,
  UseCanCreateAgentShareReturn,
  UseSaveAgentShareReturn,
  UseDeleteAgentShareReturn,
  UseRotateShareLinkReturn,
  ShareAgentDialogProps,
  AgentShareListProps,
  ShareToolReadiness,
} from "./sharing/index.js";

// Channel — agent channels on external messaging platforms (Slack + WhatsApp):
// the Channels tab panel, the per-provider connect dialogs, and the
// AgentChannel hooks.
export {
  useAgentChannelList,
  useAgentChannel,
  useSaveAgentChannel,
  agentChannelToInput,
  useCreateAgentChannel,
  useDeleteAgentChannel,
  useConnectSlackChannel,
  useInstallChannel,
  useChannelToolReadiness,
  useChannelTemplateReadiness,
  useChannelSessions,
  useChannelTemplateList,
  templateStatusPhase,
  splitTemplateBody,
  AgentChannelsPanel,
  ConnectSlackDialog,
  ConnectWhatsAppDialog,
  ChannelCredentialsDialog,
  ChannelRunConfigDialog,
  ChannelToolCredentials,
  ChannelConversationsDialog,
  ChannelTemplatesDialog,
} from "./channel/index.js";
export type {
  UseAgentChannelListReturn,
  UseAgentChannelReturn,
  UseSaveAgentChannelReturn,
  UseCreateAgentChannelReturn,
  UseDeleteAgentChannelReturn,
  UseConnectSlackChannelReturn,
  SlackConnectPhase,
  UseInstallChannelReturn,
  InstallChannelPhase,
  ChannelTemplateReadiness,
  UseChannelSessionsReturn,
  UseChannelTemplateListOptions,
  UseChannelTemplateListReturn,
  TemplateBodySegment,
  AgentChannelsPanelProps,
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
  useConversation,
  useConversationList,
  useConversationMediaUrl,
  useConversationTimeline,
  useConversationParticipation,
  useConversationsWantsHumanCount,
  authorKindOf,
  awaitingIndicatorOf,
  compareTimelineItemsNewestFirst,
  conversationContactOf,
  conversationLabelOf,
  inboundPlaceholderOf,
  isInternalItem,
  receiptOf,
  sendAttemptOf,
  serviceWindowOf,
  CONVERSATION_BADGE_POLL_INTERVAL_MS,
  CONVERSATION_DETAIL_POLL_INTERVAL_MS,
  CONVERSATION_LIST_POLL_INTERVAL_MS,
} from "./conversation/index.js";
export type {
  ConversationsWorkbenchProps,
  ConversationHeaderContext,
  ConversationIdentity,
  ConversationListPaneProps,
  ConversationTimelineViewProps,
  ConversationControlBannerProps,
  ConversationAttentionBannerProps,
  ConversationComposerProps,
  ConversationTemplatePickerDialogProps,
  ConversationReplyPayload,
  UseConversationOptions,
  UseConversationReturn,
  UseConversationListOptions,
  UseConversationListReturn,
  UseConversationMediaUrlOptions,
  UseConversationMediaUrlReturn,
  UseConversationTimelineOptions,
  UseConversationTimelineReturn,
  ConversationCommand,
  UseConversationParticipationOptions,
  UseConversationParticipationReturn,
  UseConversationsWantsHumanCountOptions,
  UseConversationsWantsHumanCountReturn,
  AwaitingIndicator,
  ConversationAuthorKind,
  ReceiptKind,
  SendAttemptKind,
  ServiceWindowState,
} from "./conversation/index.js";
// Wire types the conversation hooks answer with (generated types are the
// source of truth — re-exported for consumer convenience).
export {
  ChannelConversationListFilter,
  ConversationControl,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
export type {
  ChannelConversation,
  ConversationTimelineItem,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";

// Error — structured error display with classification, retry, and contextual guidance
export {
  ErrorMessage,
  SecretFlowErrorGuide,
  isSecretFlowError,
} from "./error/index.js";
export type {
  ErrorMessageProps,
  SecretFlowErrorGuideProps,
} from "./error/index.js";

// Library — cross-resource UI components, resource detection, apply flow, browsing, and visibility management
export {
  LibraryBreadcrumbProvider,
  useBreadcrumbLabel,
  useBreadcrumbOverride,
  ResourceCountCard,
  detectStigmerResource,
  useDetectStigmerResource,
  isSkillPackage,
  detectSkillPackage,
  useDetectSkillPackage,
  isPlanArtifact,
  isPlanArtifactName,
  findPlanArtifact,
  findLatestSessionPlan,
  findStreamingPlan,
  PLAN_ARTIFACT_NAME,
  PLAN_ARTIFACT_SUFFIX,
  useApplyResource,
  useExportResource,
  VisibilitySelector,
  VisibilityBadge,
  blueprintVisibilityLevels,
  visibilityLabel,
  useUpdateVisibility,
} from "./library/index.js";
export type {
  ResourceCountCardProps,
  StigmerResourceKind,
  StigmerResourceDetection,
  SkillPackageDetection,
  SessionPlan,
  StreamingPlan,
  UseDetectSkillPackageReturn,
  UseApplyResourceReturn,
  ApplyResourceResult,
  PushSkillParams,
  UseExportResourceOptions,
  UseExportResourceReturn,
  VisibilitySelectorProps,
  VisibilityBadgeProps,
  VisibilityLevelOption,
  BlueprintVisibilityLevelsContext,
  VisibilityResourceKind,
  UseUpdateVisibilityReturn,
} from "./library/index.js";

// Manifest — kind-agnostic YAML edit/apply (editor, hooks, dialogs)
export {
  YamlEditor,
  useEditResourceYaml,
  useApplyManifest,
  EditResourceYamlDialog,
  ApplyManifestDialog,
  RedactedSecretsNotice,
} from "./manifest/index.js";
export type {
  YamlEditorProps,
  EditYamlTarget,
  EditYamlValidation,
  UseEditResourceYamlOptions,
  UseEditResourceYamlReturn,
  ManifestEntryStatus,
  ManifestPreviewEntry,
  UseApplyManifestReturn,
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
export type {
  EmptyStateVariant,
  EmptyStateAction,
  EmptyStateProps,
  UseEmptyStateOptions,
  UseEmptyStateReturn,
} from "./empty-state/index.js";

// Search — shared search/list/count infrastructure re-exported for public API surface
export type {
  UseResourceSearchOptions,
  UseResourceSearchReturn,
} from "./search/index.js";

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
} from "./usage/index.js";
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
} from "./usage/index.js";

// Tabs — accessible tabbed panel primitive
export { Tabs } from "./tabs/index.js";
export type { TabsProps, TabItem } from "./tabs/index.js";

// Switch — accessible on/off toggle primitive (WAI-ARIA Switch pattern)
export { Switch } from "./switch/index.js";
export type { SwitchProps } from "./switch/index.js";

// Button — shared action primitive (variants for the console's action tiers)
export { Button } from "./button/index.js";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./button/index.js";

// Resource Detail — headless hooks, action bar, and composed shell for resource detail pages
export {
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  ResourceActionBar,
  ResourceDetailShell,
  Section,
  ConfirmDialog,
} from "./resource-detail/index.js";
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
} from "./resource-detail/index.js";

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
} from "./resource-creation/index.js";
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
} from "./resource-creation/index.js";

// Dependency Graph — visual tree of agent dependencies (MCP servers, skills, sub-agents)
export {
  DependencyGraph,
  useDependencyGraph,
} from "./dependency-graph/index.js";
export type {
  NodeKind,
  DependencyNode,
  DependencyTree,
  DependencyGraphProps,
  UseDependencyGraphOptions,
  UseDependencyGraphReturn,
} from "./dependency-graph/index.js";

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
} from "./version-history/index.js";
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
} from "./version-history/index.js";

// Inline Edit — click-to-edit field primitives for detail page inline editing
export {
  InlineEditText,
  InlineEditTextarea,
  InlineEditImage,
  InlineEditSelect,
  InlineEditKeyValue,
  InlineEditResourceList,
  useInlineFieldSave,
} from "./inline-edit/index.js";
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
} from "./inline-edit/index.js";

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
  ORG_COLUMN_ID,
} from "./resource-workbench/index.js";
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
} from "./resource-workbench/index.js";

// ─── Dashboard (Unified Platform) ──────────────────────────────────────────
export {
  // Types
  type DashboardSummary,
  type DashboardFailedRun,
  // Data Hooks
  useRunSummary,
  RunSummaryTimeWindow,
  type UseRunSummaryOptions,
  type UseRunSummaryReturn,
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
} from "./dashboard/index.js";
