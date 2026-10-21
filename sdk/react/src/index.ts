// Provider and context
export { StigmerProvider, type StigmerProviderProps } from "./provider.js";
export { type ApprovalDefaults } from "./approval-defaults-context.js";
export { StigmerContext } from "./context.js";

// Runner adapter
export { type RunnerAdapter, useRunnerAdapter } from "./runner-adapter.js";
// Construction helper lives in @stigmer/client (framework-agnostic); re-exported
// here so React embedders import it alongside the adapter interface.
export { type RunnerWorkerHost, createRunnerAdapter } from "@stigmer/client";

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
export { useEnvironmentAvailability, useServerInfo, useSingleOrg } from "./server-info.js";
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
} from "@stigmer/client";
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
  useSessionEvents,
  useSessionConversation,
  useSessionAccess,
  useExportTranscript,
  TranscriptExportMenu,
  useSessionOutputs,
  outputKey,
  useSessionGivenFiles,
  givenKey,
  UPLOADS_FOLDER,
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
  CONVERSATION_FILES_VIEW_ID,
  usePlanDraft,
  planDraftKey,
  PlanEditor,
  PlanStreamingDocument,
  PLAN_DOCUMENT_ENTRY_ID,
  PLAN_DOCUMENT_PATH,
  FILE_DOCUMENT_ENTRY_ID,
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
  UseSessionEventsOptions,
  UseSessionEventsReturn,
  UseSessionConversationReturn,
  UseSessionAccessReturn,
  UseExportTranscriptOptions,
  UseExportTranscriptReturn,
  TranscriptExportMenuProps,
  SessionOutputEntry,
  UseSessionOutputsReturn,
  SessionGivenEntry,
  UseSessionGivenFilesReturn,
  SessionWriteBackEntry,
  UseSessionWriteBacksReturn,
  UseSessionFileChangesReturn,
  ModelUsageEntry,
  UseSessionUsageReturn,
  RunUsageEntry,
  ServedByEntry,
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
  runPhaseOf,
  useCreateRun,
  useLiveRun,
  useRunActions,
  useResolveRunSession,
  useAnswerToolUse,
  useReviewFileChanges,
  useChangeSetCapture,
  fileDecisionKey,
  fileReviewability,
  changeSetReviewability,
  fileForRowPath,
  changeForRowPath,
  fileReviewRowState,
  fileReviewRowChange,
  fileChangeKindOf,
  displayFileChangeSets,
  fileChangeSetOf,
  toDisplayFileChange,
  type DisplayFileChange,
  type DisplayFileChangeType,
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
  SummarizationCard,
  RecalledMemoriesCard,
  resolveInjectedFacts,
  PlanCompletionCard,
  PlanFileCard,
  PlanStreamingCard,
  PlanDocumentMessage,
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
  SubagentSection,
  subagentSubjectOf,
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
  FileRow,
  FileRowView,
  fromFile,
  TextContentRenderer,
  FileBody,
  isImageFile,
  FileDeleteAction,
  FileAddAsSkillAction,
  isZipFile,
  TextContentView,
  FileDocument,
  useFileInspection,
  FilePreviewContent,
  FilePreviewModal,
  WriteBacksWidget,
  ToolArgsView,
  McpArgsView,
  McpMetadataRow,
  FilePathLink,
  FilePathContext,
  classifyPath,
  resolveGitBrowseUrl,
  resolvePathAction,
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
  isTextFile,
  getFileExtension,
  getTextRenderMode,
} from "./run/index.js";
export type {
  BootstrapSessionSpec,
  CreateRunInput,
  CreateRunResult,
  SharedRunFields,
  UseCreateRunReturn,
  UseLiveRunOptions,
  UseLiveRunReturn,
  UseRunActionsOptions,
  UseRunActionsReturn,
  UseResolveRunSessionReturn,
  UseAnswerToolUseReturn,
  ToolUseAnswer,
  UseReviewFileChangesReturn,
  ReviewFileChangesOptions,
  FileReviewAction,
  UseChangeSetCaptureReturn,
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
  ToolPresentation,
  ToolPresenter,
  ToolDisclosure,
  McpToolDetailProps,
  McpArgsViewProps,
  McpMetadataRowProps,
  ToolArgsViewProps,
  ToolCallItemProps,
  SubagentSectionProps,
  MessageEntryProps,
  ThreadMessage,
  UserMessageItem,
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
  FileRowProps,
  FileRowViewProps,
  FileRowItem,
  TextContentRendererProps,
  FileBodyProps,
  FileDeleteActionProps,
  FileAddAsSkillActionProps,
  TextContentViewProps,
  FileDocumentProps,
  FileInspection,
  UseFileInspectionOptions,
  TextRenderMode,
  FilePreviewContentProps,
  FilePreviewModalProps,
  WriteBacksWidgetProps,
  FilePathLinkProps,
  FilePathContextValue,
  PathClassification,
  ResolvedPathAction,
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

// Upload — the chat box's file uploads (Stigmer Files), styled chip list,
// clipboard paste, vision-resolution image preparation, and vision
// preflight warnings
export {
  useFileUploads,
  toFileChipView,
  FileChipList,
  MAX_FILE_BYTES,
  MAX_MESSAGE_FILES,
  MAX_VISION_LONG_EDGE_PX,
  MAX_VISION_PIXELS,
  assessVisionPreflight,
  detectContentType,
  exceedsVisionResolution,
  extractClipboardFiles,
  fitToVisionResolution,
  prepareImageForVision,
  uniquifyFilename,
  validateFileSize,
  visionPreflightMessage,
} from "./upload/index.js";
export type {
  AddFilesOptions,
  FileHandOff,
  FileUploadPhase,
  FileUploadEntry,
  AssessVisionPreflightOptions,
  ClipboardFilesSource,
  UseFileUploadsOptions,
  UseFileUploadsReturn,
  FileChipListProps,
  VisionFitSize,
  VisionPreflight,
  VisionPreflightFile,
  VisionPreflightMessageOptions,
  VisionPreflightReason,
  VisionPreflightWarning,
} from "./upload/index.js";

// File — one Stigmer File's record, link and download; the Library's Files
export {
  formatFileSize,
  useFile,
  useFileDownloadUrl,
  useFileDownload,
  useFileContent,
  useSessionFiles,
  createFileListFn,
  listLibraryFilesPage,
  createFileColumns,
  describeFileType,
  describeUploaded,
  useFileCount,
  useCanCreateFile,
  FileUploadButton,
  LIBRARY_UPLOAD_CONCURRENCY,
  FilePicker,
  LibraryFilePreview,
} from "./file/index.js";
export type {
  UseFileReturn,
  UseFileDownloadUrlReturn,
  UseFileDownloadReturn,
  UseFileContentReturn,
  UseSessionFilesReturn,
  FileListClient,
  FilePage,
  UseFileCountOptions,
  UseFileCountReturn,
  UseCanCreateFileReturn,
  FileUploadButtonProps,
  FileUploadStatus,
  FilePickerProps,
  LibraryFilePreviewProps,
} from "./file/index.js";

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

// Composer — unified message input with model, workspace, and file uploads
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

// Plugin — the installed kind's data hooks, the marketplace layer a browser reads, install, "Add MCP server", detail view, a server's sign-in and tools, the picker, and the "installed by a plugin" rule
export {
  usePlugin,
  usePluginList,
  usePluginCount,
  usePluginSearch,
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
  PluginServerRow,
  reachedBy,
  PluginPicker,
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
  PluginServerSignIn,
  PluginServerSignIns,
  usePluginServerSignIn,
  usePluginTools,
  AddMcpServerDialog,
  HeaderRowsEditor,
  headerRowsOf,
  useCanCreatePlugin,
  mcpServerPluginFiles,
  prepareMcpServerPlugin,
  useAddMcpServer,
  AddPluginToAgentDialog,
  useAddPluginToAgent,
  toolsLeaveOut,
  listsPlugin,
  withPlugin,
  PLUGIN_PICKS_STORAGE_KEY,
  readRememberedPluginPicks,
  rememberPluginPicks,
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
} from "./plugin/index.js";
export type {
  UsePluginReturn,
  UsePluginListOptions,
  UsePluginListReturn,
  UsePluginCountOptions,
  UsePluginCountReturn,
  UsePluginSearchOptions,
  UsePluginSearchReturn,
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
  PluginServerRowProps,
  PluginPickerProps,
  PluginServerSignInProps,
  PluginServerSignInsProps,
  PluginServerSignInKind,
  UsePluginServerSignInReturn,
  UsePluginServerSignInOptions,
  UsePluginToolsReturn,
  AddMcpServerDialogProps,
  HeaderRow,
  HeaderRowsEditorProps,
  UseCanCreatePluginReturn,
  AddMcpServerOptions,
  McpServerFormInput,
  UseAddMcpServerReturn,
  AddPluginToAgentDialogProps,
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
  AgentCreationDenied,
  useCanCreateAgent,
  AgentMcpServersSection,
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
  AgentCreationDeniedProps,
  UseCanCreateAgentReturn,
  AgentMcpServersSectionProps,
  AgentCreationResult,
  AgentWizardData,
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
  deriveRoutineState,
  formatNextFire,
  createRoutineListFn,
  listRoutinesPage,
  useRoutine,
  useRoutineList,
  useRoutineCount,
  useCreateRoutine,
  useResumeRoutine,
  useFireRoutine,
  useSetRoutineEnabled,
  useUpdateRoutineSpec,
  createRoutineColumns,
  cadenceToCron,
  cronToCadence,
  describeCadence,
  validateCron,
  validateTimeZone,
  WEEKDAY_LABELS,
  CadenceField,
  RoutineForm,
  RoutineRowActions,
  RoutineDetailView,
  RoutineIcon,
  RoutineFiresTable,
  RunRoutineDialog,
  FIRE_TEXT_MAX_LEN,
  RoutineApiPanel,
  buildRoutineFireCurl,
} from "./routine/index.js";
export type {
  RoutineState,
  RoutineStateInfo,
  RoutineListClient,
  RoutinePage,
  UseRoutineReturn,
  UseRoutineListOptions,
  UseRoutineListReturn,
  UseRoutineCountOptions,
  UseRoutineCountReturn,
  UseCreateRoutineReturn,
  UseResumeRoutineReturn,
  UseFireRoutineReturn,
  UseSetRoutineEnabledReturn,
  CadencePreset,
  CadenceKind,
  CadenceFieldProps,
  RoutineFormProps,
  RoutineColumnsOptions,
  RoutineRowActionsProps,
  RoutineDetailViewProps,
  RoutineFiresTableProps,
  RunRoutineDialogProps,
  RoutineApiPanelProps,
  BuildRoutineFireCurlArgs,
  UseUpdateRoutineSpecReturn,
} from "./routine/index.js";

// Environment — the packages and network a conversation's sandbox gets:
// which one applies and why (the server's order, previewed), the words for
// it, the list, the picker, and whether Environments apply here at all
export {
  ENVIRONMENT_SOURCE_ORDER,
  environmentChoiceOfStatus,
  environmentSourceName,
  environmentsNotApplying,
  resolveEnvironmentChoice,
  describeEnvironmentChoice,
  ENVIRONMENT_SOURCE_COPY,
  ENVIRONMENTS_NOT_APPLYING_COPY,
  ENVIRONMENTS_NOT_ON_SERVER_BANNER,
  inheritedRowLabel,
  LIMITED_NETWORKING_UNAVAILABLE_COPY,
  NO_ENVIRONMENT_COPY,
  PACKAGES_UNAVAILABLE_COPY,
  environmentName,
  useEnvironmentList,
  useEnvironmentsNotApplying,
  EnvironmentPicker,
  createEnvironmentListFn,
  listEnvironmentsPage,
  useEnvironmentCount,
  useEnvironment,
  useCreateEnvironment,
  useUpdateEnvironment,
  useCanCreateEnvironment,
  createEnvironmentColumns,
  describeNetworkShort,
  describePackagesShort,
  EMPTY_PACKAGES_DRAFT,
  linesOf,
  NetworkingFields,
  networkingDraftOf,
  networkingInputOf,
  PACKAGE_MANAGER_HINTS,
  PACKAGE_MANAGERS,
  packageCountOf,
  PackagesFields,
  packagesDraftOf,
  packagesInputOf,
  EnvironmentForm,
  startingNetworkOf,
  EnvironmentDetailView,
  EnvironmentIcon,
  EnvironmentsNotOnServerNotice,
  EnvironmentCreationDenied,
} from "./environment/index.js";
export type {
  EnvironmentChoice,
  EnvironmentChoiceInputs,
  EnvironmentReference,
  EnvironmentSourceName,
  EnvironmentsNotApplying,
  UseEnvironmentListReturn,
  EnvironmentPickerProps,
  EnvironmentListClient,
  EnvironmentPage,
  UseEnvironmentCountOptions,
  UseEnvironmentCountReturn,
  UseEnvironmentReturn,
  UseCreateEnvironmentReturn,
  EnvironmentEdit,
  UseUpdateEnvironmentReturn,
  UseCanCreateEnvironmentReturn,
  NetworkingDraft,
  NetworkingFieldsProps,
  PackageManager,
  PackagesDraft,
  PackagesFieldsProps,
  EnvironmentFormProps,
  EnvironmentDetailViewProps,
  EnvironmentsNotOnServerNoticeProps,
  EnvironmentCreationDeniedProps,
} from "./environment/index.js";

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
  OAuthCallbackHandler,
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
  EnvVarInput,
  SignInDestination,
  SignInReturnTo,
  UseVaultSignInReturn,
  VaultSignInPhase,
  ToolCredentialsReadiness,
  OAuthCallbackHandlerProps,
  OAuthCallbackParams,
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
} from "@stigmer/client";

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
// run-health checks, an AI judge's verdict and an eval run's checks, shown
// on every completed run its viewers can see
export {
  RunScores,
  useSessionScores,
  useRateRun,
  useUpdateRating,
  AgentQualityReportView,
  useAgentQualityReport,
  useFlaggedRuns,
  FLAGGED_PAGE_SIZE,
} from "./score/index.js";
export type {
  RunScoresProps,
  UseSessionScoresReturn,
  UseRateRunReturn,
  UseUpdateRatingReturn,
  RunRating,
  AgentQualityReportViewProps,
  UseAgentQualityReportReturn,
  UseFlaggedRunsReturn,
} from "./score/index.js";

