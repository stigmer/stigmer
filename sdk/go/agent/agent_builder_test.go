package agent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skillref"
	"github.com/stigmer/stigmer/sdk/go/subagent"
)

func TestAddSkillRef(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Start with no skills
	if len(agent.Skills) != 0 {
		t.Errorf("Initial skills count = %d, want 0", len(agent.Skills))
	}

	// Add skill using builder method
	agent.AddSkillRef(skillref.Platform("coding-best-practices"))

	if len(agent.Skills) != 1 {
		t.Errorf("Skills count = %d, want 1", len(agent.Skills))
	}
	if agent.Skills[0].Slug != "coding-best-practices" {
		t.Errorf("Skill slug = %q, want %q", agent.Skills[0].Slug, "coding-best-practices")
	}
}

func TestAddSkills(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add multiple skills using builder method
	agent.AddSkillRefs(
		skillref.Platform("coding-best-practices"),
		skillref.Platform("security-analysis"),
		skillref.Organization("my-org", "internal-docs"),
	)

	if len(agent.Skills) != 3 {
		t.Errorf("Skills count = %d, want 3", len(agent.Skills))
	}
}

func TestAddSkill_Chaining(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Chain multiple AddSkill calls
	agent.
		AddSkillRef(skillref.Platform("skill1")).
		AddSkillRef(skillref.Platform("skill2")).
		AddSkillRef(skillref.Platform("skill3"))

	if len(agent.Skills) != 3 {
		t.Errorf("Skills count = %d, want 3", len(agent.Skills))
	}
}

