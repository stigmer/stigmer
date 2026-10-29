// @stigmer/react-sdk/headless — the kit without its rendering: data hooks,
// behaviour hooks, contexts, pure logic and the types they name, for a host
// that draws its own chat (the terminal kit is one) or a product that wants
// the data without the kit's look.
//
// No module this entry reaches imports react-dom, lucide-react,
// @base-ui/react, sonner or a stylesheet, so it runs wherever React does.
// test/install/smoke-budgets.mjs bundles the entry and fails when one does.
// A hook whose module draws something (a toast, an icon, a portal) stays in
// the root entry, which re-exports everything here, so a name added here is
// importable from both.

// Provider and context
export type { ApprovalDefaults } from "./approval-defaults-context.js";
export { StigmerContext } from "./context.js";

// Runner adapter
export { type RunnerAdapter, useRunnerAdapter } from "./runner-adapter.js";

// Construction helper lives in @stigmer/client (framework-agnostic); re-exported
// here so React embedders import it alongside the adapter interface.
export { type RunnerWorkerHost, createRunnerAdapter } from "@stigmer/client";

// Fetch cache
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
export { type DeploymentMode, isResourceAvailable, ApiResourceKind } from "@stigmer/client";

// Models — data hook, styled components, and registry data
export {
  DEFAULT_MODEL_ID,
  DISABLED_PROVIDERS,
  modelKey,
  parseModelKey,
  fetchModelRegistry,
  fetchModelRegistryDocument,
  parseRegistryJson,
  parseRegistryDocument,
  useModelRegistry,
  ModelRegistryContext,
  DEFAULT_HARNESS,
  HARNESS_LABELS,
  toProtoHarness,
  fromProtoHarness,
  thinkingSelectable,
  thinkingLocked,
  useModelReadiness,
  modelReadinessCacheKey,
  useModelsHubData,
  providerFace,
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
  HarnessOption,
  VisionLimits,
  UseModelReadinessReturn,
  ModelReadiness,
  ModelReadinessLookup,
  ProviderAvailability,
  ProviderReadiness,
  ModelsHubData,
  NamedModelReadiness,
  ProviderFace,
  ProviderViewer,
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
  WorkspaceContentMatch,
  WorkspaceContentSearchResult,
  WorkspaceContentSearcher,
  UseWorkspaceContentSearchOptions,
  UseWorkspaceContentSearchReturn,
  WorkspaceContentSearchGroup,
  FileViewerHandle,
  SelectedWorkspaceFile,
  UseWorkspaceSourcesOptions,
  UseWorkspaceSourcesReturn,
  SurfaceRailView,
  SurfaceVirtualDocument,
  BuiltInViewId,
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
  useSessionPanel,
  CONVERSATION_FILES_VIEW_ID,
  usePlanDraft,
  planDraftKey,
  PLAN_DOCUMENT_ENTRY_ID,
  PLAN_DOCUMENT_PATH,
  FILE_DOCUMENT_ENTRY_ID,
  useAttentionNotifications,
  noticeOf,
  useAttentionNotificationsSetting,
  ATTENTION_NOTIFICATIONS_KEY,
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
  UseNewSessionFlowOptions,
  UseNewSessionFlowReturn,
  UseSessionPageFlowOptions,
  UseSessionPageFlowReturn,
  UsePersistedModelOptions,
  UsePersistedModelReturn,
  SessionGroup,
  SearchResultGroup,
  SessionPanelController,
  UseSessionPanelOptions,
  UseSessionRailViewsOptions,
  PlanDraftController,
  ExecutionTargetOption,
  SessionAudience,
  SessionPanelMode,
  // The #664 pinning seam's contract type: SessionViewer/NewSessionViewer/
  // useNewSessionFlow all accept it and the docs name it, so it is exported
  // from every entry that exports them (oss#802: an embedder could not name it).
  SessionRunConfig,
  SetupTabMutationCallbacks,
  SetupTabAutoApprove,
  AttentionNotice,
  AttentionReason,
  UseAttentionNotificationsOptions,
  AttentionNotificationsSetting,
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
  useStopBackgroundCommand,
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
  findActiveTodo,
  todoCompletionSummary,
  resolveInjectedFacts,
  formatTokenCount,
  summarizeResultView,
  useToolPresentation,
  registerToolPresenter,
  getToolPresenter,
  resolveToolCategory,
  resolveToolCategoryFromCall,
  resolveToolCategoryFromKind,
  toolKindToCategoryInfo,
  defaultDisclosureForCategory,
  extractPrimaryArg,
  subagentSubjectOf,
  extractShellIntent,
  extractShellIntentFromPreview,
  SHELL_INTENT_ARG_FIELD,
  parseMcpResult,
  formatDuration,
  humanizeToolName,
  ApprovalContext,
  BackgroundCommandContext,
  useBackgroundStop,
  backgroundStatusLabel,
  useApproval,
  FileReviewContext,
  useFileReviewRowState,
  useFileReviewRowChange,
  fromFile,
  isImageFile,
  isZipFile,
  useFileInspection,
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
  parseDiffStatSummary,
  trailingDiffStatLine,
  writeBackDisplayName,
  deriveRunFileChanges,
  toFileDiffEntry,
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
  UseStopBackgroundCommandReturn,
  ToolUseAnswer,
  UseReviewFileChangesReturn,
  ReviewFileChangesOptions,
  FileReviewAction,
  UseChangeSetCaptureReturn,
  FileReviewability,
  FileBlockReason,
  ChangeSetReviewability,
  FileReviewRowState,
  ToolPresentation,
  ToolPresenter,
  ToolDisclosure,
  ThreadMessage,
  UserMessageItem,
  MessageThreadSlots,
  ThreadContentColumn,
  ApprovalContextValue,
  BackgroundCommandContextValue,
  UseBackgroundStopResult,
  UseApprovalResult,
  FileReviewContextValue,
  FileRowItem,
  FileInspection,
  UseFileInspectionOptions,
  TextRenderMode,
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
  DiffStatSummary,
  EmptyChangeKind,
} from "./run/index.js";

