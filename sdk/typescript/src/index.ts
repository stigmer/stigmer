// Public API for @stigmer/sdk

// Top-level client
export { Stigmer } from "./stigmer.js";

// Runner adapter
export {
  type RunnerAdapter,
  type RunnerWorkerHost,
  createRunnerAdapter,
} from "./runner-adapter.js";

// Configuration
export { type StigmerConfig, type TokenProvider } from "./config.js";

// Guest auth (shared-agent pages and embeds; browser-safe, credential-free)
export {
  createGuestAuth,
  GuestAuth,
  type GuestAuthConfig,
  type GuestIdStorage,
} from "./guest-auth.js";

// Agent sharing (hosted link + embed snippet; framework-free)
export {
  MAX_ALLOWED_ORIGINS,
  LINK_TOKEN_PARAM,
  validateOrigin,
  chatPath,
  buildChatUrl,
  appendLinkToken,
  buildEmbedLoaderUrl,
  buildEmbedSnippet,
} from "./sharing.js";

// References the server returned (a deleted target has an id and no slug)
export {
  isDeletedReference,
  deletedReferenceLabel,
  type ReturnedReference,
} from "./references.js";

// An organization's access history, exported as JSON Lines (one format
// for the CLI and the console)
export {
  exportAccessHistory,
  accessHistoryJsonLine,
  type AccessHistoryEntry,
  type ExportAccessHistoryOptions,
  type RemovedAccessHistory,
} from "./access-history.js";

// Error handling
export {
  StigmerError,
  type ErrorCode,
  isNotFound,
  isUnauthenticated,
  isPermissionDenied,
  isRetryable,
  isUnimplemented,
  type ErrorCategory,
  isConnectError,
  classifyError,
  isRetryableError,
  isTransientStreamError,
  getUserMessage,
  type ErrorReason,
  getErrorReason,
  type RpcErrorMetadata,
  annotateRpcError,
  getRpcMetadata,
} from "./errors.js";

// Edition vocabulary and resource availability
export {
  type DeploymentMode,
  deploymentModeOf,
  isResourceAvailable,
} from "./resource-availability.js";

// The first-sign-in flow: resolve the caller's identity account, provisioning
// it on a first sign-in. One home for every surface (console gate, CLI,
// platform builders' own gates).
export {
  ensureMyIdentityAccount,
  type EnsuredIdentityAccount,
  type EnsureMyIdentityAccountOptions,
  type IdentityAccountLane,
} from "./ensure-identity-account.js";

