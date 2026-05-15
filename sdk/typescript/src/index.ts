// Public API for @stigmer/sdk

// Top-level client
export { Stigmer } from "./stigmer";

// Configuration
export { type StigmerConfig, type TokenProvider } from "./config";

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
  getUserMessage,
  type RpcErrorMetadata,
  annotateRpcError,
  getRpcMetadata,
} from "./errors";

// Resource availability
export {
  type DeploymentMode,
  isResourceAvailable,
} from "./resource-availability";

// Authorization config and IAM role utilities
export {
  getGrantableRoles,
  hasGrantableRoles,
  isRoleGrantable,
} from "./authorization-config";
export {
  iamRoleToString,
  iamRoleFromString,
  iamRoleDisplayName,
  iamRoleDescription,
} from "./iam-role";
export { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

// Billing client
export {
  BillingClient,
  type CreateCheckoutSessionParams,
  type CreateBillingPortalSessionParams,
  type SetAutoRechargeConfigParams,
  type GetCreditLedgerParams,
  type GetBillingUsageReportParams,
  type GetCustomerModelPricingParams,
} from "./billing";

// Search client
export {
  SearchClient,
  type SearchParams,
  type SearchResponse,
  ApiResourceKind,
} from "./search";

// GitHub OAuth client
export {
  GitHubClient,
  type GetOAuthAuthorizeUrlParams,
  type OAuthAuthorizeUrlResponse,
  type ExchangeOAuthCodeParams,
  type OAuthTokenResponse,
} from "./github";

// Platform client (server info / edition detection)
export {
  PlatformClient,
  type ServerInfo,
} from "./platform";

// Shared types (from generated code)
export {
  type DeleteResourceInput,
  type ResourceRef,
  type Page,
  type ListParams,
  type ListResult,
  type EnvSpecInput,
  type EnvVarInput,
} from "./gen/types";

// Re-export all resource client classes and input types
export {
  AgentClient,
  type AgentInput,
  type McpServerUsageInput,
  type ToolApprovalOverrideInput,
  type SubAgentInput,
  type McpAccessInput,
} from "./gen/agent";
export {
  AgentExecutionClient,
  type AgentExecutionInput,
  type ExecutionConfigInput,
  type ContextManagementConfigInput,
  type AttachmentInput,
} from "./gen/agentexecution";
export {
  AgentInstanceClient,
  type AgentInstanceInput,
} from "./gen/agentinstance";
export { ApiKeyClient, type ApiKeyInput } from "./gen/apikey";
export {
  EnvironmentClient,
  type EnvironmentInput,
} from "./gen/environment";
export {
  ExecutionContextClient,
  type ExecutionContextInput,
} from "./gen/executioncontext";
export {
  IamPolicyClient,
  type IamPolicyInput,
  type ApiResourceRefInput,
} from "./gen/iampolicy";
export {
  IdentityAccountClient,
  type IdentityAccountInput,
} from "./gen/identityaccount";
export {
  InvitationClient,
  type InvitationInput,
} from "./gen/invitation";
export {
  IdentityProviderClient,
  type IdentityProviderInput,
} from "./gen/identityprovider";
export {
  OAuthAppClient,
  type OAuthAppInput,
} from "./gen/oauthapp";
export {
  McpServerClient,
  type McpServerInput,
  type StdioServerConfigInput,
  type HttpServerConfigInput,
  type ToolApprovalPolicyInput,
} from "./gen/mcpserver";
export {
  OrganizationClient,
  type OrganizationInput,
} from "./gen/organization";
export {
  PlatformClientClient,
  type PlatformClientInput,
} from "./gen/platformclient";
export { ProjectClient, type ProjectInput } from "./gen/project";
export {
  SessionClient,
  type SessionInput,
  type WorkspaceEntryInput,
  type WorkspaceSourceInput,
  type GitRepoSourceInput,
  type LocalPathSourceInput,
} from "./gen/session";

// Session utilities (hand-written)
export { PENDING_SUBJECT, resolvedSubject } from "./session";
export { SkillClient, type SkillInput } from "./gen/skill";
export {
  WorkflowClient,
  type WorkflowInput,
  type WorkflowDocumentInput,
  type WorkflowTaskInput,
  type ExportInput,
  type FlowControlInput,
  type GenerateFromPromptInput,
  type GenerateFromPromptResult,
  type RefineWorkflowClientInput,
  type RefineWorkflowResult,
} from "./gen/workflow";
export {
  WorkflowExecutionClient,
  type WorkflowExecutionInput,
} from "./gen/workflowexecution";
export {
  WorkflowInstanceClient,
  type WorkflowInstanceInput,
} from "./gen/workflowinstance";