// Upload — the chat box's file uploads (Stigmer Files), styled chip list,
// clipboard paste, vision-resolution image preparation, and vision
// preflight warnings
export {
  useFileUploads,
  toFileChipView,
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
  describeFileType,
  describeUploaded,
  useFileCount,
  useCanCreateFile,
  LIBRARY_UPLOAD_CONCURRENCY,
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
  FileUploadStatus,
} from "./file/index.js";

// File Reference — workspace file-reference behavior hook and styled chip list
export { useFileReferences } from "./file-reference/index.js";
export type { UseFileReferencesReturn } from "./file-reference/index.js";
export { FILE_REF_MIME } from "./internal/file-tree/index.js";

// Composer — unified message input with model, workspace, and file uploads
export { useComposer } from "./composer/index.js";
export type {
  UseComposerOptions,
  UseComposerReturn,
  SessionComposerHandle,
  ComposerSetting,
  ConfigureMenuItem,
  SessionComposerSubmitContext,
  InteractionModeOption,
} from "./composer/index.js";

// Skill — data hooks, upload, file browser, and mutation
export {
  useSkill,
  useSkillCount,
  useSkillList,
  useSkillSearch,
  usePushSkill,
  useSkillUpload,
  useSkillArtifact,
  useSkillVersions,
  useSkillDiff,
  useSkillDuplicateCheck,
} from "./skill/index.js";
export type {
  UseSkillReturn,
  UseSkillCountOptions,
  UseSkillCountReturn,
  UseSkillListOptions,
  UseSkillListReturn,
  UseSkillSearchOptions,
  UseSkillSearchReturn,
  PushSkillInput,
  UsePushSkillReturn,
  SkillUploadPreview,
  SkillFileEntry,
  UseSkillUploadReturn,
  UseSkillArtifactReturn,
  UseSkillVersionsReturn,
  UseSkillDiffReturn,
  UseSkillDuplicateCheckReturn,
  SkillDiffDialogState,
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
  reachedBy,
  CATALOG_PAGE_SIZE,
  filterEntries,
  matchesQuery,
  monogramRing,
  publisherOf,
  describeSource,
  usePluginUpload,
  looksLikeDroppedDotfiles,
  summariseInstall,
  usePluginServerSignIn,
  usePluginTools,
  headerRowsOf,
  useCanCreatePlugin,
  mcpServerPluginFiles,
  prepareMcpServerPlugin,
  useAddMcpServer,
  useAddPluginToAgent,
  toolsLeaveOut,
  listsPlugin,
  withPlugin,
  PLUGIN_PICKS_STORAGE_KEY,
  readRememberedPluginPicks,
  rememberPluginPicks,
  describeOrigin,
  LocalPluginError,
  folderPick,
  folderPickFromInput,
  zipPick,
  prepareLocalPlugin,
  formatMib,
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
  PluginServerSignInKind,
  UsePluginServerSignInReturn,
  UsePluginServerSignInOptions,
  UsePluginToolsReturn,
  HeaderRow,
  UseCanCreatePluginReturn,
  AddMcpServerOptions,
  McpServerFormInput,
  UseAddMcpServerReturn,
  AddPluginOutcome,
  AddPluginPhase,
  PluginOffer,
  UseAddPluginToAgentReturn,
  PluginUploadPhase,
  UsePluginUploadReturn,
} from "./plugin/index.js";

