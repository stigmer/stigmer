package agent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/mcpserverref"
	"github.com/stigmer/stigmer/sdk/go/skillref"
	"github.com/stigmer/stigmer/sdk/go/subagent"
)

// mockBuilderCtx implements the environment.Context interface for testing
type mockBuilderCtx struct{}

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

	// Start with no skill refs
	if len(agent.SkillRefs) != 0 {
		t.Errorf("Initial SkillRefs count = %d, want 0", len(agent.SkillRefs))
	}

	// Add skill ref using builder method
	agent.AddSkillRef(skillref.Platform("coding-best-practices"))

	if len(agent.SkillRefs) != 1 {
		t.Errorf("SkillRefs count = %d, want 1", len(agent.SkillRefs))
	}
	if agent.SkillRefs[0].Slug != "coding-best-practices" {
		t.Errorf("SkillRef slug = %q, want %q", agent.SkillRefs[0].Slug, "coding-best-practices")
	}
}

func TestAddSkillRefs(t *testing.T) {
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

	// Add multiple skill refs using builder method
	agent.AddSkillRefs(
		skillref.Platform("coding-best-practices"),
		skillref.Platform("security-analysis"),
		skillref.Organization("my-org", "internal-docs"),
	)

	if len(agent.SkillRefs) != 3 {
		t.Errorf("SkillRefs count = %d, want 3", len(agent.SkillRefs))
	}
}

func TestAddSkillRef_Chaining(t *testing.T) {
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

	// Chain multiple AddSkillRef calls
	agent.
		AddSkillRef(skillref.Platform("skill1")).
		AddSkillRef(skillref.Platform("skill2")).
		AddSkillRef(skillref.Platform("skill3"))

	if len(agent.SkillRefs) != 3 {
		t.Errorf("SkillRefs count = %d, want 3", len(agent.SkillRefs))
	}
}

func TestAddMcpServerUsage(t *testing.T) {
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

	// Add MCP server usage using builder method
	agent.AddMcpServerUsage(mcpserverref.Platform("github"))

	if len(agent.McpServerUsages) != 1 {
		t.Errorf("McpServerUsages count = %d, want 1", len(agent.McpServerUsages))
	}
	if agent.McpServerUsages[0].McpServerRef.Slug != "github" {
		t.Errorf("McpServerRef slug = %q, want %q", agent.McpServerUsages[0].McpServerRef.Slug, "github")
	}
}

func TestAddMcpServerUsage_WithTools(t *testing.T) {
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

	// Add MCP server usage with enabled tools
	agent.AddMcpServerUsage(
		mcpserverref.Platform("github"),
		"create_issue", "list_repos", "create_pr",
	)

	if len(agent.McpServerUsages) != 1 {
		t.Errorf("McpServerUsages count = %d, want 1", len(agent.McpServerUsages))
	}
	if len(agent.McpServerUsages[0].EnabledTools) != 3 {
		t.Errorf("EnabledTools count = %d, want 3", len(agent.McpServerUsages[0].EnabledTools))
	}
}

func TestUseMCPServer(t *testing.T) {
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

	// Use convenience method
	agent.UseMCPServer("github", "create_issue")

	if len(agent.McpServerUsages) != 1 {
		t.Errorf("McpServerUsages count = %d, want 1", len(agent.McpServerUsages))
	}
	if agent.McpServerUsages[0].McpServerRef.Slug != "github" {
		t.Errorf("McpServerRef slug = %q, want %q", agent.McpServerUsages[0].McpServerRef.Slug, "github")
	}
}

func TestAddMcpServerUsage_Chaining(t *testing.T) {
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

	// Chain multiple AddMcpServerUsage calls
	agent.
		AddMcpServerUsage(mcpserverref.Platform("github"), "create_pr").
		AddMcpServerUsage(mcpserverref.Platform("gitlab"))

	if len(agent.McpServerUsages) != 2 {
		t.Errorf("McpServerUsages count = %d, want 2", len(agent.McpServerUsages))
	}
}

