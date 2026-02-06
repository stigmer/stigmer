package agent

import (
	"fmt"
	"sync"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// SubAgentArgs contains configuration for a sub-agent (Pulumi Args pattern).
type SubAgentArgs struct {
	// Description of what this sub-agent does.
	Description string

	// Instructions defining the sub-agent's behavior (min 10 characters).
	Instructions string
}

// SubAgent represents a sub-agent that can be delegated to within the Agent aggregate.
//
// SubAgents are value objects - they cannot exist independently. They are defined
// inline within the parent agent spec and have restricted access to the parent's
// MCP servers via McpAccess grants.
//
// Sub-agents can only use MCP servers that the parent has declared and can only
// restrict the tools further (cannot expand access beyond what parent has).
//
// Unlike Agent, SubAgent has no Org field. All skill references must use explicit
// "org/slug" format. Use AddSkill() or TryAddSkill() for smart parsing.
//
// All methods that modify SubAgent state are thread-safe.
type SubAgent struct {
	name         string
	description  string
	instructions string
	mcpAccess    []*agentv1.McpAccess
	skillRefs    []*apiresource.ApiResourceReference

	// mu protects concurrent access to mcpAccess and skillRefs slices
	mu sync.Mutex
}

// NewSubAgent creates a sub-agent definition with struct args (Pulumi pattern).
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
//	sub, err := agent.NewSubAgent("code-analyzer", &agent.SubAgentArgs{
//	    Instructions: "Analyze code for bugs and security issues",
//	    Description:  "Static code analyzer",
//	})
//	sub.GrantMcpAccess("github", "search_code", "get_file")
func NewSubAgent(name string, args *SubAgentArgs) (SubAgent, error) {
	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &SubAgentArgs{}
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
// This method is thread-safe and can be called concurrently.
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

	s.mu.Lock()
	defer s.mu.Unlock()
	s.mcpAccess = append(s.mcpAccess, access)
	return s
}

// AddSkillRef adds a skill reference to the sub-agent.
// Sub-agents can have their own skill references independent of the parent.
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	sub.AddSkillRef(ref.Skill("stigmer", "code-review-best-practices"))
func (s *SubAgent) AddSkillRef(ref *apiresource.ApiResourceReference) *SubAgent {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.skillRefs = append(s.skillRefs, ref)
	return s
}

// AddSkillRefs adds multiple skill references to the sub-agent.
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	sub.AddSkillRefs(
//	    ref.Skill("stigmer", "code-review"),
//	    ref.Skill("stigmer", "security-guidelines"),
//	)
func (s *SubAgent) AddSkillRefs(refs ...*apiresource.ApiResourceReference) *SubAgent {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.skillRefs = append(s.skillRefs, refs...)
	return s
}

// AddOrgSkillRef adds an organization-scoped skill reference.
// The org parameter specifies which organization the skill belongs to.
//
// Version is optional - if omitted or empty, "latest" is used.
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	sub.AddOrgSkillRef("acme-corp", "internal-docs")
//	sub.AddOrgSkillRef("acme-corp", "internal-docs", "v1.0")
func (s *SubAgent) AddOrgSkillRef(org, slug string, version ...string) *SubAgent {
	ref := &apiresource.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_skill,
		Slug: slug,
		Org:  org,
	}
	if len(version) > 0 && version[0] != "" {
		ref.Version = version[0]
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.skillRefs = append(s.skillRefs, ref)
	return s
}

// ============================================================================
// Smart Parsing Methods - Add skills with org/slug parsing
// ============================================================================

// AddSubAgentSkill adds a skill reference using smart org/slug parsing.
//
// Unlike Agent.AddSkill(), SubAgents have no Org field and therefore cannot
// resolve slug-only references. All references must use explicit "org/slug" format.
//
// Parsing rules:
//   - "org/slug" → Uses org and slug from the reference
//   - "org/slug@v1.0" → Extracts version from the reference string
//   - Version can also be set via AtVersion() option (overrides string version)
//
// Panics if the format is invalid or if the reference is slug-only.
// For dynamic/user-provided input, use TryAddSubAgentSkill instead.
//
// This method is thread-safe and can be called concurrently.
//
// Examples:
//
//	sub.AddSubAgentSkill("stigmer/web-search")                    // Explicit org/slug
//	sub.AddSubAgentSkill("stigmer/web-search@v1.0")               // With version in string
//	sub.AddSubAgentSkill("stigmer/web-search", AtVersion("v1.0")) // With version option
//
//	// Chain multiple skills
//	sub.AddSubAgentSkill("stigmer/code-review").AddSubAgentSkill("acme/security-analysis")
//
//	// ERROR: slug-only not supported (no org context)
//	sub.AddSubAgentSkill("web-search")  // Panics with ErrSubAgentOrgRequired
func (s *SubAgent) AddSubAgentSkill(ref string, opts ...SkillOption) *SubAgent {
	parsed, err := parseSubAgentSkillRef(ref, opts...)
	if err != nil {
		panic(err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.skillRefs = append(s.skillRefs, parsed)
	return s
}

// AddSubAgentSkills adds multiple skill references using smart org/slug parsing.
//
// Each reference follows the same parsing rules as AddSubAgentSkill.
// Panics on the first invalid reference - no skills are added if any is invalid
// (atomic operation).
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	sub.AddSubAgentSkills(
//	    "stigmer/web-search",           // Explicit org/slug
//	    "acme/code-review",             // Different org
//	    "stigmer/security@v2.0",        // With version
//	)
func (s *SubAgent) AddSubAgentSkills(refs ...string) *SubAgent {
	if len(refs) == 0 {
		return s
	}

	// Parse all refs first to fail fast before modifying state
	parsed := make([]*apiresource.ApiResourceReference, len(refs))
	for i, ref := range refs {
		p, err := parseSubAgentSkillRef(ref)
		if err != nil {
			panic(err)
		}
		parsed[i] = p
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.skillRefs = append(s.skillRefs, parsed...)
	return s
}

// TryAddSubAgentSkill is like AddSubAgentSkill but returns an error instead of panicking.
//
// Use this for dynamic/user-provided references where panicking is not appropriate.
// Returns the SubAgent and nil error on success, or the SubAgent and the error
// on failure (SubAgent is not modified on failure).
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	ref := getUserInput() // Dynamic input
//	sub, err := sub.TryAddSubAgentSkill(ref)
//	if err != nil {
//	    var parseErr *SubAgentRefParseError
//	    if errors.As(err, &parseErr) {
//	        log.Printf("Invalid skill reference %q: %s", parseErr.Ref, parseErr.Message)
//	    }
//	    if errors.Is(err, ErrSubAgentOrgRequired) {
//	        log.Printf("Hint: Use explicit org/slug format like 'stigmer/web-search'")
//	    }
//	    return err
//	}
func (s *SubAgent) TryAddSubAgentSkill(ref string, opts ...SkillOption) (*SubAgent, error) {
	parsed, err := parseSubAgentSkillRef(ref, opts...)
	if err != nil {
		return s, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.skillRefs = append(s.skillRefs, parsed)
	return s, nil
}

// TryAddSubAgentSkills is like AddSubAgentSkills but returns an error instead of panicking.
//
// Stops on the first invalid reference and returns the error.
// No skills are added if any reference is invalid (atomic operation).
//
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	refs := getSkillRefsFromConfig() // Dynamic input
//	sub, err := sub.TryAddSubAgentSkills(refs...)
//	if err != nil {
//	    return fmt.Errorf("invalid skill configuration: %w", err)
//	}
func (s *SubAgent) TryAddSubAgentSkills(refs ...string) (*SubAgent, error) {
	if len(refs) == 0 {
		return s, nil
	}

	// Parse all refs first to fail fast before modifying state
	parsed := make([]*apiresource.ApiResourceReference, len(refs))
	for i, ref := range refs {
		p, err := parseSubAgentSkillRef(ref)
		if err != nil {
			return s, err
		}
		parsed[i] = p
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.skillRefs = append(s.skillRefs, parsed...)
	return s, nil
}

// String returns a string representation of the sub-agent.
func (s SubAgent) String() string {
	return fmt.Sprintf("SubAgent(%s)", s.name)
}
