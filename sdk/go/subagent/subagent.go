package subagent

import (
	"fmt"
	"os"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

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
	mcpToolSelections map[string][]string
	skillRefs         []*apiresource.ApiResourceReference

	// For referenced sub-agents
	agentInstanceRef string
}

type subAgentType int

const (
	subAgentTypeInline subAgentType = iota
	subAgentTypeReference
)

// InlineOption configures an inline sub-agent.
type InlineOption func(*SubAgent) error

// WithName sets the name of the inline sub-agent.
func WithName(name string) InlineOption {
	return func(s *SubAgent) error {
		s.name = name
		return nil
	}
}

// WithDescription sets the description of the inline sub-agent.
func WithDescription(description string) InlineOption {
	return func(s *SubAgent) error {
		s.description = description
		return nil
	}
}

// WithInstructions sets the behavior instructions for the inline sub-agent from a string.
func WithInstructions(instructions string) InlineOption {
	return func(s *SubAgent) error {
		s.instructions = instructions
		return nil
	}
}

// WithInstructionsFromFile sets the behavior instructions for the inline sub-agent from a file.
//
// Reads the file content and sets it as the sub-agent's instructions.
// The file content must be at least 10 characters.
//
// Example:
//
//	subagent.WithInstructionsFromFile("instructions/security-analyzer.md")
func WithInstructionsFromFile(path string) InlineOption {
	return func(s *SubAgent) error {
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		s.instructions = string(content)
		return nil
	}
}

// WithMCPServer adds an MCP server name that this sub-agent can use.
// The name references an MCP server defined in the parent agent.
func WithMCPServer(serverName string) InlineOption {
	return func(s *SubAgent) error {
		s.mcpServers = append(s.mcpServers, serverName)
		return nil
	}
}

// WithMCPServers sets all MCP server names for this sub-agent.
func WithMCPServers(serverNames ...string) InlineOption {
	return func(s *SubAgent) error {
		s.mcpServers = serverNames
		return nil
	}
}

// WithToolSelection adds tool selections for a specific MCP server.
// If tools is empty, all tools from the server are enabled.
func WithToolSelection(mcpServerName string, tools ...string) InlineOption {
	return func(s *SubAgent) error {
		if s.mcpToolSelections == nil {
			s.mcpToolSelections = make(map[string][]string)
		}
		s.mcpToolSelections[mcpServerName] = tools
		return nil
	}
}

// WithSkillRef adds a skill reference to the inline sub-agent.
//
// Use skillref.Platform() to create platform skill references.
//
// Example:
//
//	subagent.WithSkillRef(skillref.Platform("code-review"))
//	subagent.WithSkillRef(skillref.Platform("code-review", "v1.0"))
func WithSkillRef(ref *apiresource.ApiResourceReference) InlineOption {
	return func(s *SubAgent) error {
		s.skillRefs = append(s.skillRefs, ref)
		return nil
	}
}

// WithSkillRefs adds multiple skill references to the inline sub-agent.
//
// Example:
//
//	subagent.WithSkillRefs(
//	    skillref.Platform("code-review"),
//	    skillref.Platform("security-guidelines", "stable"),
//	)
func WithSkillRefs(refs ...*apiresource.ApiResourceReference) InlineOption {
	return func(s *SubAgent) error {
		s.skillRefs = append(s.skillRefs, refs...)
		return nil
	}
}

// Inline creates an inline sub-agent definition.
//
// Returns an error if any option fails (e.g., file not found).
//
// Example:
//
//	sub, err := subagent.Inline(
//	    subagent.WithName("code-analyzer"),
//	    subagent.WithInstructions("Analyze code for bugs"),
//	    subagent.WithDescription("Static code analyzer"),
//	    subagent.WithMCPServer("github"),
//	)
//	if err != nil {
//	    log.Fatal(err)
//	}
func Inline(opts ...InlineOption) (SubAgent, error) {
	s := SubAgent{
		subAgentType: subAgentTypeInline,
	}
	for _, opt := range opts {
		if err := opt(&s); err != nil {
			return SubAgent{}, err
		}
	}
	return s, nil
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
func (s SubAgent) ToolSelections() map[string][]string {
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
