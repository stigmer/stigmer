package agents

import "github.com/stigmer/stigmer/mcp-server/internal/domains"

// ApplyAgentInput defines the structured parameters for the "apply_agent" tool.
//
// It follows the SDK pattern: flat identity fields (via ResourceIdentity) plus
// agent-specific configuration fields. The proto envelope (api_version, kind,
// metadata/spec nesting) is assembled internally by toProto().
type ApplyAgentInput struct {
	domains.ResourceIdentity

	// Agent-specific configuration (maps to AgentSpec fields).

	Description string `json:"description,omitempty" jsonschema:"description=Human-readable description explaining what this agent does."`
	IconUrl     string `json:"icon_url,omitempty" jsonschema:"description=Icon URL for marketplace and UI display (SVG\\, PNG\\, or JPEG)."`

	Instructions string `json:"instructions" jsonschema:"required,description=System prompt defining the agent's behavior and personality. Minimum 10 characters."`

	McpServerUsages []McpServerUsageInput `json:"mcp_server_usages,omitempty" jsonschema:"description=MCP servers this agent can use. Each entry references an MCP server by org/slug and optionally restricts which tools are enabled."`

	SkillRefs []SkillRefInput `json:"skill_refs,omitempty" jsonschema:"description=Skill resources that provide additional knowledge to the agent."`

	SubAgents []SubAgentInput `json:"sub_agents,omitempty" jsonschema:"description=Sub-agents that this agent can delegate tasks to. Sub-agents inherit the parent's MCP server usages but can have restricted access."`

	EnvSpec *EnvironmentInput `json:"env_spec,omitempty" jsonschema:"description=Environment variables required by the agent. Defines the schema of required vars; actual values are provided at runtime."`
}

// McpServerUsageInput declares that the agent uses an MCP server.
type McpServerUsageInput struct {
	McpServerRef McpServerRefInput `json:"mcp_server_ref" jsonschema:"required,description=Reference to the MCP server resource."`

	EnabledTools []string `json:"enabled_tools,omitempty" jsonschema:"description=Tools to enable from this server. Empty means all tools enabled."`

	ToolApprovalOverrides []ToolApprovalOverrideInput `json:"tool_approval_overrides,omitempty" jsonschema:"description=Per-agent overrides for tool approval requirements."`
}

// McpServerRefInput identifies an MCP server resource by org and slug.
// The resource kind is auto-populated during conversion.
type McpServerRefInput struct {
	Org  string `json:"org" jsonschema:"required,description=Organization that owns the MCP server (e.g. stigmer)."`
	Slug string `json:"slug" jsonschema:"required,description=MCP server slug (e.g. github)."`
}

// SkillRefInput identifies a skill resource by org, slug, and optional version.
// The resource kind is auto-populated during conversion.
type SkillRefInput struct {
	Org     string `json:"org" jsonschema:"required,description=Organization that owns the skill (e.g. stigmer)."`
	Slug    string `json:"slug" jsonschema:"required,description=Skill slug (e.g. coding-best-practices)."`
	Version string `json:"version,omitempty" jsonschema:"description=Skill version: tag name (e.g. stable\\, v1.0) or SHA-256 hash. Omit or leave empty for latest."`
}

// SubAgentInput defines a sub-agent that the parent can delegate tasks to.
type SubAgentInput struct {
	Name         string `json:"name" jsonschema:"required,description=Unique name of the sub-agent within the parent (e.g. code-reviewer)."`
	Description  string `json:"description,omitempty" jsonschema:"description=What this sub-agent specializes in. Helps the parent decide when to delegate."`
	Instructions string `json:"instructions" jsonschema:"required,description=Behavior instructions for this sub-agent. Minimum 10 characters."`

	McpAccess []McpAccessInput `json:"mcp_access,omitempty" jsonschema:"description=MCP server access grants. Each entry must reference a server from the parent's mcp_server_usages by slug."`

	SkillRefs []SkillRefInput `json:"skill_refs,omitempty" jsonschema:"description=Skill resources for this sub-agent's knowledge."`
}

// McpAccessInput grants a sub-agent access to one of the parent's MCP servers.
type McpAccessInput struct {
	McpServer    string   `json:"mcp_server" jsonschema:"required,description=Slug of the MCP server (must match a slug from the parent's mcp_server_usages)."`
	EnabledTools []string `json:"enabled_tools,omitempty" jsonschema:"description=Tools this sub-agent can use. Must be a subset of the parent's enabled tools. Empty means all parent-enabled tools."`
}

// ToolApprovalOverrideInput customizes approval requirements for a specific tool.
type ToolApprovalOverrideInput struct {
	ToolName         string `json:"tool_name" jsonschema:"required,description=Name of the tool to override (must match the MCP server's tool name exactly)."`
	RequiresApproval bool   `json:"requires_approval" jsonschema:"description=Whether this tool requires human approval before execution."`
	Message          string `json:"message,omitempty" jsonschema:"description=Custom approval message. Supports {{args.field}} placeholders. Keep under 100 characters."`
}

// EnvironmentInput declares environment variables required by the agent.
type EnvironmentInput struct {
	Description string                       `json:"description,omitempty" jsonschema:"description=Human-readable description of this environment (e.g. Production AWS credentials)."`
	Data        map[string]EnvironmentValue `json:"data,omitempty" jsonschema:"description=Environment variable definitions keyed by variable name (e.g. GITHUB_TOKEN\\, AWS_REGION)."`
}

// EnvironmentValue represents a single configuration or secret value.
type EnvironmentValue struct {
	Value       string `json:"value,omitempty" jsonschema:"description=The value. Can be empty for variables that must be provided at runtime."`
	IsSecret    bool   `json:"is_secret" jsonschema:"description=Whether this value is a secret (encrypted at rest\\, redacted in logs)."`
	Description string `json:"description,omitempty" jsonschema:"description=Documentation for this variable (e.g. GitHub personal access token with repo scope)."`
}