// GitHub — OAuth connection, repo picker, tree lister, and hooks
export {
  useGitHubConnection,
  useGitHubRepos,
  useGitHubSearch,
  useGitHubTreeLister,
  useGitHubFileReader,
  parseGitUrl,
} from "./github/index.js";
export type {
  GitHubUser,
  UseGitHubConnectionConfig,
  UseGitHubConnectionReturn,
  GitHubRepo,
  GitHubBranch,
  UseGitHubReposReturn,
  UseGitHubSearchReturn,
  ParsedGitRepo,
} from "./github/index.js";

// Agent — data hook, count hook, list hook, search hook, picker, detail view, versions, env form, setup orchestration, env diffing, creation wizard, update
export {
  useAgent,
  useAgentCount,
  useAgentList,
  useAgentSearch,
  useAgentVersions,
  useAgentVersionCount,
  agentVersionLabel,
  diffEnv,
  useAgentSetup,
  useCreateAgent,
  useUpdateAgent,
  useCanCreateAgent,
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
  UseAgentVersionsReturn,
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
  UseCanCreateAgentReturn,
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
  cadenceToCron,
  cronToCadence,
  describeCadence,
  validateCron,
  validateTimeZone,
  WEEKDAY_LABELS,
  FIRE_TEXT_MAX_LEN,
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
  RoutineColumnsOptions,
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
  createEnvironmentListFn,
  listEnvironmentsPage,
  useEnvironmentCount,
  useEnvironment,
  useCreateEnvironment,
  useUpdateEnvironment,
  useCanCreateEnvironment,
  describeNetworkShort,
  describePackagesShort,
  EMPTY_PACKAGES_DRAFT,
  linesOf,
  networkingDraftOf,
  networkingInputOf,
  PACKAGE_MANAGER_HINTS,
  PACKAGE_MANAGERS,
  packageCountOf,
  packagesDraftOf,
  packagesInputOf,
  startingNetworkOf,
} from "./environment/index.js";
export type {
  EnvironmentChoice,
  EnvironmentChoiceInputs,
  EnvironmentReference,
  EnvironmentSourceName,
  EnvironmentsNotApplying,
  UseEnvironmentListReturn,
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
  PackageManager,
  PackagesDraft,
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
  MY_VAULT_LABEL,
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
  VaultPickerMyVault,
  ConversationVaults,
  EnvVarFormVariable,
  EnvVarInput,
  SignInDestination,
  SignInReturnTo,
  UseVaultSignInReturn,
  VaultSignInPhase,
  ToolCredentialsReadiness,
  OAuthCallbackParams,
} from "./vault/index.js";

// Identity Account — gate hook, self-account data/mutation hooks, the
// account preferences editor, and the composer-seeding execution defaults
export {
  useIdentityAccountGate,
  useMyIdentityAccount,
  useAccountExecutionDefaults,
  useUpdateIdentityAccount,
} from "./identity-account/index.js";
export type {
  IdentityAccountGateState,
  UseIdentityAccountGateReturn,
  UseMyIdentityAccountOptions,
  UseMyIdentityAccountReturn,
  AccountExecutionDefaults,
  UseUpdateIdentityAccountReturn,
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
} from "./memory/index.js";
export type {
  UseMemoriesReturn,
  UseMemoryReturn,
  UseConfirmMemoryReturn,
  UseRejectMemoryReturn,
  UseDeleteMemoryReturn,
  UseUpdateMemoryContentReturn,
  MemoryGroups,
} from "./memory/index.js";

