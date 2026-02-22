# Protobuf Schema Reference

Complete protobuf schemas for Stigmer Agent API specification.

## Agent Message (agent-api.proto)

```protobuf
message Agent {
  // API version for this resource type.
  string api_version = 1 [(buf.validate.field).string.const = 'agentic.stigmer.ai/v1'];

  // Resource kind identifier.
  string kind = 2 [(buf.validate.field).string.const = 'Agent'];

  // Standard resource metadata including name, id, labels, and tags.
  // Agents belong to an organization and can be PUBLIC or PRIVATE.
  // Reference format: "org/slug" (e.g., "stigmer/web-search", "acme/data-analyst")
  ai.stigmer.commons.apiresource.ApiResourceMetadata metadata = 3 [(buf.validate.field).required = true];

  // Agent-specific configuration.
  AgentSpec spec = 4;

  // System-managed status containing audit information and default instance ID.
  AgentStatus status = 5;
}
```

## AgentSpec (agent-spec.proto)

```protobuf
message AgentSpec {
  // Human-readable description for UI and marketplace display.
  // Should explain what this agent does and its primary capabilities.
  string description = 1;

  // Icon URL for marketplace and UI display.
  // Should be a publicly accessible URL to an image (SVG, PNG, or JPEG).
  string icon_url = 2;

  // Instructions defining the agent's behavior and personality.
  // This is the agent's system prompt - the core logic that shapes its responses.
  // Should be at least 10 characters to ensure meaningful instructions.
  string instructions = 3 [(buf.validate.field).string.min_len = 10];

  // MCP servers this Agent can use.
  // Each usage references a McpServer resource by its ref.
  // The slug from each reference must be unique within this Agent.
  repeated McpServerUsage mcp_server_usages = 4 [(buf.validate.field).repeated.items.cel = {
    id: "mcp_server_usages.kind"
    message: "mcp_server_usages must reference resources with kind=mcp_server"
    expression: "this.mcp_server_ref.kind == 44"
  }];

  // Skill resources providing agent knowledge.
  // Skills are injected into the agent's context as additional capabilities.
  repeated ai.stigmer.commons.apiresource.ApiResourceReference skill_refs = 5 [(buf.validate.field).repeated.items.cel = {
    id: "skill_refs.kind"
    message: "skill_refs must reference resources with kind=skill"
    expression: "this.kind == 43"
  }];

  // Sub-agents that can be delegated to.
  // Sub-agents inherit the parent's MCP server usages but can have restricted access.
  repeated SubAgent sub_agents = 6;

  // Environment variables required by the agent.
  // Uses the shared EnvironmentSpec for consistent env var handling across resources.
  ai.stigmer.agentic.environment.v1.EnvironmentSpec env_spec = 7;
}
```

## SubAgent

```protobuf
message SubAgent {
  // Unique name of the sub-agent within the parent agent.
  // Used for delegation routing and logging.
  // Examples: "code-reviewer", "researcher", "writer"
  string name = 1 [(buf.validate.field).required = true];

  // Description of what this sub-agent specializes in.
  // Helps the parent agent decide when to delegate to this sub-agent.
  // Example: "Reviews code changes for security issues and best practices"
  string description = 2;

  // Behavior instructions for this sub-agent.
  // Defines the sub-agent's personality, expertise, and constraints.
  // Should be at least 10 characters to ensure meaningful instructions.
  string instructions = 3 [(buf.validate.field).string.min_len = 10];

  // MCP server access grants for this sub-agent.
  // Each McpAccess references a parent's McpServerUsage by slug and
  // optionally restricts which tools are available.
  // Sub-agent can only use MCP servers listed here.
  repeated McpAccess mcp_access = 4;

  // Skill resources for this sub-agent's knowledge.
  // Skills provide domain-specific knowledge and capabilities.
  repeated ai.stigmer.commons.apiresource.ApiResourceReference skill_refs = 5 [(buf.validate.field).repeated.items.cel = {
    id: "skill_refs.kind"
    message: "skill_refs must reference resources with kind=skill"
    expression: "this.kind == 43"
  }];
}
```

## McpServerUsage

```protobuf
message McpServerUsage {
  // Reference to the McpServer resource.
  // Must reference a resource with kind=mcp_server (44).
  // The slug from this reference is how SubAgents identify this server.
  ai.stigmer.commons.apiresource.ApiResourceReference mcp_server_ref = 1 [(buf.validate.field).required = true];

  // Tools to enable from this MCP server for this Agent.
  // This defines the maximum tool set - SubAgents can only restrict further.
  // Empty list = use McpServer's default_enabled_tools (or all if not specified).
  // Tool names must match exactly what the MCP server reports via tools/list.
  repeated string enabled_tools = 2;

  // Override approval requirements for specific tools.
  //
  // These overrides take precedence over McpServer.default_tool_approvals,
  // allowing per-agent customization of the approval policy.
  //
  // Use cases:
  // - Disable approval for a trusted automation agent
  // - Add approval for a tool that doesn't have default approval
  // - Customize the approval message for this agent's context
  repeated ToolApprovalOverride tool_approval_overrides = 3;
}
```

## McpAccess

```protobuf
message McpAccess {
  // Slug of the McpServer to grant access to.
  // Must match mcp_server_ref.slug from one of parent's mcp_server_usages.
  string mcp_server = 1 [(buf.validate.field).required = true];

  // Tools this SubAgent can use from this MCP server.
  // Must be a subset of the parent's enabled_tools for this server.
  // Empty list = all tools that parent has enabled (no additional restriction).
  repeated string enabled_tools = 2;
}
```