// Charts — small inline-SVG charts drawn from the theme's chart tokens, with
// no charting dependency and a screen-reader table of their data
export { TrendChart } from "./charts/index.js";
export type {
  TrendChartProps,
  TrendMarker,
  TrendPoint,
  TrendSeries,
} from "./charts/index.js";

// ScoringRules — AI grading switched on per agent: its sample, its monthly
// spending limit and its judge model (the agent's Quality tab)
export {
  useAgentScoringRule,
  useSaveScoringRule,
  DEFAULT_GRADING_SETTINGS,
  MAX_ONE_IN,
} from "./scoring-rule/index.js";
export type {
  UseAgentScoringRuleReturn,
  UseSaveScoringRuleReturn,
  GradingSettings,
} from "./scoring-rule/index.js";

// Eval runs — test cases run on an agent, or a plugin's own cases on the
// built-in assistant, optionally with and without a plugin (the Evals tab
// of an agent and of a plugin), two eval runs compared side by side, and a
// run made into a test case
export {
  EvalRunsTab,
  EvalRunResults,
  useEvalRuns,
  useEvals,
  useEvalRun,
  useStartEvalRun,
  useCancelEvalRun,
  EVAL_RUN_POLL_MS,
  ALLOW_TOOL_PATTERN,
  DEFAULT_EVAL_FORM,
  MAX_ALLOW_TOOLS,
  MAX_CASE_TAGS,
  MAX_EVAL_CONCURRENCY,
  MAX_EVAL_COST_USD,
  MAX_EVAL_RUNS,
  MAX_EVAL_TARGETS,
  evalFormForAgent,
  allowToolsProblem,
  caseSourceRowsOf,
  caseSourceTargetLabelsOf,
  compareCaseSources,
  compareEvalRuns,
  comparedPluginOf,
  evalCaseSourceOf,
  evalFormProblem,
  evalRunInputOf,
  evalRunLabelOf,
  evalRunSectionsOf,
  evalRunVersionOf,
  evalTargetsOf,
  isAboutAgent,
  isComparing,
  parseAllowTools,
  parseCaseTags,
} from "./eval-run/index.js";
export type {
  EvalRunsTabProps,
  EvalRunResultsProps,
  EvalRunsOf,
  UseEvalRunsReturn,
  UseEvalsReturn,
  UseEvalRunReturn,
  UseStartEvalRunReturn,
  UseCancelEvalRunReturn,
  EvalCaseRow,
  EvalCaseCell,
  EvalCaseSource,
  EvalCompareRow,
  EvalCompareSide,
  EvalFormSettings,
  EvalFormTarget,
  EvalResourceLike,
  EvalRunCompareSection,
  EvalRunPluginSection,
  EvalRunSettings,
  EvalSubjectKind,
  EvalSubjectRef,
  EvalTryView,
} from "./eval-run/index.js";