// Scores — a person's thumbs on a run's final answer, the platform's free
// run-health checks, an AI judge's verdict and an eval run's checks, shown
// on every completed run its viewers can see
export {
  useSessionScores,
  useRateRun,
  useUpdateRating,
  useAgentQualityReport,
  useFlaggedRuns,
  FLAGGED_PAGE_SIZE,
} from "./score/index.js";
export type {
  UseSessionScoresReturn,
  UseRateRunReturn,
  UseUpdateRatingReturn,
  RunRating,
  UseAgentQualityReportReturn,
  UseFlaggedRunsReturn,
} from "./score/index.js";

// Charts — small inline-SVG charts drawn from the theme's chart tokens, with
// no charting dependency and a screen-reader table of their data
export type { TrendMarker, TrendPoint, TrendSeries } from "./charts/index.js";

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
  providerLabel,
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
  SelectedGrantee,
  GranteeCandidate,
  PersonCandidate,
  TeamCandidate,
  UseGranteeCandidatesOptions,
  UseGranteeCandidatesReturn,
} from "./grant/index.js";

// Access — unified "Manage access" experience (visibility + people) as one
// dialog, with a kebab hook and a visible-button trigger.
export type {
  UseManageAccessArgs,
  UseManageAccessReturn,
  AccessResource,
  AccessVisibility,
} from "./access/index.js";

// Organization — context provider, hooks, data hooks, behavior hooks, styled form, profile panel, org switcher, and child organizations
export {
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
  formatSignInRole,
  useChildOrganizations,
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
  OrganizationPoliciesValue,
  UseUpdateOrganizationPoliciesReturn,
  OrganizationEmbeddingValue,
  UseUpdateOrganizationEmbeddingReturn,
  UseChildOrganizationsOptions,
  UseChildOrganizationsReturn,
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
  useChangePlan,
  useCancelSubscription,
  useCreatePaymentMethodSetupSession,
  planStanding,
  planMove,
  ENTERPRISE_CONTACT_URL,
  PAYMENT_METHOD_REQUIRED,
  planUpgradeFeature,
  PLAN_UPGRADE_REQUIRED,
  DEFAULT_BILLING_HREF,
  providerKeyRequired,
  PROVIDER_KEY_REQUIRED,
  DEFAULT_MODELS_HUB_HREF,
  agentHoursUsedUp,
  AGENT_HOURS_USED_UP,
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
  UseChangePlanReturn,
  UseCancelSubscriptionReturn,
  UseCreatePaymentMethodSetupSessionReturn,
  BillingRedirect,
  PlanStanding,
  PlanMove,
  AgentHoursUsedUp,
  ProviderKeyRequired,
  UseCreateBillingPortalSessionReturn,
} from "./billing/index.js";

// Plan vocabulary — the words every surface names a plan feature, a plan's
// terms, Free and Enterprise Cloud with, the console's plan cards and
// stigmer.ai's pricing page alike. Re-exported from the modules that define them rather than
// through ./billing/index.js, so a server-rendered page that imports them
// by name does not take in the billing barrel's client components.
export {
  ENTERPRISE_CLOUD_PLAN,
  FREE_PLAN,
  offeredFeatures,
  planTermLines,
} from "./billing/plan-features.js";
export { FEATURE_COPY, type NamedFeature } from "./internal/features.js";

// API Key — data hooks, behavior hooks, and styled components for API key lifecycle
export { useApiKeyList, useCreateApiKey, useDeleteApiKey } from "./api-key/index.js";
export type {
  UseApiKeyListReturn,
  UseCreateApiKeyReturn,
  UseDeleteApiKeyReturn,
} from "./api-key/index.js";

// Service Account — an organization's own accounts for automation and their API keys
export {
  useServiceAccountList,
  useCreateServiceAccount,
  useDeleteServiceAccount,
  useServiceAccountKeyList,
  useCreateServiceAccountKey,
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
} from "./service-account/index.js";

