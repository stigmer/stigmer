package agent

import (
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// NewSubAgent creates a proto SubAgent with the given name and instructions.
// This provides an ergonomic API while using the proto type directly.
//
// SubAgents are stored in Args.SubAgents (single source of truth).
// Use AddSubAgent() to add them to an Agent.
//
// Example:
//
//	sub := agent.NewSubAgent("analyzer", "Analyze code for security issues")
//	ag.AddSubAgent(sub)
func NewSubAgent(name, instructions string) *agentv1.SubAgent {
	return &agentv1.SubAgent{
		Name:         name,
		Instructions: instructions,
	}
}

// NewSubAgentWithDescription creates a SubAgent with name, instructions, and description.
//
// Example:
//
//	sub := agent.NewSubAgentWithDescription(
//	    "analyzer",
//	    "Analyze code for security vulnerabilities",
//	    "Security analysis sub-agent",
//	)
//	ag.AddSubAgent(sub)
func NewSubAgentWithDescription(name, instructions, description string) *agentv1.SubAgent {
	return &agentv1.SubAgent{
		Name:         name,
		Instructions: instructions,
		Description:  description,
	}
}

// SubAgentBuilder provides a fluent API for building SubAgents.
//
// This allows for ergonomic construction of complex SubAgents with
// MCP access grants and skill references.
//
// Example:
//
//	sub := agent.BuildSubAgent("security-checker", "Check code for security issues").
//	    Description("Specialized security analysis").
//	    GrantMcpAccess("github", "search_code", "get_file").
//	    GrantMcpAccess("aws", "list_buckets").
//	    AddSkillRef(ref.Skill("stigmer", "security-guidelines")).
//	    Build()
//	ag.AddSubAgent(sub)
type SubAgentBuilder struct {
	sub *agentv1.SubAgent
}

// BuildSubAgent creates a new SubAgentBuilder with the required name and instructions.
//
// Example:
//
//	sub := agent.BuildSubAgent("helper", "Help with code analysis").Build()
func BuildSubAgent(name, instructions string) *SubAgentBuilder {
	return &SubAgentBuilder{
		sub: &agentv1.SubAgent{
			Name:         name,
			Instructions: instructions,
			McpAccess:    []*agentv1.McpAccess{},
			SkillRefs:    []*apiresource.ApiResourceReference{},
		},
	}
}

// Description sets the sub-agent's description.
//
// Example:
//
//	builder.Description("Specialized code reviewer")
func (b *SubAgentBuilder) Description(desc string) *SubAgentBuilder {
	b.sub.Description = desc
	return b
}

// GrantMcpAccess grants this sub-agent access to one of the parent's MCP servers.
//
// The mcpServer must match the slug of an MCP server that the parent agent
// has declared in its McpServerUsages. The enabled tools (if specified) must be
// a subset of the tools the parent has enabled for that server.
//
// If no enabled tools are specified, the sub-agent gets access to all tools
// that the parent has enabled for this server.
//
// Example:
//
//	builder.GrantMcpAccess("github", "search_code", "get_file")
//	builder.GrantMcpAccess("aws") // All tools the parent has enabled
func (b *SubAgentBuilder) GrantMcpAccess(mcpServer string, enabledTools ...string) *SubAgentBuilder {
	b.sub.McpAccess = append(b.sub.McpAccess, &agentv1.McpAccess{
		McpServer:    mcpServer,
		EnabledTools: enabledTools,
	})
	return b
}

// AddSkillRef adds a skill reference to the sub-agent.
//
// Use ref.Skill() to create skill references.
//
// Example:
//
//	import "github.com/stigmer/stigmer/sdk/go/commons/ref"
//
//	builder.AddSkillRef(ref.Skill("stigmer", "code-review"))
func (b *SubAgentBuilder) AddSkillRef(ref *apiresource.ApiResourceReference) *SubAgentBuilder {
	b.sub.SkillRefs = append(b.sub.SkillRefs, ref)
	return b
}

// AddSkillRefs adds multiple skill references to the sub-agent.
//
// Example:
//
//	builder.AddSkillRefs(
//	    ref.Skill("stigmer", "code-review"),
//	    ref.Skill("stigmer", "security-guidelines"),
//	)
func (b *SubAgentBuilder) AddSkillRefs(refs ...*apiresource.ApiResourceReference) *SubAgentBuilder {
	b.sub.SkillRefs = append(b.sub.SkillRefs, refs...)
	return b
}

// Build returns the constructed SubAgent.
//
// The returned *agentv1.SubAgent can be added to an Agent via AddSubAgent().
//
// Example:
//
//	sub := agent.BuildSubAgent("helper", "Help analyze code").
//	    Description("Code analysis helper").
//	    GrantMcpAccess("github", "search_code").
//	    Build()
//	ag.AddSubAgent(sub)
func (b *SubAgentBuilder) Build() *agentv1.SubAgent {
	return b.sub
}
