package agent

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/sdk/go/commons/ref"
)

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

	if len(agent.McpServerUsages()) != 1 {
		t.Errorf("len(McpServerUsages) = %d, want 1", len(agent.McpServerUsages()))
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
	if len(agent.SkillRefs()) != 1 {
		t.Errorf("len(SkillRefs) = %d, want 1", len(agent.SkillRefs()))
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