// Authorization config and IAM role utilities
export {
  getGrantableRoles,
  hasGrantableRoles,
  isRoleGrantable,
  getTeamGrantableRoles,
  hasTeamGrantableRoles,
  isRoleTeamGrantable,
} from "./authorization-config.js";
export {
  type Grantee,
  type GranteeKind,
  personGrantee,
  teamGrantee,
  granteeRef,
  granteeFromView,
  granteeKey,
  isAppUserAccount,
  isServiceAccount,
} from "./iam-principal.js";
export {
  iamRoleToString,
  iamRoleFromString,
  iamRoleDisplayName,
  iamRoleDescription,
  grantableRoleDescription,
} from "./iam-role.js";
export { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

// Activity client (unified recents)
export {
  ActivityClient,
  type ListRecentActivityParams,
  type ListRecentActivityResponse,
} from "./activity.js";
export type { RecentActivityEntry as RecentActivityEntryProto } from "./activity.js";

// Billing client
export {
  BillingClient,
  type CreateBillingPortalSessionParams,
  type CreatePaymentMethodSetupSessionParams,
} from "./billing.js";

// Token client (mint user tokens from your product's backend)
export {
  TokenClient,
  type MintUserTokenInput,
  type MintUserTokenResult,
} from "./tokens.js";

// Search client
export {
  SearchClient,
  type SearchParams,
  type SearchResponse,
  ApiResourceKind,
} from "./search.js";

// GitHub server-side repository reads
export {
  GitHubClient,
  type GitHubRepoParams,
} from "./github.js";

// Platform client (server info / edition detection)
export { PlatformClient, type ServerInfo } from "./platform.js";

// Manifest engine (kind-agnostic YAML ⇄ proto ⇄ apply)
export {
  ManifestClient,
  parseManifest,
  serializeManifest,
  toDesiredState,
  applyNamingCurrentSlug,
  followDeclaredSlug,
  resolveManifestTarget,
  SlugChangeRefusedError,
  SlugRenamedError,
  manifestDocumentForResource,
  manifestKinds,
  manifestHandlerForYamlKind,
  manifestHandlerForTypeName,
  metadataOf,
  MCP_SERVER_WAY_FORWARD,
  mcpServerWayForward,
  SUBAGENTS_WAY_FORWARD,
  subagentsWayForward,
  retiredShapeWayForward,
  REDACTED_SECRET_MARKER,
  containsRedactedSecrets,
  type AppliedManifest,
  type DeclaredSlugOutcome,
  type ManifestTarget,
  type SlugRulesHandler,
  type TargetDocument,
  type ManifestDocument,
  type ManifestKindHandler,
  type ParseManifestOptions,
} from "./manifest/index.js";

// Shared types (from generated code)
export {
  type DeleteResourceInput,
  type ResourceRef,
} from "./gen/types.js";
// Page walking for the one list shape: each generated client's
// `<method>All` iterators cover its own lists; these serve hand-written
// reads and a caller that needs a whole list at once.
export {
  everyEntry,
  readEveryPage,
  READ_EVERY_PAGE_DEFAULT_CAP,
  type ListPage,
} from "./pages.js";
// A stored reference as a ResourceRef input (its id, version and kind
// kept): how a form reads the references it edits from a loaded resource.
export { toResourceRefInput, toResourceRefInputs } from "./gen/proto-utils.js";

// Re-export all resource client classes and input types. An update takes
// the resource and the paths it changes (`client.<kind>.update(resource,
// paths)`): every field it does not name keeps its stored value.
export {
  AgentClient,
  buildAgentProto,
  type AgentInput,
  type AgentMcpServerInput,
  type EnvVarDeclarationInput,
  type HookSourceInput,
} from "./gen/agent.js";
export {
  AgentChannelClient,
  buildAgentChannelProto,
  type AgentChannelInput,
  type SlackChannelConfigInput,
} from "./gen/agentchannel.js";
export {
  RunClient,
  type RunInput,
  type AttachmentInput,
} from "./gen/run.js";
export {
  AgentShareClient,
  buildAgentShareProto,
  type AgentShareInput,
  type AgentShareMessagesInput,
} from "./gen/agentshare.js";
export {
  ApiKeyClient,
  type ApiKeyInput,
} from "./gen/apikey.js";
export {
  ChannelAppClient,
  buildChannelAppProto,
  type ChannelAppInput,
  type SlackChannelAppConfigInput,
} from "./gen/channelapp.js";
export {
  GrantClient,
  type GrantInput,
  type ApiResourceRefInput,
} from "./gen/grant.js";
export {
  IdentityAccountClient,
  buildIdentityAccountProto,
  type IdentityAccountInput,
} from "./gen/identityaccount.js";
export { InvitationClient, type InvitationInput } from "./gen/invitation.js";
export {
  FederationIssuerClient,
  buildFederationIssuerProto,
  type FederationIssuerInput,
} from "./gen/federationissuer.js";
export {
  TeamClient,
  buildTeamProto,
  type TeamInput,
} from "./gen/team.js";
export {
  OAuthAppClient,
  buildOAuthAppProto,
  type OAuthAppInput,
} from "./gen/oauthapp.js";
export {
  MemoryClient,
  buildMemoryProto,
  type MemoryInput,
  type MemoryProvenanceInput,
} from "./gen/memory.js";
export {
  ScoreClient,
  buildScoreProto,
  type ScoreInput,
  type ScoreCriterionInput,
} from "./gen/score.js";
export {
  EvaluatorClient,
  buildEvaluatorProto,
  type EvaluatorInput,
} from "./gen/evaluator.js";
// Eval runs: test cases run on an agent, or on a plugin on the built-in
// assistant, optionally with and without a plugin. An eval run is started
// and read, never applied, so it has no update input; the result document
// and the case builder are the pure reads the CLI and the console share.
export {
  EvalRunClient,
  buildEvalRunProto,
  type EvalRunInput,
  type EvalRunCaseSourceInput,
  type EvalRunTargetInput,
} from "./gen/evalrun.js";
export {
  toResultDocument,
  evalRunTargetLabel,
  type EvalRunEvalResult,
  type EvalRunPluginResult,
  type EvalRunResultDocument,
  type ResultAggregates,
  type ResultCase,
  type ResultDocumentOptions,
  type ResultNotRun,
  type ResultPartialReason,
  type ResultRun,
  type ResultSubject,
  type ResultTarget,
  resultBlockOf,
  type ResultBlock,
} from "./eval-run/result-document.js";
export { ALLOW_TOOL_PATTERN } from "./eval-run/allow-tools.js";
export {
  VaultClient,
  buildVaultProto,
  type VaultInput,
  type VaultSecretInput,
  type VaultConnectionInput,
  type VaultConnectionSignInInput,
} from "./gen/vault.js";
export {
  OrganizationClient,
  buildOrganizationProto,
  type OrganizationInput,
} from "./gen/organization.js";
// The billing kinds (cloud_only): the plan catalog, an organization's
// subscription, and issued licenses. The entitlement input types are
// emitted once per module that uses them, identical in shape; this barrel
// exports the plan's copy. A subscription is created by the payment system,
// never by a client, so no input type is exported for it.
export {
  PlanClient,
  type PlanInput,
  type PlanTermsInput,
  type EntitlementsInput,
  type EntitlementLimitsInput,
} from "./gen/plan.js";
export { SubscriptionClient } from "./gen/subscription.js";
export {
  LicenseClient,
  buildLicenseProto,
  type LicenseInput,
  type LicenseCustomerInput,
} from "./gen/license.js";
export {
  ScheduleClient,
  buildScheduleProto,
  type ScheduleInput,
  type AgentInvocationInput,
  type RunConfigInput,
} from "./gen/schedule.js";
export {
  SessionClient,
  buildSessionProto,
  type SessionInput,
  type WorkspaceEntryInput,
  type WorkspaceSourceInput,
  type GitRepoSourceInput,
  type LocalPathSourceInput,
} from "./gen/session.js";

// Session utilities (hand-written)
export {
  BUILT_IN_ASSISTANT_NAME,
  PENDING_SUBJECT,
  SESSION_CONTEXT_METADATA_KEY,
  isBuiltInAssistant,
  mergeSessionContext,
  resolvedSubject,
} from "./session.js";

// Tool-call view model (framework-agnostic; shared by @stigmer/react and @stigmer/ink)
export {
  type ToolKind,
  resolveToolKind,
  resolveToolKindByName,
  normalizeToolResult,
  SHELL_INTENT_ARG_FIELD,
  extractShellIntent,
  shellIntentFromArgs,
  isSecretArgKey,
  redactSecretArgs,
  type ToolResultView,
  type ToolSearchMatch,
  type ToolContentBlock,
} from "./run/tool-view.js";
export {
  describeApprovalPolicySource,
  hookApproveAllLabel,
  isInformativePolicySource,
} from "./run/approval-provenance.js";
export {
  HOOK_FORMAT_LABELS,
  hookEventLabel,
  hookFormatName,
  hookMatcherLabel,
  hooksSummary,
  type HookFormatName,
} from "./hook-words.js";
export { isTerminalPhase } from "./run/run-phases.js";
// A session's events, folded: the one model every client reads a
// conversation from (@stigmer/session-log), and the helpers that follow a
// session and wait for a turn.
export {
  SessionLog,
  foldSession,
  turnOf,
  textOf,
  previewPlaceOf,
  applyTodoUpdate,
  isTodoTool,
  eventTypeOf,
  eventIdOf,
  isStigmerEventType,
  toManagedAgentsJson,
  toManagedAgentsStreamJson,
  TURN_ENDED_PHASES,
  type CompactedItem,
  type FileReviewDecision,
  type FileReviewFile,
  type FileReviewReconcile,
  type FileReviewSet,
  type MemoryRecall,
  type MessageItem,
  type NoteItem,
  type PermissionGrant,
  type SessionFold,
  type SessionStatusView,
  type ThinkingItem,
  type Thread,
  type Todo,
  type ToolAsk,
  type ToolConfirmation,
  type ToolFullOutput,
  type ToolResult,
  type ToolUse,
  type ToolUseState,
  type Turn,
  type TurnError,
  type TurnItem,
  type TurnPhase,
  type TurnStatus,
  type UserMessage,
} from "@stigmer/session-log";
export {
  ALL_SESSION_PREVIEWS,
  followSession,
  newestSeq,
  sendAndWait,
  waitForTurn,
  type FollowSessionOptions,
  type SendAndWaitClient,
  type SendAndWaitInput,
  type SessionEventsClient,
  type SessionPreviewType,
  type TurnOutcome,
  type WaitOptions,
} from "./session-events.js";
export {
  sortChronologically,
  supersededRunIds,
  isBuildFromPlanTurn,
  syntheticUserPrompt,
  runIdFromStorageKey,
} from "./run/conversation-rules.js";
export {
  assembleSessionTranscript,
  fetchSessionTranscript,
  resolveOffloadedOutputs,
  transcriptToMarkdown,
  transcriptToJson,
  type SessionTranscript,
  type TranscriptTurn,
  type ResolvedToolOutput,
  type SessionTranscriptClient,
  type AssembleSessionTranscriptOptions,
  type FetchSessionTranscriptOptions,
  type TranscriptToMarkdownOptions,
} from "./run/transcript.js";
export { displayFileChangeSets, fileChangeSetOf } from "./run/file-review-fold.js";
export {
  displayChangeTypeOf,
  toDisplayFileChange,
  type DisplayFileChange,
  type DisplayFileChangeType,
} from "./run/to-display-file-change.js";
export { SkillClient, type SkillInput } from "./gen/skill.js";
export { RoutedSkillClient, MAX_INLINE_ARTIFACT_BYTES } from "./skill.js";
export { PluginClient, type PluginInput, type PluginAuthorInput } from "./gen/plugin.js";
export { RoutedPluginClient } from "./plugin.js";
export { EvalClient, type EvalInput } from "./gen/eval.js";
export {
  RoutedEvalClient,
  downloadEvalArchive,
  type DownloadedEvalArchive,
  type EvalArchiveReader,
} from "./eval.js";

// The input a loaded resource restates, for copying it into a new resource
// (`create({ ...toScheduleInput(res), id: undefined })`). An update never
// needs one: it takes the resource itself and the paths it changes.
export { toAgentInput } from "./gen/agent.js";
export { toAgentChannelInput } from "./gen/agentchannel.js";
export { toAgentShareInput } from "./gen/agentshare.js";
export { toApiKeyInput } from "./gen/apikey.js";
export { toChannelAppInput } from "./gen/channelapp.js";
export { toEvaluatorInput } from "./gen/evaluator.js";
export { toIdentityAccountInput } from "./gen/identityaccount.js";
export { toFederationIssuerInput } from "./gen/federationissuer.js";
export { toMemoryInput } from "./gen/memory.js";
export { toOAuthAppInput } from "./gen/oauthapp.js";
export { toOrganizationInput } from "./gen/organization.js";
export { toRunInput } from "./gen/run.js";
export { toScheduleInput } from "./gen/schedule.js";
export { toScoreInput } from "./gen/score.js";
export { toSessionInput } from "./gen/session.js";
export { toTeamInput } from "./gen/team.js";
export { toVaultInput } from "./gen/vault.js";