// Grant — data hooks, behavior hooks, headless hook, and styled components for access management
export {
  useGrantableRoles,
  useRoleSelector,
  useResourceAccess,
  usePrincipalsCount,
  useAccessHistory,
  useWhoAmI,
  useCreateGrant,
  useDeleteGrant,
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
} from "./grant/index.js";
export type {
  AccessHistoryRetention,
  UseAccessHistoryOptions,
  UseAccessHistoryReturn,
  UseGrantableRolesReturn,
  RoleOption,
  UseRoleSelectorReturn,
  ResourceAccessRef,
  UseResourceAccessOptions,
  UseResourceAccessReturn,
  UsePrincipalsCountReturn,
  UseWhoAmIOptions,
  UseWhoAmIReturn,
  UseCreateGrantReturn,
  UseDeleteGrantReturn,
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
} from "./grant/index.js";

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
  useUpdateOrganizationPolicies,
  organizationPoliciesOf,
  useUpdateOrganizationEmbedding,
  organizationEmbeddingOf,
  useRenameOrganization,
  useOrgSlugForId,
  useOrgIdForRef,
  useCanonicalOrgSlug,
  OrgSlugText,
  CreateOrganizationForm,
  OrgProfilePanel,
  OrgPreferencesPanel,
  OrgPoliciesPanel,
  OrgEmbeddingPanel,
  formatSignInRole,
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
  OrgPoliciesPanelProps,
  OrganizationPoliciesValue,
  UseUpdateOrganizationPoliciesReturn,
  OrgEmbeddingPanelProps,
  OrganizationEmbeddingValue,
  UseUpdateOrganizationEmbeddingReturn,
  OrgSwitcherProps,
  UseChildOrganizationsOptions,
  UseChildOrganizationsReturn,
  ChildOrganizationsListProps,
} from "./organization/index.js";