// OAuth App — data hooks, mutation hooks, and styled components for OAuth app management
export {
  useOAuthAppList,
  useCreateOAuthApp,
  useUpdateOAuthApp,
  useDeleteOAuthApp,
} from "./oauth-app/index.js";
export type {
  UseOAuthAppListReturn,
  UseCreateOAuthAppReturn,
  UseUpdateOAuthAppReturn,
  UseDeleteOAuthAppReturn,
} from "./oauth-app/index.js";

// Channel App — data hooks, mutation hooks, styled components, and Slack
// setup helpers for bring-your-own channel apps
export {
  useChannelAppList,
  useCreateChannelApp,
  useUpdateChannelApp,
  useDeleteChannelApp,
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
  SlackChannelAppManifestInput,
} from "./channel-app/index.js";

// Federation Issuer — data hooks, mutation hooks, styled components, presets, and guided wizard for managing the platforms whose tokens an organization trusts
export {
  useFederationIssuerList,
  useFederationIssuer,
  useCreateFederationIssuer,
  useUpdateFederationIssuer,
  useDeleteFederationIssuer,
  PROVIDER_PRESETS,
  getPreset,
} from "./federation-issuer/index.js";
export type {
  UseFederationIssuerListReturn,
  UseFederationIssuerReturn,
  UseCreateFederationIssuerReturn,
  UseUpdateFederationIssuerReturn,
  UseDeleteFederationIssuerReturn,
  ProviderPreset,
  ProviderVariable,
  ProviderConfig,
} from "./federation-issuer/index.js";

// Teams — an organization's named groups of people that access is shared
// with as one (Enterprise and Cloud editions)
export {
  useTeamList,
  useTeam,
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
  TEAM_DESCRIPTION_MAX_LENGTH,
} from "./team/index.js";
export type {
  UseTeamListReturn,
  UseTeamReturn,
  UseCreateTeamReturn,
  UseUpdateTeamReturn,
  UseDeleteTeamReturn,
} from "./team/index.js";

// Invitation — data hooks, behavior hooks, and feature components for org invite links
export {
  useOrgInvitations,
  useCreateInvitation,
  useRevokeInvitation,
  useInvitationPreview,
  useRedeemInvitation,
} from "./invitation/index.js";
export type {
  UseOrgInvitationsOptions,
  UseOrgInvitationsReturn,
  UseCreateInvitationReturn,
  UseRevokeInvitationReturn,
  UseInvitationPreviewReturn,
  UseRedeemInvitationReturn,
} from "./invitation/index.js";

// Connect links — the public page a Connect link opens and its callback
export {
  useConnectLink,
  pendingConnectLinkToken,
  clearPendingConnectLinkToken,
  CONNECT_LINK_PENDING_KEY,
  DEAD_CONNECT_LINK_MESSAGE,
} from "./connect-link/index.js";
export type { UseConnectLinkReturn } from "./connect-link/index.js";

// Chat links — a web channel's public agent profile, the chat a link's
// visitors see, and the owner's chat-link dialog with the web channel draft
// and its save inputs. The agent's Channels tab lists the links
// (ChannelsPanel, below).
export {
  useChannelAgentProfile,
  draftFromWebChannel,
  chatLinkAudienceFromProto,
  webChannelCreateInput,
  webChannelPatch,
  webConfigOf,
  webLinkTokenOf,
  useRotateChannelLink,
  useChatLinkToolReadiness,
  validateOrigin,
  MAX_ALLOWED_ORIGINS,
} from "./chat-link/index.js";
export type {
  UseChannelAgentProfileOptions,
  UseChannelAgentProfileReturn,
  WebChannelCreateIdentity,
  WebChannelDraft,
  ChatLinkAudience,
  UseRotateChannelLinkReturn,
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
  channelInstallsAvailable,
  useConnectSlackChannel,
  useInstallChannel,
  useChannelToolReadiness,
  useChannelTemplateReadiness,
  useChannelSessions,
  useChannelTemplateList,
  templateStatusPhase,
  splitTemplateBody,
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
} from "./channel/index.js";

