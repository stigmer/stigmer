package subagent

import (
	"fmt"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	genAgent "github.com/stigmer/stigmer/sdk/go/gen/agent"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// InlineArgs contains configuration for an inline sub-agent (Pulumi Args pattern).
// This is an alias to the generated InlineSubAgentArgs type.
type InlineArgs = genAgent.InlineSubAgentArgs

// SubAgent represents a sub-agent that can be delegated to.
// It can be either an inline definition or a reference to an existing AgentInstance.
type SubAgent struct {
	// Type of sub-agent
	subAgentType subAgentType

	// For inline sub-agents
	name              string
	description       string
	instructions      string
	mcpServers        []string
	mcpToolSelections map[string]*types.McpToolSelection
	skillRefs         []*apiresource.ApiResourceReference

	// For referenced sub-agents
	agentInstanceRef string
}

type subAgentType int

const (
	subAgentTypeInline subAgentType = iota
	subAgentTypeReference
)

// Inline creates an inline sub-agent definition with struct args (Pulumi pattern).
//
// Required:
//   - name: sub-agent name (non-empty)
//   - args.Instructions: behavior instructions (min 10 characters)
//
// Optional args fields:
//   - Description: human-readable description
//   - McpServers: MCP server names this sub-agent can use
//   - McpToolSelections: tool selections for each MCP server
//   - SkillRefs: references to Skill resources
//
// Example:
//
//	sub, err := subagent.Inline("code-analyzer", &subagent.InlineArgs{
//	    Instructions: "Analyze code for bugs and security issues",
//	    Description:  "Static code analyzer",
//	    McpServers:   []string{"github"},
//	})
func Inline(name string, args *InlineArgs) (SubAgent, error) {
	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &InlineArgs{}
	}

	s := SubAgent{
		subAgentType:      subAgentTypeInline,
		name:              name,
		description:       args.Description,
		instructions:      args.Instructions,
		mcpServers:        args.McpServers,
		mcpToolSelections: args.McpToolSelections,
		skillRefs:         convertSkillRefs(args.SkillRefs),
	}

	if err := s.Validate(); err != nil {
		return SubAgent{}, err
	}
	return s, nil
}

// convertSkillRefs converts generated types.ApiResourceReference to proto apiresource.ApiResourceReference.
func convertSkillRefs(refs []*types.ApiResourceReference) []*apiresource.ApiResourceReference {
	if refs == nil {
		return nil
	}
	result := make([]*apiresource.ApiResourceReference, 0, len(refs))
	for _, ref := range refs {
		if ref != nil {
			result = append(result, &apiresource.ApiResourceReference{
				Slug: ref.Slug,
				Org:  ref.Org,
				// Note: types.ApiResourceReference uses string for Scope/Kind,
				// proto uses enums. These would need proper conversion if used.
			})
		}
	}
	return result
}

// Reference creates a reference to an existing AgentInstance resource.
//
// Example:
//
//	sub := subagent.Reference("security-checker", "sec-checker-prod")
//
// The name is the local name for this sub-agent reference.
// The agentInstanceRef is the ID or name of the AgentInstance resource.
func Reference(name, agentInstanceRef string) SubAgent {
	return SubAgent{
		subAgentType:     subAgentTypeReference,
		name:             name,
		agentInstanceRef: agentInstanceRef,
	}
}

// IsInline returns true if this is an inline sub-agent definition.
func (s SubAgent) IsInline() bool {
	return s.subAgentType == subAgentTypeInline
}

// IsReference returns true if this is a reference to an existing AgentInstance.
func (s SubAgent) IsReference() bool {
	return s.subAgentType == subAgentTypeReference
}

// Name returns the name of the sub-agent.
func (s SubAgent) Name() string {
	return s.name
}

// Instructions returns the behavior instructions for inline sub-agents.
func (s SubAgent) Instructions() string {
	return s.instructions
}

// Description returns the description for inline sub-agents.
func (s SubAgent) Description() string {
	return s.description
}

// MCPServerNames returns the list of MCP server names for inline sub-agents.
func (s SubAgent) MCPServerNames() []string {
	return s.mcpServers
}

// ToolSelections returns the MCP tool selections map for inline sub-agents.
func (s SubAgent) ToolSelections() map[string]*types.McpToolSelection {
	return s.mcpToolSelections
}

// SkillRefs returns the skill references for inline sub-agents.
func (s SubAgent) SkillRefs() []*apiresource.ApiResourceReference {
	return s.skillRefs
}

// Organization returns the organization for referenced sub-agents.
// For inline sub-agents, returns empty string.
func (s SubAgent) Organization() string {
	if s.IsReference() {
		// For references, we need to parse from agentInstanceRef
		// For now, return empty - this will be handled by CLI
		return ""
	}
	return ""
}

// AgentInstanceID returns the agent instance reference for referenced sub-agents.
func (s SubAgent) AgentInstanceID() string {
	return s.agentInstanceRef
}

// Validate checks if the sub-agent configuration is valid.
func (s SubAgent) Validate() error {
	if s.IsInline() {
		return s.validateInline()
	}
	return s.validateReference()
}

func (s SubAgent) validateInline() error {
	if s.name == "" {
		return fmt.Errorf("inline sub-agent: name is required")
	}

	if s.instructions == "" {
		return fmt.Errorf("inline sub-agent %q: instructions are required", s.name)
	}

	if len(s.instructions) < 10 {
		return fmt.Errorf("inline sub-agent %q: instructions must be at least 10 characters (got %d)", s.name, len(s.instructions))
	}

	// Validate skill references
	for i, ref := range s.skillRefs {
		if ref == nil {
			return fmt.Errorf("inline sub-agent %q: skill_refs[%d]: reference is nil", s.name, i)
		}
		if ref.Slug == "" {
			return fmt.Errorf("inline sub-agent %q: skill_refs[%d]: slug is required", s.name, i)
		}
	}

	return nil
}

func (s SubAgent) validateReference() error {
	if s.name == "" {
		return fmt.Errorf("referenced sub-agent: name is required")
	}

	if s.agentInstanceRef == "" {
		return fmt.Errorf("referenced sub-agent %q: agent_instance_ref is required", s.name)
	}

	return nil
}

// String returns a string representation of the sub-agent.
func (s SubAgent) String() string {
	if s.IsReference() {
		return fmt.Sprintf("SubAgent(%s -> %s)", s.name, s.agentInstanceRef)
	}
	return fmt.Sprintf("SubAgent(%s inline)", s.name)
}