func TestAddMCPServer(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	github, err := mcpserver.Stdio(
		mcpserver.WithName("github"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
	)
	if err != nil {
		t.Fatalf("Failed to create MCP server: %v", err)
	}

	// Add MCP server using builder method
	agent.AddMCPServer(github)

	if len(agent.MCPServers) != 1 {
		t.Errorf("MCPServers count = %d, want 1", len(agent.MCPServers))
	}
	if agent.MCPServers[0].Name() != "github" {
		t.Errorf("MCPServer name = %q, want %q", agent.MCPServers[0].Name(), "github")
	}
}

func TestAddMCPServers(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	github, _ := mcpserver.Stdio(
		mcpserver.WithName("github"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
	)

	gitlab, _ := mcpserver.Stdio(
		mcpserver.WithName("gitlab"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-gitlab"),
	)

	// Add multiple MCP servers using builder method
	agent.AddMCPServers(github, gitlab)

	if len(agent.MCPServers) != 2 {
		t.Errorf("MCPServers count = %d, want 2", len(agent.MCPServers))
	}
}

func TestAddMCPServer_Chaining(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	github, _ := mcpserver.Stdio(
		mcpserver.WithName("github"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
	)

	gitlab, _ := mcpserver.Stdio(
		mcpserver.WithName("gitlab"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-gitlab"),
	)

	// Chain multiple AddMCPServer calls
	agent.
		AddMCPServer(github).
		AddMCPServer(gitlab)

	if len(agent.MCPServers) != 2 {
		t.Errorf("MCPServers count = %d, want 2", len(agent.MCPServers))
	}
}

func TestAddSubAgent(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	helper, err := subagent.New("helper", &subagent.Args{
		Instructions: "Helper instructions",
	})
	if err != nil {
		t.Fatalf("Failed to create sub-agent: %v", err)
	}

	// Add sub-agent using builder method
	agent.AddSubAgent(helper)

	if len(agent.SubAgents) != 1 {
		t.Errorf("SubAgents count = %d, want 1", len(agent.SubAgents))
	}
	if agent.SubAgents[0].Name() != "helper" {
		t.Errorf("SubAgent name = %q, want %q", agent.SubAgents[0].Name(), "helper")
	}
}

func TestAddSubAgents(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	helper1, _ := subagent.New("helper1", &subagent.Args{
		Instructions: "Helper 1 instructions",
	})

	helper2, _ := subagent.New("helper2", &subagent.Args{
		Instructions: "Helper 2 instructions",
	})

	// Add multiple sub-agents using builder method
	agent.AddSubAgents(helper1, helper2)

	if len(agent.SubAgents) != 2 {
		t.Errorf("SubAgents count = %d, want 2", len(agent.SubAgents))
	}
}

func TestAddSubAgent_Chaining(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	helper1, _ := subagent.New("helper1", &subagent.Args{
		Instructions: "Helper 1 instructions",
	})

	helper2, _ := subagent.New("helper2", &subagent.Args{
		Instructions: "Helper 2 instructions",
	})

	// Chain multiple AddSubAgent calls
	agent.
		AddSubAgent(helper1).
		AddSubAgent(helper2)

	if len(agent.SubAgents) != 2 {
		t.Errorf("SubAgents count = %d, want 2", len(agent.SubAgents))
	}
}

func TestAddEnvironmentVariable(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	githubToken, err := environment.New(
		environment.WithName("GITHUB_TOKEN"),
		environment.WithSecret(true),
	)
	if err != nil {
		t.Fatalf("Failed to create environment variable: %v", err)
	}

	// Add environment variable using builder method
	agent.AddEnvironmentVariable(githubToken)

	if len(agent.EnvironmentVariables) != 1 {
		t.Errorf("EnvironmentVariables count = %d, want 1", len(agent.EnvironmentVariables))
	}
	if agent.EnvironmentVariables[0].Name != "GITHUB_TOKEN" {
		t.Errorf("EnvironmentVariable name = %q, want %q", agent.EnvironmentVariables[0].Name, "GITHUB_TOKEN")
	}
}

func TestAddEnvironmentVariables(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	githubToken, _ := environment.New(
		environment.WithName("GITHUB_TOKEN"),
		environment.WithSecret(true),
	)

	awsRegion, _ := environment.New(
		environment.WithName("AWS_REGION"),
		environment.WithDefaultValue("us-east-1"),
	)

	// Add multiple environment variables using builder method
	agent.AddEnvironmentVariables(githubToken, awsRegion)

	if len(agent.EnvironmentVariables) != 2 {
		t.Errorf("EnvironmentVariables count = %d, want 2", len(agent.EnvironmentVariables))
	}
}

func TestAddEnvironmentVariable_Chaining(t *testing.T) {
	agent, err := New(
		nil, // No context needed for builder tests
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	githubToken, _ := environment.New(
		environment.WithName("GITHUB_TOKEN"),
		environment.WithSecret(true),
	)

	awsRegion, _ := environment.New(
		environment.WithName("AWS_REGION"),
		environment.WithDefaultValue("us-east-1"),
	)

	// Chain multiple AddEnvironmentVariable calls
	agent.
		AddEnvironmentVariable(githubToken).
		AddEnvironmentVariable(awsRegion)

	if len(agent.EnvironmentVariables) != 2 {
		t.Errorf("EnvironmentVariables count = %d, want 2", len(agent.EnvironmentVariables))
	}
}

func TestBuilder_ComplexChaining(t *testing.T) {
	// Test chaining all builder methods together
	github, _ := mcpserver.Stdio(
		mcpserver.WithName("github"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
	)

	helper, _ := subagent.New("helper", &subagent.Args{
		Instructions: "Helper instructions",
	})

	githubToken, _ := environment.New(
		environment.WithName("GITHUB_TOKEN"),
		environment.WithSecret(true),
	)

	agent, err := New(
		nil, // No context needed for builder tests
		"complex-agent",
		&AgentArgs{
			Instructions: "Complex agent with all features",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Chain all builder methods
	agent.
		AddSkillRef(skillref.Platform("coding-best-practices")).
		AddSkillRef(skillref.Platform("security-analysis")).
		AddMCPServer(github).
		AddSubAgent(helper).
		AddEnvironmentVariable(githubToken)

	// Verify all were added
	if len(agent.Skills) != 2 {
		t.Errorf("Skills count = %d, want 2", len(agent.Skills))
	}
	if len(agent.MCPServers) != 1 {
		t.Errorf("MCPServers count = %d, want 1", len(agent.MCPServers))
	}
	if len(agent.SubAgents) != 1 {
		t.Errorf("SubAgents count = %d, want 1", len(agent.SubAgents))
	}
	if len(agent.EnvironmentVariables) != 1 {
		t.Errorf("EnvironmentVariables count = %d, want 1", len(agent.EnvironmentVariables))
	}
}
