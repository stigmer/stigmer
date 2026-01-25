package agent

import (
	"sync"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/sdk/go/environment"
	genAgent "github.com/stigmer/stigmer/sdk/go/gen/agent"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
	"github.com/stigmer/stigmer/sdk/go/subagent"
)

// AgentArgs is an alias for the generated AgentArgs from gen/agent
type AgentArgs = genAgent.AgentArgs

// Context is a minimal interface that represents a stigmer context.
// This allows the agent package to work with contexts without importing
// the stigmer package (avoiding import cycles).
//
// The stigmer.Context type implements this interface.
type Context interface {
	RegisterAgent(*Agent)
}

// Agent represents an AI agent template with skills, MCP servers, and configuration.
//
// The Agent is the "template" layer - it defines the immutable logic and requirements
// for an agent. Actual configuration with secrets happens at the AgentInstance level.
//
// Use agent.New() with stigmer.Run() to create an Agent:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
//	        Instructions: "Review code and suggest improvements",
//	    })
//	    return err
//	})
type Agent struct {
	// Name is the agent name (lowercase alphanumeric with hyphens, max 63 chars).
	Name string

	// Slug is the URL-friendly identifier (auto-generated from name if not provided).
	Slug string

	// Instructions define the agent's behavior and personality (min 10, max 10000 chars).
	Instructions string

	// Description is a human-readable description for UI display (optional, max 500 chars).
	Description string

	// IconURL is the icon URL for marketplace and UI display (optional).
	IconURL string

	// Org is the organization that owns this agent (optional).
	Org string

	// SkillRefs are references to Skill resources providing agent knowledge.
	// Use AddSkillRef() for platform skills or AddOrgSkillRef() for organization skills.
	// Skills are pushed via `stigmer skill push` CLI - the SDK only references them.
	SkillRefs []*apiresource.ApiResourceReference

	// MCPServers are MCP server definitions declaring required servers.
	MCPServers []mcpserver.MCPServer

	// SubAgents are sub-agents that can be delegated to (inline or referenced).
	SubAgents []subagent.SubAgent

	// EnvironmentVariables are environment variables required by the agent.
	EnvironmentVariables []environment.Variable

	// Context reference (optional, used for typed variable management)
	ctx Context

	// mu protects concurrent access to SkillRefs, MCPServers, SubAgents, and EnvironmentVariables slices
	mu sync.Mutex
}

// New creates a new Agent with struct-based args (Pulumi pattern).
//
// The agent is automatically registered with the provided context for synthesis.
// Follows Pulumi's Args pattern: name as parameter, args struct for configuration.
//
// Required:
//   - name: agent name (lowercase alphanumeric with hyphens)
//   - args.Instructions: behavior instructions (min 10 characters)
//
// Optional args fields:
//   - Description: human-readable description
//   - IconUrl: icon URL for UI display
//
// Example (clean single-package import):
//
//	import (
//	    "github.com/stigmer/stigmer/sdk/go/agent"
//	    "github.com/stigmer/stigmer/sdk/go/skillref"
//	)
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
//	        Instructions: "Review code and suggest improvements",
//	        Description:  "Professional code reviewer",
//	    })
//	    if err != nil {
//	        return err
//	    }
//	    ag.AddSkillRef(skillref.Platform("coding-best-practices"))
//	    ag.AddOrgSkillRef("internal-docs", "v1.0")
//	    return nil
//	})
func New(ctx Context, name string, args *AgentArgs) (*Agent, error) {
	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &AgentArgs{}
	}

	// Create Agent from args
	a := &Agent{
		Name:         name,
		Instructions: args.Instructions,
		Description:  args.Description,
		IconURL:      args.IconUrl,
		ctx:          ctx,
	}

	// Initialize empty slices to avoid nil pointer issues
	a.SkillRefs = []*apiresource.ApiResourceReference{}
	a.MCPServers = []mcpserver.MCPServer{}
	a.SubAgents = []subagent.SubAgent{}
	a.EnvironmentVariables = []environment.Variable{}

	// Auto-generate slug from name if not provided
	if a.Slug == "" && a.Name != "" {
		a.Slug = naming.GenerateSlug(a.Name)
	}

	// If name not provided but slug is, use slug as name
	if a.Name == "" && a.Slug != "" {
		a.Name = a.Slug
	}

	// Validate the agent
	if err := validate(a); err != nil {
		return nil, err
	}

	// Validate slug format
	if a.Slug != "" {
		if err := naming.ValidateSlug(a.Slug); err != nil {
			return nil, err
		}
	}

	// Register with context (if provided)
	if ctx != nil {
		ctx.RegisterAgent(a)
	}

	return a, nil
}