// Billing — customer-facing data hooks, behavior hooks, styled components
// and formatting utilities
export {
  useBillingAccount,
  useCreateBillingPortalSession,
  usePlans,
  useSubscription,
  useEntitlements,
  usePeriodEstimate,
  useAgentHours,
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
  ProviderKeyNotice,
  providerKeyRequired,
  PROVIDER_KEY_REQUIRED,
  DEFAULT_PROVIDER_KEYS_HREF,
  AgentHoursNotice,
  agentHoursUsedUp,
  AGENT_HOURS_USED_UP,
  AgentHoursStanding,
  BillingSection,
  PaymentMethodCard,
  formatUsd,
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
  UseAgentHoursOptions,
  UseAgentHoursReturn,
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
  ProviderKeyNoticeProps,
  AgentHoursNoticeProps,
  AgentHoursUsedUp,
  AgentHoursStandingProps,
  ProviderKeyRequired,
  UseCreateBillingPortalSessionReturn,
  BillingSectionProps,
  PaymentMethodCardProps,
} from "./billing/index.js";

// Plan vocabulary — the words every surface names a plan feature and
// Enterprise Cloud with, the console's plan cards and stigmer.ai's pricing
// page alike. Re-exported from the modules that define them rather than
// through ./billing/index.js, so a server-rendered page that imports them
// by name does not take in the billing barrel's client components.
export { ENTERPRISE_CLOUD_PLAN } from "./billing/plan-features.js";
export { FEATURE_COPY, type NamedFeature } from "./internal/features.js";

