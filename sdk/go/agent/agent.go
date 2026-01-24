package agent

import (
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
//	    ag, err := agent.New(ctx, "code-reviewer",
//	        gen.AgentInstructions("Review code and suggest improvements"),
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
//   - SkillRefs: skill references
//   - McpServers: MCP server definitions
//   - SubAgents: sub-agents
//   - EnvSpec: environment variables
//
// Example (clean single-package import):
//
//	import "github.com/stigmer/stigmer/sdk/go/agent"
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
//	        Instructions: "Review code and suggest improvements",
//	        Description:  "Professional code reviewer",
//	    })
//	    return err
//	})
//
// Example with nil args (creates empty agent):
//
//	ag, err := agent.New(ctx, "code-reviewer", nil)
//	ag.Instructions = "Review code..."  // Set fields directly
//
// Example with builder methods:
//
//	ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
//	    Instructions: "Review code...",
//	})
//	ag.AddSkill(skill.Platform("coding-best-practices"))
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

	// Convert proto types to SDK types
	// Note: Full conversion will be implemented as we add support for these fields
	// For now, we initialize empty slices to avoid nil pointer issues
	a.Skills = []skill.Skill{}
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
