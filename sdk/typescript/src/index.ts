// Public API for @stigmer/sdk

// Top-level client
export { Stigmer } from "./stigmer.js";

// Configuration
export { type StigmerConfig, type TokenProvider } from "./config.js";

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
} from "./errors.js";

// Search client
export {
  SearchClient,
  type SearchParams,
  type SearchResponse,
  ApiResourceKind,
} from "./search.js";

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
  type AgentInput,
  type McpServerUsageInput,
  type ToolApprovalOverrideInput,
  type SubAgentInput,
  type McpAccessInput,
} from "./gen/agent.js";
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
export { ApiKeyClient, type ApiKeyInput } from "./gen/apikey.js";
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
  IdentityProviderClient,
  type IdentityProviderInput,
} from "./gen/identityprovider.js";
export {
  McpServerClient,
  type McpServerInput,
  type StdioServerConfigInput,
  type HttpServerConfigInput,
  type ToolApprovalPolicyInput,
} from "./gen/mcpserver.js";
export {
  OrganizationClient,
  type OrganizationInput,
} from "./gen/organization.js";
export { ProjectClient, type ProjectInput } from "./gen/project.js";
export {
  SessionClient,
  type SessionInput,
  type WorkspaceEntryInput,
  type WorkspaceSourceInput,
  type GitRepoSourceInput,
  type LocalPathSourceInput,
} from "./gen/session.js";
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