// Conversation — the channel conversation surface: the org-wide list, one
// conversation's row and timeline, the participation commands (reply / takeOver
// / handBack / clearAttention), and the pure render vocabulary shared by every
// conversation view.
export {
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
  ConversationHeaderContext,
  ConversationIdentity,
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
export { isSecretFlowError } from "./error/index.js";

// Library — cross-resource UI components, resource detection, apply flow, browsing, and visibility management
export {
  useBreadcrumbLabel,
  useBreadcrumbOverride,
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
  blueprintVisibilityLevels,
  visibilityLabel,
  useUpdateVisibility,
} from "./library/index.js";
export type {
  StigmerResourceKind,
  StigmerResourceDetection,
  SessionPlan,
  StreamingPlan,
  UseApplyResourceReturn,
  ApplyResourceResult,
  PushSkillParams,
  UseExportResourceOptions,
  UseExportResourceReturn,
  VisibilityLevelOption,
  BlueprintVisibilityLevelsContext,
  VisibilityResourceKind,
  UseUpdateVisibilityReturn,
} from "./library/index.js";

// Manifest — kind-agnostic YAML edit/apply (editor, hooks, dialogs)
export { useEditResourceYaml, useApplyManifest } from "./manifest/index.js";
export type {
  EditYamlTarget,
  EditYamlValidation,
  UseEditResourceYamlOptions,
  UseEditResourceYamlReturn,
  ManifestEntryStatus,
  ManifestPreviewEntry,
  UseApplyManifestReturn,
} from "./manifest/index.js";

// Empty state — reusable empty/zero/permission/error state primitives
export type {
  EmptyStateVariant,
  EmptyStateAction,
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
  useExportCSV,
  DATE_RANGE_PRESETS,
  dateRangeFromPreset,
  formatDateRange,
  presetLabel,
} from "./usage/index.js";
export type {
  UseOrgUsageReportReturn,
  UseExportCSVReturn,
  ExportFormat,
  DateRange,
  DateRangePreset,
} from "./usage/index.js";

// Tabs — accessible tabbed panel primitive
export type { TabItem } from "./tabs/index.js";

// Button — shared action primitive (variants for the console's action tiers)
export type { ButtonSize, ButtonVariant } from "./button/index.js";

// Resource Detail — headless hooks, action bar, and composed shell for resource detail pages
export {
  useConfirmAction,
  useRenameResource,
  RESOURCE_RENAME_HINT,
} from "./resource-detail/index.js";
export type {
  AdditionalTab,
  DetailAction,
  ResourceHeaderMeta,
  ConfirmOptions,
  ConfirmState,
  UseCopyResourceReturn,
  UseConfirmActionReturn,
  DeletableResourceKind,
  UseDeleteResourceReturn,
  RenamableResourceKind,
  RenamedResource,
  UseRenameResourceReturn,
} from "./resource-detail/index.js";

// Resource Creation — shared wizard infrastructure for multi-step creation flows
export {
  useWizardState,
  useTemplateFilter,
  TEMPLATE_CATEGORY_LABELS,
  AGENT_TEMPLATES,
} from "./resource-creation/index.js";
export type {
  EnvVarEntry,
  KeyValueEntry,
  WizardStepDef,
  WizardState,
  UseWizardStateOptions,
  UseWizardStateReturn,
  UseTemplateFilterOptions,
  UseTemplateFilterReturn,
  ResourceTemplate,
  TemplateCategory,
  CreationPath,
} from "./resource-creation/index.js";

// Dependency Graph — visual tree of agent dependencies (plugins, skills, subagents)
export { useDependencyGraph } from "./dependency-graph/index.js";
export type {
  NodeKind,
  DependencyNode,
  DependencyTree,
  UseDependencyGraphOptions,
  UseDependencyGraphReturn,
} from "./dependency-graph/index.js";

// Version History — generic timeline, diff infrastructure for versioned resources
export { computeDiff, computeMultiFileDiff } from "./version-history/index.js";
export type {
  VersionEntry,
  DiffLine,
  DiffHunk,
  FileDiffEntry,
  MultiFileDiffResult,
  DiffViewMode,
} from "./version-history/index.js";

// Inline Edit — click-to-edit field primitives for detail page inline editing
export { useInlineFieldSave } from "./inline-edit/index.js";
export type {
  UseInlineFieldSaveReturn,
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
} from "./dashboard/index.js";
