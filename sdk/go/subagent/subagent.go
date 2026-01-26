package subagent

import (
	"fmt"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	genAgent "github.com/stigmer/stigmer/sdk/go/gen/agent"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// Args contains configuration for a sub-agent (Pulumi Args pattern).
// This is an alias to the generated InlineSubAgentArgs type.
// Note: After proto regeneration, this will become SubAgentArgs.
type Args = genAgent.InlineSubAgentArgs

// SubAgent represents a sub-agent that can be delegated to.
// Sub-agents are defined inline within the parent agent spec.
type SubAgent struct {
	name              string
	description       string
	instructions      string
	mcpServers        []string
	mcpToolSelections map[string]*types.McpToolSelection
	skillRefs         []*apiresource.ApiResourceReference
}

// New creates a sub-agent definition with struct args (Pulumi pattern).
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
//	sub, err := subagent.New("code-analyzer", &subagent.Args{
//	    Instructions: "Analyze code for bugs and security issues",
//	    Description:  "Static code analyzer",
//	    McpServers:   []string{"github"},
//	})
func New(name string, args *Args) (SubAgent, error) {
	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &Args{}
	}

	s := SubAgent{
		name:              name,
		description:       args.Description,
		instructions:      args.Instructions,
		mcpServers:        args.McpServers,
		mcpToolSelections: args.McpToolSelections,
		skillRefs:         convertSkillRefs(args.SkillRefs),
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
				Slug:  ref.Slug,
				Org:   ref.Org,
				Scope: parseScope(ref.Scope),
				Kind:  parseKind(ref.Kind),
			})
		}
	}
	return result
}

// parseScope converts string scope to proto enum.
func parseScope(s string) apiresource.ApiResourceOwnerScope {
	if v, ok := apiresource.ApiResourceOwnerScope_value[s]; ok {
		return apiresource.ApiResourceOwnerScope(v)
	}
	return apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified
}

// parseKind converts string kind to proto enum.
func parseKind(k string) apiresourcekind.ApiResourceKind {
	if v, ok := apiresourcekind.ApiResourceKind_value[k]; ok {
		return apiresourcekind.ApiResourceKind(v)
	}
	return apiresourcekind.ApiResourceKind_api_resource_kind_unknown
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

// MCPServerNames returns the list of MCP server names the sub-agent can use.
func (s SubAgent) MCPServerNames() []string {
	return s.mcpServers
}

// ToolSelections returns the MCP tool selections map.
func (s SubAgent) ToolSelections() map[string]*types.McpToolSelection {
	return s.mcpToolSelections
}

// SkillRefs returns the skill references for the sub-agent.
func (s SubAgent) SkillRefs() []*apiresource.ApiResourceReference {
	return s.skillRefs
}

// String returns a string representation of the sub-agent.
func (s SubAgent) String() string {
	return fmt.Sprintf("SubAgent(%s)", s.name)
}