// ============================================================================
// Builder Methods - Modify agent after construction
// ============================================================================

// AddSkillRef adds a skill reference to the agent.
//
// Use skillref.Platform() to create platform skill references.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	import "github.com/stigmer/stigmer/sdk/go/skillref"
//
//	agent.AddSkillRef(skillref.Platform("coding-best-practices"))
//	agent.AddSkillRef(skillref.Platform("code-review", "v1.0"))
func (a *Agent) AddSkillRef(ref *apiresource.ApiResourceReference) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.SkillRefs = append(a.SkillRefs, ref)
	return a
}

// AddSkillRefs adds multiple skill references to the agent.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent.AddSkillRefs(
//	    skillref.Platform("coding-best-practices"),
//	    skillref.Platform("security-guidelines", "stable"),
//	)
func (a *Agent) AddSkillRefs(refs ...*apiresource.ApiResourceReference) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.SkillRefs = append(a.SkillRefs, refs...)
	return a
}

// AddOrgSkillRef adds an organization-scoped skill reference using the agent's Org.
//
// This is a convenience method that creates a skill reference scoped to the
// agent's organization. The agent's Org field must be set for this to work correctly.
//
// Version is optional - if omitted or empty, "latest" is used.
//
// Example:
//
//	agent.AddOrgSkillRef("internal-docs")           // Latest version
//	agent.AddOrgSkillRef("internal-docs", "v2.0")   // Specific version
//	agent.AddOrgSkillRef("security-policy", "stable")
func (a *Agent) AddOrgSkillRef(slug string, version ...string) *Agent {
	ref := &apiresource.ApiResourceReference{
		Kind:  apiresourcekind.ApiResourceKind_skill,
		Slug:  slug,
		Scope: apiresource.ApiResourceOwnerScope_organization,
		Org:   a.Org,
	}
	if len(version) > 0 && version[0] != "" {
		ref.Version = version[0]
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	a.SkillRefs = append(a.SkillRefs, ref)
	return a
}

// AddMCPServer adds an MCP server to the agent after creation.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	github, _ := mcpserver.Stdio(mcpserver.WithName("github"))
//	agent.AddMCPServer(github)
func (a *Agent) AddMCPServer(server mcpserver.MCPServer) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.MCPServers = append(a.MCPServers, server)
	return a
}

// AddMCPServers adds multiple MCP servers to the agent after creation.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	agent.AddMCPServers(github, aws)
func (a *Agent) AddMCPServers(servers ...mcpserver.MCPServer) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.MCPServers = append(a.MCPServers, servers...)
	return a
}

// AddSubAgent adds a sub-agent to the agent after creation.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	agent.AddSubAgent(subagent.Reference("security", "sec-prod"))
func (a *Agent) AddSubAgent(sub subagent.SubAgent) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.SubAgents = append(a.SubAgents, sub)
	return a
}

// AddSubAgents adds multiple sub-agents to the agent after creation.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	agent.AddSubAgents(sub1, sub2)
func (a *Agent) AddSubAgents(subs ...subagent.SubAgent) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.SubAgents = append(a.SubAgents, subs...)
	return a
}

// AddEnvironmentVariable adds an environment variable to the agent after creation.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	githubToken, _ := environment.New(environment.WithName("GITHUB_TOKEN"))
//	agent.AddEnvironmentVariable(githubToken)
func (a *Agent) AddEnvironmentVariable(variable environment.Variable) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.EnvironmentVariables = append(a.EnvironmentVariables, variable)
	return a
}

// AddEnvironmentVariables adds multiple environment variables to the agent after creation.
// This method is thread-safe and can be called concurrently.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	agent.AddEnvironmentVariables(githubToken, awsRegion)
func (a *Agent) AddEnvironmentVariables(variables ...environment.Variable) *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.EnvironmentVariables = append(a.EnvironmentVariables, variables...)
	return a
}

// String returns a string representation of the Agent.
func (a *Agent) String() string {
	return "Agent(name=" + a.Name + ")"
}