// Model catalog — platform-operator authoring of the model registry
// baseline: models, capabilities and list prices (gated on
// can_manage_model_pricing)
export {
  useModelPricingBaselines,
  useModelCatalogView,
  useUpsertModelPricingBaseline,
  useRetireModelPricingBaseline,
  ModelCatalogConsole,
} from "./model-catalog/index.js";
export type {
  UseModelPricingBaselinesOptions,
  UseModelPricingBaselinesReturn,
  ModelCatalogFlow,
  ModelCatalogRow,
  UseModelCatalogViewReturn,
  UpsertModelPricingBaselineInput,
  UseUpsertModelPricingBaselineReturn,
  RetireModelPricingBaselineInput,
  UseRetireModelPricingBaselineReturn,
  ModelCatalogConsoleProps,
} from "./model-catalog/index.js";

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
  ORG_ADMIN_SETTINGS_NAV_ITEMS,
  useSettingsNavGroups,
} from "./settings/index.js";
export type { SettingsNavItem, SettingsNavGroup } from "./settings/index.js";
export { ApiKeysSection } from "./settings/index.js";
export { MembersSection } from "./settings/index.js";
export type { MembersSectionProps } from "./settings/index.js";
export { OrgProfileSection } from "./settings/index.js";
export type { OrgProfileSectionProps } from "./settings/index.js";
export { OrgPreferencesSection, OrgPoliciesSection, OrgEmbeddingSection } from "./settings/index.js";
export type { OrgEmbeddingSectionProps } from "./settings/index.js";
export { AccountPreferencesSection } from "./settings/index.js";
export { MemorySection } from "./settings/index.js";
export { VaultsSection } from "./settings/index.js";
export { InvitationsSection } from "./settings/index.js";
export { FederationIssuersSection } from "./settings/index.js";
export { ServiceAccountsSection } from "./settings/index.js";
export { TeamsSection } from "./settings/index.js";
export { AccessHistorySection } from "./settings/index.js";
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

