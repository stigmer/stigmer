package stigmer

import "github.com/stigmer/stigmer/sdk/go/internal/gen"

// Resource clients — one per API resource.
type AgentClient = gen.AgentClient
type SkillClient = gen.SkillClient
type McpServerClient = gen.McpServerClient
type SessionClient = gen.SessionClient
type AgentExecutionClient = gen.AgentExecutionClient

// Input types for resource mutation (Create, Update, Apply).
type AgentInput = gen.AgentInput
type SkillInput = gen.SkillInput
type McpServerInput = gen.McpServerInput
type AgentExecutionInput = gen.AgentExecutionInput

// Shared SDK types.
type DeleteResourceInput = gen.DeleteResourceInput
type ResourceRef = gen.ResourceRef
type Page = gen.Page
type ListParams = gen.ListParams
type ListResult = gen.ListResult
type EnvSpecInput = gen.EnvSpecInput
type EnvVarInput = gen.EnvVarInput

// Agent nested types.
type McpServerUsageInput = gen.McpServerUsageInput
type SubAgentInput = gen.SubAgentInput
type McpAccessInput = gen.McpAccessInput
type ToolApprovalOverrideInput = gen.ToolApprovalOverrideInput

// McpServer nested types.
type StdioServerConfigInput = gen.StdioServerConfigInput
type HttpServerConfigInput = gen.HttpServerConfigInput
type ToolApprovalPolicyInput = gen.ToolApprovalPolicyInput

// Execution nested types.
type ExecutionConfigInput = gen.ExecutionConfigInput
type ContextManagementConfigInput = gen.ContextManagementConfigInput
type AttachmentInput = gen.AttachmentInput

// Streaming types.
type SubscribeStream = gen.SubscribeStream
