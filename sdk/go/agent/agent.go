package agent

import (
	"os"

	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skill"
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

// Option is a functional option for configuring an Agent.
type Option func(*Agent) error


// New creates a new Agent with a typed context for variable management.
//
// The agent is automatically registered with the provided context for synthesis.
//
// Required options:
//   - WithName: agent name
//   - WithInstructions: behavior instructions
//
// Example:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    ag, err := agent.New(ctx,
//	        agent.WithName("code-reviewer"),
//	        agent.WithInstructions("Review code and suggest improvements"),
//	    )
//	    return err
//	})
func New(ctx Context, opts ...Option) (*Agent, error) {
	a := &Agent{
		ctx: ctx,
	}

	// Apply all options
	for _, opt := range opts {
		if err := opt(a); err != nil {
			return nil, err
		}
	}

	// Validate the agent
	if err := validate(a); err != nil {
		return nil, err
	}

	// Register with context
	ctx.RegisterAgent(a)

	return a, nil
}

// WithName sets the agent name.
//
// The name must be lowercase alphanumeric with hyphens, max 63 characters.
// This is a required field.
//
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	agent.WithName("code-reviewer")                           // Legacy string
//	agent.WithName(ctx.SetString("agentName", "reviewer"))    // Typed context
func WithName(name interface{}) Option {
	return func(a *Agent) error {
		a.Name = toExpression(name)
		return nil
	}
}

// WithInstructions sets the agent's behavior instructions from a string.
//
// Instructions must be between 10 and 10,000 characters.
// This is a required field.
//
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	agent.WithInstructions("Review code and suggest improvements")                    // Legacy string
//	agent.WithInstructions(ctx.SetString("instructions", "Review code..."))          // Typed context
func WithInstructions(instructions interface{}) Option {
	return func(a *Agent) error {
		a.Instructions = toExpression(instructions)
		return nil
	}
}

// WithInstructionsFromFile sets the agent's behavior instructions from a file.
//
// Reads the file content and sets it as the agent's instructions.
// The file content must be between 10 and 10,000 characters.
// This is a required field (alternative to WithInstructions).
//
// Example:
//
//	agent.WithInstructionsFromFile("instructions/code-reviewer.md")
func WithInstructionsFromFile(path string) Option {
	return func(a *Agent) error {
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		a.Instructions = string(content)
		return nil
	}
}

// WithDescription sets the agent's human-readable description.
//
// Description is optional and must be max 500 characters.
//
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	agent.WithDescription("AI code reviewer")                                  // Legacy string
//	agent.WithDescription(ctx.SetString("description", "AI reviewer"))         // Typed context
func WithDescription(description interface{}) Option {
	return func(a *Agent) error {
		a.Description = toExpression(description)
		return nil
	}
}

// WithIconURL sets the agent's icon URL for UI display.
//
// The URL must be a valid HTTP/HTTPS URL.
// This is an optional field.
//
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	agent.WithIconURL("https://example.com/icon.png")                      // Legacy string
//	agent.WithIconURL(ctx.SetString("iconURL", "https://..."))             // Typed context
func WithIconURL(url interface{}) Option {
	return func(a *Agent) error {
		a.IconURL = toExpression(url)
		return nil
	}
}

// WithOrg sets the organization that owns this agent.
//
// This is an optional field.
//
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	agent.WithOrg("my-org")                                    // Legacy string
//	agent.WithOrg(ctx.SetString("org", "my-org"))              // Typed context
func WithOrg(org interface{}) Option {
	return func(a *Agent) error {
		a.Org = toExpression(org)
		return nil
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