## ToolApprovalOverride

```protobuf
message ToolApprovalOverride {
  // Name of the tool to override.
  // Must match exactly (case-sensitive) with MCP server's tool name.
  // Example: "delete_repository", "send_email", "execute_sql"
  string tool_name = 1 [(buf.validate.field).string.min_len = 1];

  // Whether this tool requires approval for this agent.
  //
  // false: No approval needed (overrides any McpServer default)
  // true: Approval required (even if McpServer has no default)
  //
  // Note: This can be further overridden at execution time by
  // AgentExecutionSpec.auto_approve_all=true
  bool requires_approval = 2;

  // Optional: Custom approval message for this agent.
  // Supports {{args.field}} placeholders like ToolApprovalPolicy.message.
  //
  // If empty and requires_approval=true:
  // - Uses McpServer's default message for this tool (if exists)
  // - Otherwise auto-generates: "Execute tool: {tool_name}"
  //
  // Guidelines for effective messages:
  //   - Be specific to this agent's context
  //   - Include the most important argument values
  //   - Keep under 100 characters for UI display
  string message = 3;
}
```

## Validation Rules

### CEL Validation Expressions

**MCP Server References** (`mcp_server_usages`):
```cel
this.mcp_server_ref.kind == 44
```
Error: "mcp_server_usages must reference resources with kind=mcp_server"

**Skill References** (`skill_refs`):
```cel
this.kind == 43
```
Error: "skill_refs must reference resources with kind=skill"

**SubAgent Skill References**:
```cel
this.kind == 43
```
Error: "skill_refs must reference resources with kind=skill"

### Field Validation

**instructions** (AgentSpec and SubAgent):
- Minimum length: 10 characters
- Validation: `[(buf.validate.field).string.min_len = 10]`

**api_version**:
- Constant value: `agentic.stigmer.ai/v1`
- Validation: `[(buf.validate.field).string.const = 'agentic.stigmer.ai/v1']`

**kind**:
- Constant value: `Agent`
- Validation: `[(buf.validate.field).string.const = 'Agent']`

**metadata**:
- Required: true
- Validation: `[(buf.validate.field).required = true]`

**SubAgent.name**:
- Required: true
- Validation: `[(buf.validate.field).required = true]`

**McpServerUsage.mcp_server_ref**:
- Required: true
- Validation: `[(buf.validate.field).required = true]`

**McpAccess.mcp_server**:
- Required: true
- Validation: `[(buf.validate.field).required = true]`

**ToolApprovalOverride.tool_name**:
- Minimum length: 1 character
- Validation: `[(buf.validate.field).string.min_len = 1]`

## Resource Kind IDs

- **Agent**: Kind ID not explicitly defined in proto (inferred from kind string)
- **Skill**: Kind ID = 43
- **McpServer**: Kind ID = 44

These IDs are used in CEL validation expressions for reference integrity.

## Permission Model

### Sub-Agent Access Control

**Inheritance Rules**:
1. Sub-agent can ONLY access MCP servers listed in parent's `mcp_server_usages`
2. Sub-agent's `enabled_tools` must be a SUBSET of parent's enabled tools for each server
3. Empty `enabled_tools` in sub-agent = inherits all parent's enabled tools (no restriction)
4. Sub-agent skills are INDEPENDENT of parent's skills (no inheritance)

**Validation Logic**:
- For each `McpAccess` in sub-agent's `mcp_access`:
  - The `mcp_server` slug must match a slug from parent's `mcp_server_usages`
  - Each tool in sub-agent's `enabled_tools` must exist in parent's `enabled_tools` for that server

**Example Valid Configuration**:
```yaml
# Parent
mcp_server_usages:
  - mcp_server_ref: {slug: github}
    enabled_tools: [search_code, create_pr, get_file]

# Sub-agent (valid - subset)
sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, get_file]  # Subset of parent's tools
```

**Example Invalid Configuration**:
```yaml
# Parent
mcp_server_usages:
  - mcp_server_ref: {slug: github}
    enabled_tools: [search_code, get_file]

# Sub-agent (INVALID - delete_repo not in parent)
sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, delete_repo]  # ERROR: delete_repo not enabled by parent
```

## Tool Approval Policy Chain

Tool approval requirements follow a three-level priority chain:

1. **McpServer.default_tool_approvals** (lowest priority)
   - Platform/org-level defaults defined in MCP server resource

2. **Agent.McpServerUsage.tool_approval_overrides** (middle priority)
   - Per-agent customization defined in this schema
   - Overrides MCP server defaults

3. **AgentExecution.auto_approve_all** (highest priority)
   - Runtime bypass for trusted executions
   - When true, skips all approval checks

### Override Semantics

**requires_approval=true**:
- Tool requires approval
- Applies even if MCP server has no default approval policy
- Uses custom message if provided, else inherits from MCP server, else auto-generates

**requires_approval=false**:
- Tool does NOT require approval
- Overrides any MCP server default approval requirement
- Use for trusted automation agents

### Message Placeholders

Approval messages support argument placeholders:
```yaml
message: "Deploy {{args.app_name}} to {{args.environment}}"
message: "Delete repository: {{args.repo_name}}?"
message: "Send email to {{args.recipient}}: {{args.subject}}"
```

At runtime, `{{args.field}}` is replaced with actual tool argument values.