// Service Account — an organization's own accounts for automation and their API keys
export {
  useServiceAccountList,
  useCreateServiceAccount,
  useDeleteServiceAccount,
  useServiceAccountKeyList,
  useCreateServiceAccountKey,
  ServiceAccountListPanel,
  ServiceAccountDetailPanel,
  ServiceAccountKeyListPanel,
  CreateServiceAccountForm,
  CreateServiceAccountKeyForm,
  SERVICE_ACCOUNTS_SETTINGS_HREF,
} from "./service-account/index.js";
export type {
  UseServiceAccountListReturn,
  CreateServiceAccountParams,
  UseCreateServiceAccountReturn,
  UseDeleteServiceAccountReturn,
  UseServiceAccountKeyListReturn,
  CreateServiceAccountKeyParams,
  UseCreateServiceAccountKeyReturn,
  ServiceAccountListPanelProps,
  ServiceAccountDetailPanelProps,
  ServiceAccountKeyListPanelProps,
  CreateServiceAccountFormProps,
  CreateServiceAccountKeyFormProps,
} from "./service-account/index.js";

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

// Federation Issuer — data hooks, mutation hooks, styled components, presets, and guided wizard for managing the platforms whose tokens an organization trusts
export {
  useFederationIssuerList,
  useFederationIssuer,
  useCreateFederationIssuer,
  useUpdateFederationIssuer,
  useDeleteFederationIssuer,
  FederationIssuerListPanel,
  CreateFederationIssuerForm,
  PROVIDER_PRESETS,
  getPreset,
  ProviderPicker,
  FederationIssuerWizard,
  FederationIssuerDetailPanel,
} from "./federation-issuer/index.js";
export type {
  UseFederationIssuerListReturn,
  UseFederationIssuerReturn,
  UseCreateFederationIssuerReturn,
  UseUpdateFederationIssuerReturn,
  UseDeleteFederationIssuerReturn,
  FederationIssuerListPanelProps,
  CreateFederationIssuerFormProps,
  ProviderPreset,
  ProviderVariable,
  ProviderConfig,
  ProviderPickerProps,
  FederationIssuerWizardProps,
  FederationIssuerDetailPanelProps,
} from "./federation-issuer/index.js";

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

