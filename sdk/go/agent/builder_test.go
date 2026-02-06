package agent

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/sdk/go/commons/ref"
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

	// Start with no skill refs
	if len(agent.Args.SkillRefs) != 0 {
		t.Errorf("Initial SkillRefs count = %d, want 0", len(agent.Args.SkillRefs))
	}

	// Add skill ref using new smart parsing API
	agent.AddSkill("stigmer/coding-best-practices")

	if len(agent.Args.SkillRefs) != 1 {
		t.Errorf("SkillRefs count = %d, want 1", len(agent.Args.SkillRefs))
	}
	if agent.Args.SkillRefs[0].Slug != "coding-best-practices" {
		t.Errorf("SkillRef slug = %q, want %q", agent.Args.SkillRefs[0].Slug, "coding-best-practices")
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

	// Add multiple skill refs using new API
	agent.AddSkills(
		"stigmer/coding-best-practices",
		"stigmer/security-analysis",
		"my-org/internal-docs",
	)

	if len(agent.Args.SkillRefs) != 3 {
		t.Errorf("SkillRefs count = %d, want 3", len(agent.Args.SkillRefs))
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

	// Chain multiple AddSkill calls
	agent.
		AddSkill("stigmer/skill1").
		AddSkill("stigmer/skill2").
		AddSkill("stigmer/skill3")

	if len(agent.Args.SkillRefs) != 3 {
		t.Errorf("SkillRefs count = %d, want 3", len(agent.Args.SkillRefs))
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

	// Add MCP server usage using new smart parsing API
	agent.UseMCP("stigmer/github")

	if len(agent.Args.McpServerUsages) != 1 {
		t.Errorf("McpServerUsages count = %d, want 1", len(agent.Args.McpServerUsages))
	}
	if agent.Args.McpServerUsages[0].McpServerRef.Slug != "github" {
		t.Errorf("McpServerRef slug = %q, want %q", agent.Args.McpServerUsages[0].McpServerRef.Slug, "github")
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

	// Add MCP server usage with enabled tools using new API
	agent.UseMCP("stigmer/github", "create_issue", "list_repos", "create_pr")

	if len(agent.Args.McpServerUsages) != 1 {
		t.Errorf("McpServerUsages count = %d, want 1", len(agent.Args.McpServerUsages))
	}
	if len(agent.Args.McpServerUsages[0].EnabledTools) != 3 {
		t.Errorf("EnabledTools count = %d, want 3", len(agent.Args.McpServerUsages[0].EnabledTools))
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

	// Use convenience method with org/slug format
	agent.UseMCP("stigmer/github", "create_issue")

	if len(agent.Args.McpServerUsages) != 1 {
		t.Errorf("McpServerUsages count = %d, want 1", len(agent.Args.McpServerUsages))
	}
	if agent.Args.McpServerUsages[0].McpServerRef.Slug != "github" {
		t.Errorf("McpServerRef slug = %q, want %q", agent.Args.McpServerUsages[0].McpServerRef.Slug, "github")
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

	// Chain multiple UseMCP calls
	agent.
		UseMCP("stigmer/github", "create_pr").
		UseMCP("stigmer/gitlab")

	if len(agent.Args.McpServerUsages) != 2 {
		t.Errorf("McpServerUsages count = %d, want 2", len(agent.Args.McpServerUsages))
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

	// Chain UseMCP calls
	agent.
		UseMCP("stigmer/github", "create_pr").
		UseMCP("stigmer/gitlab").
		UseMCP("stigmer/slack", "send_message")

	if len(agent.Args.McpServerUsages) != 3 {
		t.Errorf("McpServerUsages count = %d, want 3", len(agent.Args.McpServerUsages))
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

	helper := NewSubAgent("helper", "Helper instructions")

	// Add sub-agent using builder method
	agent.AddSubAgent(helper)

	if len(agent.Args.SubAgents) != 1 {
		t.Errorf("Args.SubAgents count = %d, want 1", len(agent.Args.SubAgents))
	}
	if agent.Args.SubAgents[0].Name != "helper" {
		t.Errorf("SubAgent name = %q, want %q", agent.Args.SubAgents[0].Name, "helper")
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

	helper1 := NewSubAgent("helper1", "Helper 1 instructions")
	helper2 := NewSubAgent("helper2", "Helper 2 instructions")

	// Add multiple sub-agents using builder method
	agent.AddSubAgents(helper1, helper2)

	if len(agent.Args.SubAgents) != 2 {
		t.Errorf("Args.SubAgents count = %d, want 2", len(agent.Args.SubAgents))
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

	helper1 := NewSubAgent("helper1", "Helper 1 instructions")
	helper2 := NewSubAgent("helper2", "Helper 2 instructions")

	// Chain multiple AddSubAgent calls
	agent.
		AddSubAgent(helper1).
		AddSubAgent(helper2)

	if len(agent.Args.SubAgents) != 2 {
		t.Errorf("Args.SubAgents count = %d, want 2", len(agent.Args.SubAgents))
	}
}

func TestRequireSecret_Builder(t *testing.T) {
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

	// Add required secret using new convenience method
	agent.RequireSecret("GITHUB_TOKEN", "GitHub API token")

	if agent.Args.EnvSpec == nil {
		t.Fatal("Args.EnvSpec is nil")
	}
	if len(agent.Args.EnvSpec.Data) != 1 {
		t.Errorf("EnvSpec.Data count = %d, want 1", len(agent.Args.EnvSpec.Data))
	}
	if _, ok := agent.Args.EnvSpec.Data["GITHUB_TOKEN"]; !ok {
		t.Error("GITHUB_TOKEN not found in EnvSpec.Data")
	}
}

func TestRequireConfig_Builder(t *testing.T) {
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

	// Add required config with default using new convenience method
	agent.RequireConfig("AWS_REGION", "us-east-1", "AWS region")

	if agent.Args.EnvSpec == nil {
		t.Fatal("Args.EnvSpec is nil")
	}
	if len(agent.Args.EnvSpec.Data) != 1 {
		t.Errorf("EnvSpec.Data count = %d, want 1", len(agent.Args.EnvSpec.Data))
	}
	val, ok := agent.Args.EnvSpec.Data["AWS_REGION"]
	if !ok {
		t.Fatal("AWS_REGION not found in EnvSpec.Data")
	}
	if val.Value != "us-east-1" {
		t.Errorf("AWS_REGION.Value = %q, want %q", val.Value, "us-east-1")
	}
}

func TestRequireEnvVar_Chaining(t *testing.T) {
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

	// Chain multiple RequireSecret/RequireConfig calls
	agent.
		RequireSecret("GITHUB_TOKEN", "GitHub API token").
		RequireConfig("AWS_REGION", "us-east-1", "AWS region")

	if len(agent.Args.EnvSpec.Data) != 2 {
		t.Errorf("EnvSpec.Data count = %d, want 2", len(agent.Args.EnvSpec.Data))
	}
}

func TestBuilder_ComplexChaining(t *testing.T) {
	helper := BuildSubAgent("helper", "Helper instructions").
		GrantMcpAccess("github", "search_code").
		Build()

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

	// Chain all builder methods using new API
	agent.
		AddSkill("stigmer/coding-best-practices").
		AddSkill("stigmer/security-analysis").
		UseMCP("stigmer/github", "create_pr", "search_code").
		AddSubAgent(helper).
		RequireSecret("GITHUB_TOKEN", "GitHub API token")

	// Verify all were added
	if len(agent.Args.SkillRefs) != 2 {
		t.Errorf("SkillRefs count = %d, want 2", len(agent.Args.SkillRefs))
	}
	if len(agent.Args.McpServerUsages) != 1 {
		t.Errorf("McpServerUsages count = %d, want 1", len(agent.Args.McpServerUsages))
	}
	if len(agent.Args.SubAgents) != 1 {
		t.Errorf("Args.SubAgents count = %d, want 1", len(agent.Args.SubAgents))
	}
	if len(agent.Args.EnvSpec.Data) != 1 {
		t.Errorf("EnvSpec.Data count = %d, want 1", len(agent.Args.EnvSpec.Data))
	}
}

func TestAddMcpServerUsage_MultipleOrgs(t *testing.T) {
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

	// Add MCP servers from different organizations using new API
	agent.
		UseMCP("stigmer/github").
		UseMCP("acme-corp/internal-tools")

	if len(agent.Args.McpServerUsages) != 2 {
		t.Errorf("McpServerUsages count = %d, want 2", len(agent.Args.McpServerUsages))
	}

	// Verify orgs
	if agent.Args.McpServerUsages[0].McpServerRef.Slug != "github" {
		t.Errorf("First usage slug = %q, want github", agent.Args.McpServerUsages[0].McpServerRef.Slug)
	}
	if agent.Args.McpServerUsages[1].McpServerRef.Org != "acme-corp" {
		t.Errorf("Second usage org = %q, want acme-corp", agent.Args.McpServerUsages[1].McpServerRef.Org)
	}
}

func TestSlugOnlyMcpServer(t *testing.T) {
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

	// Set agent org for slug-only references
	agent.Org = "my-org"

	// Add MCP server using slug-only (should use agent.Org)
	agent.UseMCP("my-dev-tools")

	if len(agent.Args.McpServerUsages) != 1 {
		t.Errorf("McpServerUsages count = %d, want 1", len(agent.Args.McpServerUsages))
	}

	if agent.Args.McpServerUsages[0].McpServerRef.Org != "my-org" {
		t.Errorf("McpServerRef org = %q, want my-org (from agent.Org)", agent.Args.McpServerUsages[0].McpServerRef.Org)
	}
}

// =============================================================================
// Skill Tests (from agent_skills_test.go)
// =============================================================================

func TestAgentWithSingleSkill(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Add skill using new smart parsing API
	agent.AddSkill("stigmer/coding-best-practices")

	if len(agent.Args.SkillRefs) != 1 {
		t.Errorf("New() skills count = %d, want 1", len(agent.Args.SkillRefs))
	}

	if agent.Args.SkillRefs[0].Slug != "coding-best-practices" {
		t.Errorf("New() skill[0].Slug = %v, want coding-best-practices", agent.Args.SkillRefs[0].Slug)
	}

	if agent.Args.SkillRefs[0].Org != "stigmer" {
		t.Errorf("New() skill[0].Org = %v, want stigmer", agent.Args.SkillRefs[0].Org)
	}
}

func TestAgentWithMultipleSkills(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Add skills using new smart parsing API
	agent.AddSkills(
		"stigmer/coding-best-practices",
		"stigmer/security-analysis",
		"my-org/internal-docs",
	)

	if len(agent.Args.SkillRefs) != 3 {
		t.Errorf("New() skills count = %d, want 3", len(agent.Args.SkillRefs))
	}

	// Verify all skills are present
	expectedSlugs := []string{"coding-best-practices", "security-analysis", "internal-docs"}
	for i, slug := range expectedSlugs {
		if agent.Args.SkillRefs[i].Slug != slug {
			t.Errorf("New() skill[%d].Slug = %v, want %v", i, agent.Args.SkillRefs[i].Slug, slug)
		}
	}

	// Verify org skill has correct org
	if agent.Args.SkillRefs[2].Org != "my-org" {
		t.Errorf("New() skill[2].Org = %v, want my-org", agent.Args.SkillRefs[2].Org)
	}
}

func TestAgentWithSlugOnlySkills(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Set agent org for slug-only references
	agent.Org = "my-org"

	// Add skill using slug-only reference (should use agent.Org)
	agent.AddSkill("internal-docs")

	if len(agent.Args.SkillRefs) != 1 {
		t.Errorf("New() skills count = %d, want 1", len(agent.Args.SkillRefs))
	}

	if agent.Args.SkillRefs[0].Slug != "internal-docs" {
		t.Errorf("New() skill[0].Slug = %v, want internal-docs", agent.Args.SkillRefs[0].Slug)
	}

	if agent.Args.SkillRefs[0].Org != "my-org" {
		t.Errorf("New() skill[0].Org = %v, want my-org (from agent.Org)", agent.Args.SkillRefs[0].Org)
	}
}

func TestAgentWithVersionedSkills(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Add skill with version in string
	agent.AddSkill("stigmer/coding-best-practices@v2.0")

	if len(agent.Args.SkillRefs) != 1 {
		t.Errorf("New() skills count = %d, want 1", len(agent.Args.SkillRefs))
	}

	if agent.Args.SkillRefs[0].Version != "v2.0" {
		t.Errorf("New() skill[0].Version = %v, want v2.0", agent.Args.SkillRefs[0].Version)
	}
}

// =============================================================================
// SubAgent Tests (from agent_subagents_test.go)
// =============================================================================

func TestAgentWithSubAgent(t *testing.T) {
	helper := NewSubAgent("helper", "Helper instructions")

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent instructions",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add sub-agent using builder method
	agent.AddSubAgent(helper)

	if len(agent.Args.SubAgents) != 1 {
		t.Errorf("len(Args.SubAgents) = %d, want 1", len(agent.Args.SubAgents))
	}
	if agent.Args.SubAgents[0].Name != "helper" {
		t.Errorf("Args.SubAgents[0].Name = %q, want %q", agent.Args.SubAgents[0].Name, "helper")
	}
}

func TestAgentWithMultipleSubAgents(t *testing.T) {
	analyzer := NewSubAgent("analyzer", "Analyze code for bugs")
	reviewer := NewSubAgent("reviewer", "Review code for style")
	security := NewSubAgent("security", "Check for security issues")

	agent, err := New(nil, "orchestrator", &AgentArgs{
		Instructions: "Orchestrate multiple sub-agents",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add all sub-agents using builder method
	agent.AddSubAgents(analyzer, reviewer, security)

	if len(agent.Args.SubAgents) != 3 {
		t.Errorf("len(Args.SubAgents) = %d, want 3", len(agent.Args.SubAgents))
	}
	if agent.Args.SubAgents[0].Name != "analyzer" {
		t.Errorf("Args.SubAgents[0].Name = %q, want %q", agent.Args.SubAgents[0].Name, "analyzer")
	}
	if agent.Args.SubAgents[1].Name != "reviewer" {
		t.Errorf("Args.SubAgents[1].Name = %q, want %q", agent.Args.SubAgents[1].Name, "reviewer")
	}
	if agent.Args.SubAgents[2].Name != "security" {
		t.Errorf("Args.SubAgents[2].Name = %q, want %q", agent.Args.SubAgents[2].Name, "security")
	}
}

func TestAgentWithSubAgentUsingMCPAccess(t *testing.T) {
	// Create sub-agent with MCP access grants using builder
	githubHelper := BuildSubAgent("github-helper", "Help with GitHub operations").
		GrantMcpAccess("github").
		Build()

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent with sub-agent that uses MCP servers",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add MCP server usage to parent using smart parsing API
	agent.UseMCP("stigmer/github")
	agent.AddSubAgent(githubHelper)

	if len(agent.Args.McpServerUsages) != 1 {
		t.Errorf("len(McpServerUsages) = %d, want 1", len(agent.Args.McpServerUsages))
	}
	if len(agent.Args.SubAgents) != 1 {
		t.Errorf("len(Args.SubAgents) = %d, want 1", len(agent.Args.SubAgents))
	}

	// Verify sub-agent has MCP access
	mcpAccess := agent.Args.SubAgents[0].McpAccess
	if len(mcpAccess) != 1 {
		t.Errorf("len(Args.SubAgents[0].McpAccess) = %d, want 1", len(mcpAccess))
	}
	if mcpAccess[0].McpServer != "github" {
		t.Errorf("McpAccess[0].McpServer = %q, want %q", mcpAccess[0].McpServer, "github")
	}
}

func TestAgentWithSubAgentUsingSkills(t *testing.T) {
	// Create sub-agent with skill refs using builder
	skilledHelper := BuildSubAgent("skilled-helper", "Use coding knowledge").
		AddSkillRef(ref.Skill("stigmer", "coding-best-practices")).
		AddSkillRef(ref.Skill("my-org", "internal-apis")).
		Build()

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent with sub-agent that uses skills",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Also add skills to parent agent using new API
	agent.AddSkill("stigmer/parent-skill")

	// Add sub-agent using builder method
	agent.AddSubAgent(skilledHelper)

	if len(agent.Args.SubAgents) != 1 {
		t.Errorf("len(Args.SubAgents) = %d, want 1", len(agent.Args.SubAgents))
	}
	if len(agent.Args.SkillRefs) != 1 {
		t.Errorf("len(SkillRefs) = %d, want 1", len(agent.Args.SkillRefs))
	}

	// Verify sub-agent has skills
	subSkills := agent.Args.SubAgents[0].SkillRefs
	if len(subSkills) != 2 {
		t.Errorf("len(Args.SubAgents[0].SkillRefs) = %d, want 2", len(subSkills))
	}
}

func TestAgentWithSubAgentUsingRestrictedTools(t *testing.T) {
	// Create sub-agent with restricted tool access using builder
	selectiveHelper := BuildSubAgent("selective-helper", "Use specific GitHub tools").
		GrantMcpAccess("github", "create_issue", "list_repos").
		Build()

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent with selective sub-agent",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Parent has access to all GitHub tools using new API
	agent.UseMCP("stigmer/github", "create_issue", "list_repos", "create_pr", "search_code")
	agent.AddSubAgent(selectiveHelper)

	if len(agent.Args.SubAgents) != 1 {
		t.Errorf("len(Args.SubAgents) = %d, want 1", len(agent.Args.SubAgents))
	}

	// Verify sub-agent has restricted access
	mcpAccess := agent.Args.SubAgents[0].McpAccess
	if len(mcpAccess) != 1 {
		t.Errorf("len(McpAccess) = %d, want 1", len(mcpAccess))
	}
	if mcpAccess[0].McpServer != "github" {
		t.Errorf("McpAccess[0].McpServer = %q, want %q", mcpAccess[0].McpServer, "github")
	}
	if len(mcpAccess[0].EnabledTools) != 2 {
		t.Errorf("len(EnabledTools) = %d, want 2", len(mcpAccess[0].EnabledTools))
	}
}

func TestAgentWithSubAgentMultipleMCPAccess(t *testing.T) {
	// Create sub-agent with access to multiple MCP servers using builder
	multiHelper := BuildSubAgent("multi-helper", "Use multiple platforms").
		GrantMcpAccess("github", "create_pr").
		GrantMcpAccess("gitlab").
		GrantMcpAccess("slack", "send_message").
		Build()

	agent, err := New(nil, "orchestrator", &AgentArgs{
		Instructions: "Orchestrate multiple platforms",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Parent has access to all these servers using new API
	agent.UseMCP("stigmer/github", "create_pr", "search_code")
	agent.UseMCP("stigmer/gitlab")
	agent.UseMCP("stigmer/slack", "send_message", "list_channels")
	agent.AddSubAgent(multiHelper)

	// Verify sub-agent has all MCP access grants
	mcpAccess := agent.Args.SubAgents[0].McpAccess
	if len(mcpAccess) != 3 {
		t.Errorf("len(McpAccess) = %d, want 3", len(mcpAccess))
	}

	// Verify each access grant
	servers := make(map[string]int)
	for _, access := range mcpAccess {
		servers[access.McpServer] = len(access.EnabledTools)
	}

	if servers["github"] != 1 {
		t.Errorf("github tools count = %d, want 1", servers["github"])
	}
	if servers["gitlab"] != 0 {
		t.Errorf("gitlab tools count = %d, want 0 (all tools)", servers["gitlab"])
	}
	if servers["slack"] != 1 {
		t.Errorf("slack tools count = %d, want 1", servers["slack"])
	}
}

func TestSubAgentBuilder(t *testing.T) {
	// Test the SubAgentBuilder fluent API
	sub := BuildSubAgent("test-agent", "Test instructions").
		Description("Test description").
		GrantMcpAccess("github", "search_code").
		GrantMcpAccess("aws").
		AddSkillRef(ref.Skill("stigmer", "coding")).
		Build()

	if sub.Name != "test-agent" {
		t.Errorf("Name = %q, want %q", sub.Name, "test-agent")
	}
	if sub.Instructions != "Test instructions" {
		t.Errorf("Instructions = %q, want %q", sub.Instructions, "Test instructions")
	}
	if sub.Description != "Test description" {
		t.Errorf("Description = %q, want %q", sub.Description, "Test description")
	}
	if len(sub.McpAccess) != 2 {
		t.Errorf("len(McpAccess) = %d, want 2", len(sub.McpAccess))
	}
	if len(sub.SkillRefs) != 1 {
		t.Errorf("len(SkillRefs) = %d, want 1", len(sub.SkillRefs))
	}
}

func TestNewSubAgentHelpers(t *testing.T) {
	// Test NewSubAgent helper
	sub1 := NewSubAgent("helper", "Help with tasks")
	if sub1.Name != "helper" {
		t.Errorf("Name = %q, want %q", sub1.Name, "helper")
	}
	if sub1.Instructions != "Help with tasks" {
		t.Errorf("Instructions = %q, want %q", sub1.Instructions, "Help with tasks")
	}

	// Test NewSubAgentWithDescription helper
	sub2 := NewSubAgentWithDescription("helper2", "Instructions here", "A helpful sub-agent")
	if sub2.Name != "helper2" {
		t.Errorf("Name = %q, want %q", sub2.Name, "helper2")
	}
	if sub2.Description != "A helpful sub-agent" {
		t.Errorf("Description = %q, want %q", sub2.Description, "A helpful sub-agent")
	}
}

func TestAgentWithDirectProtoSubAgent(t *testing.T) {
	// Test that we can use proto SubAgent directly
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test agent",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add SubAgent directly using proto type
	agent.AddSubAgent(&agentv1.SubAgent{
		Name:         "direct-sub",
		Instructions: "Direct proto sub-agent",
		Description:  "Created directly with proto type",
		McpAccess: []*agentv1.McpAccess{
			{McpServer: "github", EnabledTools: []string{"search_code"}},
		},
	})

	if len(agent.Args.SubAgents) != 1 {
		t.Errorf("len(Args.SubAgents) = %d, want 1", len(agent.Args.SubAgents))
	}
	if agent.Args.SubAgents[0].Name != "direct-sub" {
		t.Errorf("Name = %q, want %q", agent.Args.SubAgents[0].Name, "direct-sub")
	}
}

// =============================================================================
// Environment Variable Tests (from agent_environment_test.go)
// =============================================================================

func TestAgentRequireSecret(t *testing.T) {
	agent, err := New(nil, "github-bot", &AgentArgs{
		Instructions: "Manage GitHub repositories",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add required secret using new convenience method
	agent.RequireSecret("GITHUB_TOKEN", "GitHub API token")

	if agent.Args.EnvSpec == nil {
		t.Fatal("Args.EnvSpec is nil")
	}

	if len(agent.Args.EnvSpec.Data) != 1 {
		t.Errorf("len(Args.EnvSpec.Data) = %d, want 1", len(agent.Args.EnvSpec.Data))
	}

	val, ok := agent.Args.EnvSpec.Data["GITHUB_TOKEN"]
	if !ok {
		t.Fatal("GITHUB_TOKEN not found in Args.EnvSpec.Data")
	}

	if !val.IsSecret {
		t.Error("GITHUB_TOKEN.IsSecret = false, want true")
	}

	if val.Description != "GitHub API token" {
		t.Errorf("GITHUB_TOKEN.Description = %q, want %q", val.Description, "GitHub API token")
	}

	if val.Value != "" {
		t.Errorf("GITHUB_TOKEN.Value = %q, want empty (required secret)", val.Value)
	}
}

func TestAgentRequireConfig(t *testing.T) {
	agent, err := New(nil, "cloud-deployer", &AgentArgs{
		Instructions: "Deploy applications to cloud",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add required config with default value
	agent.RequireConfig("AWS_REGION", "us-east-1", "AWS region for deployments")

	if agent.Args.EnvSpec == nil {
		t.Fatal("Args.EnvSpec is nil")
	}

	if len(agent.Args.EnvSpec.Data) != 1 {
		t.Errorf("len(Args.EnvSpec.Data) = %d, want 1", len(agent.Args.EnvSpec.Data))
	}

	val, ok := agent.Args.EnvSpec.Data["AWS_REGION"]
	if !ok {
		t.Fatal("AWS_REGION not found in Args.EnvSpec.Data")
	}

	if val.IsSecret {
		t.Error("AWS_REGION.IsSecret = true, want false")
	}

	if val.Value != "us-east-1" {
		t.Errorf("AWS_REGION.Value = %q, want %q", val.Value, "us-east-1")
	}

	if val.Description != "AWS region for deployments" {
		t.Errorf("AWS_REGION.Description = %q, want %q", val.Description, "AWS region for deployments")
	}
}

func TestAgentRequireMultipleEnvVars(t *testing.T) {
	agent, err := New(nil, "cloud-deployer", &AgentArgs{
		Instructions: "Deploy applications to cloud",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Chain multiple RequireSecret and RequireConfig calls
	agent.
		RequireSecret("GITHUB_TOKEN", "GitHub API token").
		RequireSecret("AWS_SECRET_KEY", "AWS secret access key").
		RequireConfig("AWS_REGION", "us-east-1", "AWS region").
		RequireConfig("LOG_LEVEL", "info", "Logging verbosity")

	if agent.Args.EnvSpec == nil {
		t.Fatal("Args.EnvSpec is nil")
	}

	if len(agent.Args.EnvSpec.Data) != 4 {
		t.Errorf("len(Args.EnvSpec.Data) = %d, want 4", len(agent.Args.EnvSpec.Data))
	}

	// Verify each variable
	testCases := []struct {
		name       string
		wantSecret bool
		wantValue  string
		wantDesc   string
	}{
		{"GITHUB_TOKEN", true, "", "GitHub API token"},
		{"AWS_SECRET_KEY", true, "", "AWS secret access key"},
		{"AWS_REGION", false, "us-east-1", "AWS region"},
		{"LOG_LEVEL", false, "info", "Logging verbosity"},
	}

	for _, tc := range testCases {
		val, ok := agent.Args.EnvSpec.Data[tc.name]
		if !ok {
			t.Errorf("%s not found in Args.EnvSpec.Data", tc.name)
			continue
		}

		if val.IsSecret != tc.wantSecret {
			t.Errorf("%s.IsSecret = %v, want %v", tc.name, val.IsSecret, tc.wantSecret)
		}

		if val.Value != tc.wantValue {
			t.Errorf("%s.Value = %q, want %q", tc.name, val.Value, tc.wantValue)
		}

		if val.Description != tc.wantDesc {
			t.Errorf("%s.Description = %q, want %q", tc.name, val.Description, tc.wantDesc)
		}
	}
}

func TestAgentRequireEnvVar_ThreadSafety(t *testing.T) {
	agent, err := New(nil, "concurrent-agent", &AgentArgs{
		Instructions: "Test concurrent env var additions",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Run concurrent RequireSecret calls
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func(i int) {
			name := "VAR_" + string(rune('A'+i))
			agent.RequireSecret(name, "description")
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Should have 10 variables
	if len(agent.Args.EnvSpec.Data) != 10 {
		t.Errorf("len(Args.EnvSpec.Data) = %d, want 10", len(agent.Args.EnvSpec.Data))
	}
}
