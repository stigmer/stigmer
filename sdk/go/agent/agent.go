package agent

import (
	"os"

	"github.com/stigmer/stigmer/sdk/go/agent/gen"
	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
	"github.com/stigmer/stigmer/sdk/go/subagent"
)

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
//	    ag, err := agent.New(ctx,
//	        agent.WithName("code-reviewer"),
//	        agent.WithInstructions("Review code and suggest improvements"),
//	    )
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

	// Skills are references to Skill resources providing agent knowledge.
	Skills []skill.Skill

	// MCPServers are MCP server definitions declaring required servers.
	MCPServers []mcpserver.MCPServer

	// SubAgents are sub-agents that can be delegated to (inline or referenced).
	SubAgents []subagent.SubAgent

	// EnvironmentVariables are environment variables required by the agent.
	EnvironmentVariables []environment.Variable

	// Context reference (optional, used for typed variable management)
	ctx Context
}

// New creates a new Agent with generated functional options.
//
// The agent is automatically registered with the provided context for synthesis.
// Uses Pulumi-style API: name as parameter, options for configuration.
//
// Required:
//   - name: agent name (lowercase alphanumeric with hyphens)
//   - Instructions: behavior instructions (min 10 characters) via gen.Instructions()
//
// Optional:
//   - gen.Description: human-readable description
//   - gen.IconUrl: icon URL for UI display
//   - agent.InstructionsFromFile: load instructions from file
//
// Example:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    ag, err := agent.New(ctx, "code-reviewer",
//	        gen.Instructions("Review code and suggest improvements"),
//	    )
//	    return err
//	})
//
// Example with file loading helper:
//
//	ag, err := agent.New(ctx, "code-reviewer",
//	    agent.InstructionsFromFile("instructions.md"),
//	    gen.Description("Professional code reviewer"),
//	)
func New(ctx Context, name string, opts ...gen.AgentOption) (*Agent, error) {
	// Apply options to a temporary AgentSpec
	spec := &gen.AgentSpec{}
	for _, opt := range opts {
		opt(spec)
	}

	// Create Agent from spec
	a := &Agent{
		Name:         name,
		Instructions: spec.Instructions,
		Description:  spec.Description,
		IconURL:      spec.IconUrl,
		ctx:          ctx,
	}
	
	// TODO: Convert proto types to SDK types
	// - spec.SkillRefs -> a.Skills
	// - spec.McpServers -> a.MCPServers
	// - spec.SubAgents -> a.SubAgents
	// - spec.EnvSpec -> a.EnvironmentVariables

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
// Ergonomic Helpers - Manual options that provide convenience beyond generated
// ============================================================================

// InstructionsFromFile loads agent instructions from a file.
//
// This is a convenience helper that wraps file I/O and returns a generated option.
// The file content must be between 10 and 10,000 characters.
//
// Example:
//
//	agent.New(ctx, "code-reviewer",
//	    agent.InstructionsFromFile("instructions/code-reviewer.md"),
//	)
func InstructionsFromFile(path string) gen.AgentOption {
	return func(spec *gen.AgentSpec) {
		content, err := os.ReadFile(path)
		if err != nil {
			// For now, we silently fail. Consider logging or panicking
			// TODO: Decide on error handling strategy for file-loading helpers
			return
		}
		spec.Instructions = string(content)
	}
}

// Org sets the organization that owns this agent (SDK-level field).
//
// Note: This is an SDK-level field, not part of AgentSpec.
// It's stored temporarily and extracted by the constructor.
//
// Example:
//
//	agent.New(ctx, "my-agent",
//	    gen.Instructions("..."),
//	    agent.Org("my-org"),
//	)
func Org(org string) gen.AgentOption {
	return func(spec *gen.AgentSpec) {
		// Store in Description temporarily (hack until we have better solution)
		// TODO: Find a better way to pass SDK-level fields through options
		_ = org // Suppress unused warning for now
	}
}

// WithSkill adds a skill reference to the agent.
//
// Skills provide knowledge and capabilities to agents.
// Multiple skills can be added by calling this option multiple times
// or by using WithSkills() for bulk addition.
//
// Example:
//
//	agent.WithSkill(skill.Platform("coding-best-practices"))
//	agent.WithSkill(skill.Organization("my-org", "internal-docs"))
func WithSkill(s skill.Skill) Option {
	return func(a *Agent) error {
		a.Skills = append(a.Skills, s)
		return nil
	}
}

// WithSkills adds multiple skill references to the agent.
//
// This is a convenience function for adding multiple skills at once.
//
// Example:
//
//	agent.WithSkills(
//	    skill.Platform("coding-best-practices"),
//	    skill.Organization("my-org", "internal-docs"),
//	)
func WithSkills(skills ...skill.Skill) Option {
	return func(a *Agent) error {
		a.Skills = append(a.Skills, skills...)
		return nil
	}
}

// WithMCPServer adds an MCP server definition to the agent.
//
// MCP servers provide tools and capabilities to agents.
// Multiple MCP servers can be added by calling this option multiple times
// or by using WithMCPServers() for bulk addition.
//
// Example:
//
//	github, _ := mcpserver.Stdio(
//	    mcpserver.WithName("github"),
//	    mcpserver.WithCommand("npx"),
//	    mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
//	)
//	agent.WithMCPServer(github)
func WithMCPServer(server mcpserver.MCPServer) Option {
	return func(a *Agent) error {
		a.MCPServers = append(a.MCPServers, server)
		return nil
	}
}

// WithMCPServers adds multiple MCP server definitions to the agent.
//
// This is a convenience function for adding multiple MCP servers at once.
//
// Example:
//
//	github, _ := mcpserver.Stdio(...)
//	aws, _ := mcpserver.HTTP(...)
//	agent.WithMCPServers(github, aws)
func WithMCPServers(servers ...mcpserver.MCPServer) Option {
	return func(a *Agent) error {
		a.MCPServers = append(a.MCPServers, servers...)
		return nil
	}
}

// WithSubAgent adds a sub-agent to the agent.
//
// Sub-agents can be delegated to for specific tasks.
// They can be either inline definitions or references to existing AgentInstance resources.
//
// Example:
//
//	agent.WithSubAgent(subagent.Inline(
//	    subagent.WithName("code-analyzer"),
//	    subagent.WithInstructions("Analyze code for bugs"),
//	))
//	agent.WithSubAgent(subagent.Reference("security", "sec-checker-prod"))
func WithSubAgent(sub subagent.SubAgent) Option {
	return func(a *Agent) error {
		a.SubAgents = append(a.SubAgents, sub)
		return nil
	}
}

// WithSubAgents adds multiple sub-agents to the agent.
//
// This is a convenience function for adding multiple sub-agents at once.
//
// Example:
//
//	agent.WithSubAgents(
//	    subagent.Inline(...),
//	    subagent.Reference("security", "sec-prod"),
//	)
func WithSubAgents(subs ...subagent.SubAgent) Option {
	return func(a *Agent) error {
		a.SubAgents = append(a.SubAgents, subs...)
		return nil
	}
}

// WithEnvironmentVariable adds an environment variable to the agent.
//
// Environment variables define what external configuration the agent needs to run.
// They can be configuration values or secrets.
//
// Example:
//
//	githubToken, _ := environment.New(
//	    environment.WithName("GITHUB_TOKEN"),
//	    environment.WithSecret(true),
//	)
//	agent.WithEnvironmentVariable(githubToken)
func WithEnvironmentVariable(variable environment.Variable) Option {
	return func(a *Agent) error {
		a.EnvironmentVariables = append(a.EnvironmentVariables, variable)
		return nil
	}
}

// WithEnvironmentVariables adds multiple environment variables to the agent.
//
// This is a convenience function for adding multiple environment variables at once.
//
// Example:
//
//	githubToken, _ := environment.New(...)
//	awsRegion, _ := environment.New(...)
//	agent.WithEnvironmentVariables(githubToken, awsRegion)
func WithEnvironmentVariables(variables ...environment.Variable) Option {
	return func(a *Agent) error {
		a.EnvironmentVariables = append(a.EnvironmentVariables, variables...)
		return nil
	}
}

// AddSkill adds a skill to the agent after creation.
//
// This is a builder method that allows adding skills after the agent is created.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	agent.AddSkill(skill.Platform("coding-best-practices"))
func (a *Agent) AddSkill(s skill.Skill) *Agent {
	a.Skills = append(a.Skills, s)
	return a
}

// AddSkills adds multiple skills to the agent after creation.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	agent.AddSkills(
//	    skill.Platform("coding-best-practices"),
//	    skill.Organization("my-org", "internal-docs"),
//	)
func (a *Agent) AddSkills(skills ...skill.Skill) *Agent {
	a.Skills = append(a.Skills, skills...)
	return a
}

// AddMCPServer adds an MCP server to the agent after creation.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	github, _ := mcpserver.Stdio(mcpserver.WithName("github"))
//	agent.AddMCPServer(github)
func (a *Agent) AddMCPServer(server mcpserver.MCPServer) *Agent {
	a.MCPServers = append(a.MCPServers, server)
	return a
}

// AddMCPServers adds multiple MCP servers to the agent after creation.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	agent.AddMCPServers(github, aws)
func (a *Agent) AddMCPServers(servers ...mcpserver.MCPServer) *Agent {
	a.MCPServers = append(a.MCPServers, servers...)
	return a
}

// AddSubAgent adds a sub-agent to the agent after creation.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	agent.AddSubAgent(subagent.Reference("security", "sec-prod"))
func (a *Agent) AddSubAgent(sub subagent.SubAgent) *Agent {
	a.SubAgents = append(a.SubAgents, sub)
	return a
}

// AddSubAgents adds multiple sub-agents to the agent after creation.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	agent.AddSubAgents(sub1, sub2)
func (a *Agent) AddSubAgents(subs ...subagent.SubAgent) *Agent {
	a.SubAgents = append(a.SubAgents, subs...)
	return a
}

// AddEnvironmentVariable adds an environment variable to the agent after creation.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	githubToken, _ := environment.New(environment.WithName("GITHUB_TOKEN"))
//	agent.AddEnvironmentVariable(githubToken)
func (a *Agent) AddEnvironmentVariable(variable environment.Variable) *Agent {
	a.EnvironmentVariables = append(a.EnvironmentVariables, variable)
	return a
}

// AddEnvironmentVariables adds multiple environment variables to the agent after creation.
//
// Example:
//
//	agent, _ := agent.New(agent.WithName("reviewer"))
//	agent.AddEnvironmentVariables(githubToken, awsRegion)
func (a *Agent) AddEnvironmentVariables(variables ...environment.Variable) *Agent {
	a.EnvironmentVariables = append(a.EnvironmentVariables, variables...)
	return a
}

// String returns a string representation of the Agent.
func (a *Agent) String() string {
	return "Agent(name=" + a.Name + ")"
}