// Chat links — a web channel's public agent profile, the chat a link's
// visitors see, and the owner's chat-link dialog with the web channel draft
// and its save inputs. The agent's Channels tab lists the links
// (ChannelsPanel, below).
export {
  useChannelAgentProfile,
  VisitorChat,
  draftFromWebChannel,
  chatLinkAudienceFromProto,
  webChannelCreateInput,
  webChannelPatch,
  webConfigOf,
  webLinkTokenOf,
  useRotateChannelLink,
  ChatLinkDialog,
  useChatLinkToolReadiness,
  validateOrigin,
  MAX_ALLOWED_ORIGINS,
} from "./chat-link/index.js";
export type {
  UseChannelAgentProfileOptions,
  UseChannelAgentProfileReturn,
  VisitorChatProps,
  WebChannelCreateIdentity,
  WebChannelDraft,
  ChatLinkAudience,
  UseRotateChannelLinkReturn,
  ChatLinkDialogProps,
  ChatLinkToolReadiness,
} from "./chat-link/index.js";

// Channel — the one kind for every way people reach an agent (chat links,
// Slack, WhatsApp): the Channel hooks, the add-a-channel behaviour, the
// Channels tab panel (every type in one list), and the per-provider connect
// dialogs.
export {
  useChannelList,
  useChannel,
  useSaveChannel,
  useCreateChannel,
  useDeleteChannel,
  useCanCreateChannel,
  useAddChannelOptions,
  channelInstallsAvailable,
  useConnectSlackChannel,
  useInstallChannel,
  useChannelToolReadiness,
  useChannelTemplateReadiness,
  useChannelSessions,
  useChannelTemplateList,
  templateStatusPhase,
  splitTemplateBody,
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
  UseChannelListReturn,
  UseChannelReturn,
  UseSaveChannelReturn,
  UseCreateChannelReturn,
  UseDeleteChannelReturn,
  UseCanCreateChannelReturn,
  AddChannelOption,
  UseAddChannelOptionsOptions,
  UseAddChannelOptionsReturn,
  ChannelTypeDescriptor,
  ChannelTypeId,
  UseConnectSlackChannelReturn,
  SlackConnectPhase,
  UseInstallChannelReturn,
  InstallChannelPhase,
  ChannelTemplateReadiness,
  UseChannelSessionsReturn,
  UseChannelTemplateListOptions,
  UseChannelTemplateListReturn,
  TemplateBodySegment,
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
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/conversation_io_pb";
export type {
  ChannelConversation,
  ConversationTimelineItem,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/conversation_io_pb";

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
  isPlanFileName,
  isPlanFile,
  findPlanFile,
  findLatestSessionPlan,
  planFilesByRun,
  findStreamingPlan,
  PLAN_FILE_NAME,
  PLAN_FILE_SUFFIX,
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
  SessionPlan,
  StreamingPlan,
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
export { createLibraryListFn } from "./search/index.js";
export type {
  LibraryClient,
  LibraryKind,
  UseResourceSearchOptions,
  UseResourceSearchReturn,
} from "./search/index.js";

// Usage — org-level usage report hook, dashboard panel, and date-range utilities
export {
  useOrgUsageReport,
  OrgUsagePanel,
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
  useRenameResource,
  ResourceActionBar,
  ResourceDetailShell,
  Section,
  ConfirmDialog,
  RenameSlugField,
  ResourceSlugField,
  RESOURCE_RENAME_HINT,
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
  RenamableResourceKind,
  RenamedResource,
  UseRenameResourceReturn,
  RenameSlugFieldProps,
  ResourceSlugFieldProps,
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

// Dependency Graph — visual tree of agent dependencies (plugins, skills, subagents)
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
  WorkbenchPageRequest,
  WorkbenchPage,
  WorkbenchListFn,
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
