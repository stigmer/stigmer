package subagent

import (
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Args contains configuration for a sub-agent (Pulumi Args pattern).
type Args struct {
	// Description of what this sub-agent does.
	Description string

	// Instructions defining the sub-agent's behavior (min 10 characters).
	Instructions string
}

// SubAgent represents a sub-agent that can be delegated to.
// Sub-agents are defined inline within the parent agent spec.
//
// Sub-agents have restricted access to the parent's MCP servers via McpAccess grants.
// They can only use MCP servers that the parent has declared and can only restrict
// the tools further (cannot expand access beyond what parent has).
type SubAgent struct {
	name         string
	description  string
	instructions string
	mcpAccess    []*agentv1.McpAccess
	skillRefs    []*apiresource.ApiResourceReference
}

// New creates a sub-agent definition with struct args (Pulumi pattern).
//
// Required:
//   - name: sub-agent name (non-empty)
//   - args.Instructions: behavior instructions (min 10 characters)
//
// Optional args fields:
//   - Description: human-readable description
//
// After creation, use GrantMcpAccess() to specify which of the parent's
// MCP servers this sub-agent can use.
//
// Example:
//
//	sub, err := subagent.New("code-analyzer", &subagent.Args{
//	    Instructions: "Analyze code for bugs and security issues",
//	    Description:  "Static code analyzer",
//	})
//	sub.GrantMcpAccess("github", "search_code", "get_file")
func New(name string, args *Args) (SubAgent, error) {
	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &Args{}
	}

	s := SubAgent{
		name:         name,
		description:  args.Description,
		instructions: args.Instructions,
		mcpAccess:    []*agentv1.McpAccess{},
		skillRefs:    []*apiresource.ApiResourceReference{},
	}

	return s, nil
}

// Name returns the name of the sub-agent.
func (s SubAgent) Name() string {
	return s.name
}

// Instructions returns the behavior instructions for the sub-agent.
func (s SubAgent) Instructions() string {
	return s.instructions
}

// Description returns the description of the sub-agent.
func (s SubAgent) Description() string {
	return s.description
}

// McpAccess returns the MCP access grants for this sub-agent.
// Each grant specifies which MCP server (by slug) the sub-agent can use
// and optionally which tools are enabled.
func (s SubAgent) McpAccess() []*agentv1.McpAccess {
	return s.mcpAccess
}

// SkillRefs returns the skill references for the sub-agent.
func (s SubAgent) SkillRefs() []*apiresource.ApiResourceReference {
	return s.skillRefs
}

// GrantMcpAccess grants this sub-agent access to one of the parent's MCP servers.
//
// The mcpServerSlug must match the slug of an MCP server that the parent agent
// has declared in its McpServerUsages. The enabled tools (if specified) must be
// a subset of the tools the parent has enabled for that server.
//
// If no enabled tools are specified, the sub-agent gets access to all tools
// that the parent has enabled for this server.
//
// Example:
//
//	// Grant access to GitHub with specific tools only
//	sub.GrantMcpAccess("github", "search_code", "get_file")
//
//	// Grant access to AWS with all tools the parent has enabled
//	sub.GrantMcpAccess("aws")
//
//	// Chain multiple grants
//	sub.GrantMcpAccess("github", "search_code").
//	    GrantMcpAccess("slack", "send_message")
func (s *SubAgent) GrantMcpAccess(mcpServerSlug string, enabledTools ...string) *SubAgent {
	access := &agentv1.McpAccess{
		McpServer:    mcpServerSlug,
		EnabledTools: enabledTools,
	}
	s.mcpAccess = append(s.mcpAccess, access)
	return s
}

// AddSkillRef adds a skill reference to the sub-agent.
// Sub-agents can have their own skill references independent of the parent.
//
// Example:
//
//	sub.AddSkillRef(skillref.Platform("code-review-best-practices"))
func (s *SubAgent) AddSkillRef(ref *apiresource.ApiResourceReference) *SubAgent {
	s.skillRefs = append(s.skillRefs, ref)
	return s
}

// AddSkillRefs adds multiple skill references to the sub-agent.
//
// Example:
//
//	sub.AddSkillRefs(
//	    skillref.Platform("code-review"),
//	    skillref.Platform("security-guidelines"),
//	)
func (s *SubAgent) AddSkillRefs(refs ...*apiresource.ApiResourceReference) *SubAgent {
	s.skillRefs = append(s.skillRefs, refs...)
	return s
}

// AddOrgSkillRef adds an organization-scoped skill reference.
// The org parameter specifies which organization the skill belongs to.
//
// Version is optional - if omitted or empty, "latest" is used.
//
// Example:
//
//	sub.AddOrgSkillRef("acme-corp", "internal-docs")
//	sub.AddOrgSkillRef("acme-corp", "internal-docs", "v1.0")
func (s *SubAgent) AddOrgSkillRef(org, slug string, version ...string) *SubAgent {
	ref := &apiresource.ApiResourceReference{
		Kind:  apiresourcekind.ApiResourceKind_skill,
		Slug:  slug,
		Scope: apiresource.ApiResourceOwnerScope_organization,
		Org:   org,
	}
	if len(version) > 0 && version[0] != "" {
		ref.Version = version[0]
	}
	s.skillRefs = append(s.skillRefs, ref)
	return s
}

// String returns a string representation of the sub-agent.
func (s SubAgent) String() string {
	return fmt.Sprintf("SubAgent(%s)", s.name)
}