func TestUseMCPServer_Chaining(t *testing.T) {
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

	// Chain UseMCPServer calls
	agent.
		UseMCPServer("github", "create_pr").
		UseMCPServer("gitlab").
		UseMCPServer("slack", "send_message")

	if len(agent.McpServerUsages) != 3 {
		t.Errorf("McpServerUsages count = %d, want 3", len(agent.McpServerUsages))
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
	ctx := &mockBuilderCtx{}

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

	githubToken, err := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
		IsSecret: true,
	})
	if err != nil {
		t.Fatalf("Failed to create environment variable: %v", err)
	}

	// Add environment variable using builder method
	agent.AddEnvironmentVariable(*githubToken)

	if len(agent.EnvironmentVariables) != 1 {
		t.Errorf("EnvironmentVariables count = %d, want 1", len(agent.EnvironmentVariables))
	}
	if agent.EnvironmentVariables[0].Name != "GITHUB_TOKEN" {
		t.Errorf("EnvironmentVariable name = %q, want %q", agent.EnvironmentVariables[0].Name, "GITHUB_TOKEN")
	}
}

func TestAddEnvironmentVariables(t *testing.T) {
	ctx := &mockBuilderCtx{}

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

	githubToken, _ := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
		IsSecret: true,
	})

	awsRegion, _ := environment.New(ctx, "AWS_REGION", &environment.VariableArgs{
		DefaultValue: "us-east-1",
	})

	// Add multiple environment variables using builder method
	agent.AddEnvironmentVariables(*githubToken, *awsRegion)

	if len(agent.EnvironmentVariables) != 2 {
		t.Errorf("EnvironmentVariables count = %d, want 2", len(agent.EnvironmentVariables))
	}
}

func TestAddEnvironmentVariable_Chaining(t *testing.T) {
	ctx := &mockBuilderCtx{}

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

	githubToken, _ := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
		IsSecret: true,
	})

	awsRegion, _ := environment.New(ctx, "AWS_REGION", &environment.VariableArgs{
		DefaultValue: "us-east-1",
	})

	// Chain multiple AddEnvironmentVariable calls
	agent.
		AddEnvironmentVariable(*githubToken).
		AddEnvironmentVariable(*awsRegion)

	if len(agent.EnvironmentVariables) != 2 {
		t.Errorf("EnvironmentVariables count = %d, want 2", len(agent.EnvironmentVariables))
	}
}

func TestBuilder_ComplexChaining(t *testing.T) {
	ctx := &mockBuilderCtx{}

	helper, _ := subagent.New("helper", &subagent.Args{
		Instructions: "Helper instructions",
	})
	helper.GrantMcpAccess("github", "search_code")

	githubToken, _ := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
		IsSecret: true,
	})

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
		AddMcpServerUsage(mcpserverref.Platform("github"), "create_pr", "search_code").
		AddSubAgent(helper).
		AddEnvironmentVariable(*githubToken)

	// Verify all were added
	if len(agent.SkillRefs) != 2 {
		t.Errorf("SkillRefs count = %d, want 2", len(agent.SkillRefs))
	}
	if len(agent.McpServerUsages) != 1 {
		t.Errorf("McpServerUsages count = %d, want 1", len(agent.McpServerUsages))
	}
	if len(agent.SubAgents) != 1 {
		t.Errorf("SubAgents count = %d, want 1", len(agent.SubAgents))
	}
	if len(agent.EnvironmentVariables) != 1 {
		t.Errorf("EnvironmentVariables count = %d, want 1", len(agent.EnvironmentVariables))
	}
}

func TestAddMcpServerUsage_MultipleScopes(t *testing.T) {
	agent, err := New(
		nil,
		"test-agent",
		&AgentArgs{
			Instructions: "Test instructions for agent",
		},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add MCP servers from different scopes
	agent.
		AddMcpServerUsage(mcpserverref.Platform("github")).
		AddMcpServerUsage(mcpserverref.Organization("acme-corp", "internal-tools")).
		AddMcpServerUsage(mcpserverref.Personal("my-dev-tools"))

	if len(agent.McpServerUsages) != 3 {
		t.Errorf("McpServerUsages count = %d, want 3", len(agent.McpServerUsages))
	}

	// Verify scopes
	if agent.McpServerUsages[0].McpServerRef.Slug != "github" {
		t.Errorf("First usage slug = %q, want github", agent.McpServerUsages[0].McpServerRef.Slug)
	}
	if agent.McpServerUsages[1].McpServerRef.Org != "acme-corp" {
		t.Errorf("Second usage org = %q, want acme-corp", agent.McpServerUsages[1].McpServerRef.Org)
	}
}
