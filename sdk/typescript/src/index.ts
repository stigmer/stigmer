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

// Error handling
export {
  StigmerError,
  type ErrorCode,
  isNotFound,
  isUnauthenticated,
  isPermissionDenied,
  isRetryable,
  type ErrorCategory,
  isConnectError,
  classifyError,
  isRetryableError,
  isTransientStreamError,
  getUserMessage,
  type ErrorReason,
  getErrorReason,
  getRecordConstraint,
  type RpcErrorMetadata,
  annotateRpcError,
  getRpcMetadata,
} from "./errors.js";

// Resource availability
export {
  type DeploymentMode,
  isResourceAvailable,
} from "./resource-availability.js";

// Authorization config and IAM role utilities
export {
  getGrantableRoles,
  hasGrantableRoles,
  isRoleGrantable,
} from "./authorization-config.js";
export {
  iamRoleToString,
  iamRoleFromString,
  iamRoleDisplayName,
  iamRoleDescription,
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
  type CreateCheckoutSessionParams,
  type CreateBillingPortalSessionParams,
  type SetAutoRechargeConfigParams,
  type GetCreditLedgerParams,
  type GetBillingUsageReportParams,
  type GetCustomerModelPricingParams,
} from "./billing.js";

// Cursor accounts client (platform operators only)
export {
  CursorAccountsClient,
  type UpsertCursorAccountParams,
  type DeleteCursorAccountParams,
  type AddCursorMemberKeyParams,
  type RemoveCursorMemberKeyParams,
  type SetCursorMemberKeyEnabledParams,
} from "./cursor-accounts.js";

// Search client
export {
  SearchClient,
  type SearchParams,
  type SearchResponse,
  ApiResourceKind,
} from "./search.js";

// GitHub OAuth client
export {
  GitHubClient,
  type GetOAuthAuthorizeUrlParams,
  type OAuthAuthorizeUrlResponse,
  type ExchangeOAuthCodeParams,
  type OAuthTokenResponse,
} from "./github.js";

// Platform client (server info / edition detection)
export {
  PlatformClient,
  type ServerInfo,
} from "./platform.js";

// Manifest engine (kind-agnostic YAML ⇄ proto ⇄ apply)
export {
  ManifestClient,
  parseManifest,
  serializeManifest,
  manifestKinds,
  manifestHandlerForYamlKind,
  manifestHandlerForTypeName,
  metadataOf,
  REDACTED_SECRET_MARKER,
  containsRedactedSecrets,
  type AppliedManifest,
  type ManifestDocument,
  type ManifestKindHandler,
  type ParseManifestOptions,
} from "./manifest/index.js";

// Shared types (from generated code)
export {
  type DeleteResourceInput,
  type ResourceRef,
  type Page,
  type ListParams,
  type ListResult,
  type EnvSpecInput,
  type EnvVarInput,
} from "./gen/types.js";

// Re-export all resource client classes and input types
export {
  AgentClient,
  buildAgentProto,
  type AgentInput,
  type McpServerUsageInput,
  type ToolApprovalOverrideInput,
  type SubAgentInput,
  type McpAccessInput,
} from "./gen/agent.js";
export {
  AgentChannelClient,
  type AgentChannelInput,
  type SlackChannelConfigInput,
} from "./gen/agentchannel.js";
export {
  AgentExecutionClient,
  type AgentExecutionInput,
  type ExecutionConfigInput,
  type ContextManagementConfigInput,
  type AttachmentInput,
} from "./gen/agentexecution.js";
export {
  AgentInstanceClient,
  type AgentInstanceInput,
} from "./gen/agentinstance.js";
export {
  AgentShareClient,
  type AgentShareInput,
  type AgentShareMessagesInput,
} from "./gen/agentshare.js";
export { ApiKeyClient, type ApiKeyInput } from "./gen/apikey.js";
export {
  ChannelAppClient,
  type ChannelAppInput,
  type SlackChannelAppConfigInput,
} from "./gen/channelapp.js";
export {
  EnvironmentClient,
  type EnvironmentInput,
} from "./gen/environment.js";
export {
  ExecutionContextClient,
  type ExecutionContextInput,
} from "./gen/executioncontext.js";
export {
  IamPolicyClient,
  type IamPolicyInput,
  type ApiResourceRefInput,
} from "./gen/iampolicy.js";
export {
  IdentityAccountClient,
  type IdentityAccountInput,
} from "./gen/identityaccount.js";
export {
  InvitationClient,
  type InvitationInput,
} from "./gen/invitation.js";
export {
  IdentityProviderClient,
  type IdentityProviderInput,
} from "./gen/identityprovider.js";
export {
  OAuthAppClient,
  type OAuthAppInput,
} from "./gen/oauthapp.js";
export {
  McpServerClient,
  buildMcpServerProto,
  type McpServerInput,
  type StdioServerConfigInput,
  type HttpServerConfigInput,
  type ToolApprovalPolicyInput,
} from "./gen/mcpserver.js";
export {
  OrganizationClient,
  type OrganizationInput,
} from "./gen/organization.js";
export {
  PlatformClientClient,
  type PlatformClientInput,
} from "./gen/platformclient.js";
export { ProjectClient, type ProjectInput } from "./gen/project.js";
export {
  SessionClient,
  type SessionInput,
  type WorkspaceEntryInput,
  type WorkspaceSourceInput,
  type GitRepoSourceInput,
  type LocalPathSourceInput,
} from "./gen/session.js";

// Session utilities (hand-written)
export {
  PENDING_SUBJECT,
  SESSION_CONTEXT_METADATA_KEY,
  mergeSessionContext,
  resolvedSubject,
} from "./session.js";

// Tool-call view model (framework-agnostic; shared by @stigmer/react and @stigmer/ink)
export {
  ToolKind,
  FileChangeCaptureLevel,
  resolveToolKind,
  resolveToolKindByName,
  normalizeToolResult,
  type ToolResultView,
  type ToolSearchMatch,
  type ToolContentBlock,
} from "./execution/tool-view.js";
export {
  ApprovalPolicySource,
  describeApprovalPolicySource,
  isInformativePolicySource,
} from "./execution/approval-provenance.js";
export { isTerminalPhase } from "./execution/execution-phases.js";
export {
  foldFileReviewEventStream,
  displayFileChangeSets,
} from "./execution/file-review-fold.js";
export { toDisplayFileChange } from "./execution/to-display-file-change.js";
export { SkillClient, type SkillInput } from "./gen/skill.js";
export {
  WorkflowClient,
  type WorkflowInput,
  type WorkflowDocumentInput,
  type WorkflowTaskInput,
  type ExportInput,
  type FlowControlInput,
} from "./gen/workflow.js";
export {
  WorkflowExecutionClient,
  type WorkflowExecutionInput,
} from "./gen/workflowexecution.js";
export {
  WorkflowInstanceClient,
  type WorkflowInstanceInput,
} from "./gen/workflowinstance.js";
