package agent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/subagent"
)

// mustSubAgent creates a sub-agent or panics on error.
// This is a test helper for concise test cases.
func mustSubAgent(name string, args *subagent.Args) subagent.SubAgent {
	sub, err := subagent.New(name, args)
	if err != nil {
		panic("failed to create sub-agent: " + err.Error())
	}
	return sub
}

func TestAgentWithSubAgent(t *testing.T) {
	helper := mustSubAgent("helper", &subagent.Args{
		Instructions: "Helper instructions",
	})

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent instructions",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add sub-agent using builder method
	agent.AddSubAgent(helper)

	if len(agent.SubAgents) != 1 {
		t.Errorf("len(SubAgents) = %d, want 1", len(agent.SubAgents))
	}
	if agent.SubAgents[0].Name() != "helper" {
		t.Errorf("SubAgents[0].Name() = %q, want %q", agent.SubAgents[0].Name(), "helper")
	}
}

func TestAgentWithMultipleSubAgents(t *testing.T) {
	analyzer := mustSubAgent("analyzer", &subagent.Args{
		Instructions: "Analyze code for bugs",
	})

	reviewer := mustSubAgent("reviewer", &subagent.Args{
		Instructions: "Review code for style",
	})

	security := mustSubAgent("security", &subagent.Args{
		Instructions: "Check for security issues",
	})

	agent, err := New(nil, "orchestrator", &AgentArgs{
		Instructions: "Orchestrate multiple sub-agents",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add all sub-agents using builder method
	agent.AddSubAgents(analyzer, reviewer, security)

	if len(agent.SubAgents) != 3 {
		t.Errorf("len(SubAgents) = %d, want 3", len(agent.SubAgents))
	}
	if agent.SubAgents[0].Name() != "analyzer" {
		t.Errorf("SubAgents[0].Name() = %q, want %q", agent.SubAgents[0].Name(), "analyzer")
	}
	if agent.SubAgents[1].Name() != "reviewer" {
		t.Errorf("SubAgents[1].Name() = %q, want %q", agent.SubAgents[1].Name(), "reviewer")
	}
	if agent.SubAgents[2].Name() != "security" {
		t.Errorf("SubAgents[2].Name() = %q, want %q", agent.SubAgents[2].Name(), "security")
	}
}

func TestAgentWithSubAgentUsingMCPAccess(t *testing.T) {
	// Create sub-agent with MCP access grants
	githubHelper := mustSubAgent("github-helper", &subagent.Args{
		Instructions: "Help with GitHub operations",
	})
	githubHelper.GrantMcpAccess("github")

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent with sub-agent that uses MCP servers",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add MCP server usage to parent using new smart parsing API
	agent.UseMCP("stigmer/github")
	agent.AddSubAgent(githubHelper)

	if len(agent.McpServerUsages()) != 1 {
		t.Errorf("len(McpServerUsages) = %d, want 1", len(agent.McpServerUsages()))
	}
	if len(agent.SubAgents) != 1 {
		t.Errorf("len(SubAgents) = %d, want 1", len(agent.SubAgents))
	}

	// Verify sub-agent has MCP access
	mcpAccess := agent.SubAgents[0].McpAccess()
	if len(mcpAccess) != 1 {
		t.Errorf("len(SubAgents[0].McpAccess()) = %d, want 1", len(mcpAccess))
	}
	if mcpAccess[0].McpServer != "github" {
		t.Errorf("McpAccess[0].McpServer = %q, want %q", mcpAccess[0].McpServer, "github")
	}
}

func TestAgentWithSubAgentUsingSkills(t *testing.T) {
	skilledHelper := mustSubAgent("skilled-helper", &subagent.Args{
		Instructions: "Use coding knowledge",
	})
	skilledHelper.AddSkills(
		"stigmer/coding-best-practices",
		"my-org/internal-apis",
	)

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

	if len(agent.SubAgents) != 1 {
		t.Errorf("len(SubAgents) = %d, want 1", len(agent.SubAgents))
	}
	if len(agent.SkillRefs()) != 1 {
		t.Errorf("len(SkillRefs) = %d, want 1", len(agent.SkillRefs()))
	}

	// Verify sub-agent has skills
	subSkills := agent.SubAgents[0].SkillRefs()
	if len(subSkills) != 2 {
		t.Errorf("len(SubAgents[0].SkillRefs()) = %d, want 2", len(subSkills))
	}
}

func TestAgentWithSubAgentUsingRestrictedTools(t *testing.T) {
	// Create sub-agent with restricted tool access
	selectiveHelper := mustSubAgent("selective-helper", &subagent.Args{
		Instructions: "Use specific GitHub tools",
	})
	// Grant access with restricted tools (subset of parent's tools)
	selectiveHelper.GrantMcpAccess("github", "create_issue", "list_repos")

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent with selective sub-agent",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Parent has access to all GitHub tools using new API
	agent.UseMCP("stigmer/github", "create_issue", "list_repos", "create_pr", "search_code")
	agent.AddSubAgent(selectiveHelper)

	if len(agent.SubAgents) != 1 {
		t.Errorf("len(SubAgents) = %d, want 1", len(agent.SubAgents))
	}

	// Verify sub-agent has restricted access
	mcpAccess := agent.SubAgents[0].McpAccess()
	if len(mcpAccess) != 1 {
		t.Errorf("len(McpAccess()) = %d, want 1", len(mcpAccess))
	}
	if mcpAccess[0].McpServer != "github" {
		t.Errorf("McpAccess[0].McpServer = %q, want %q", mcpAccess[0].McpServer, "github")
	}
	if len(mcpAccess[0].EnabledTools) != 2 {
		t.Errorf("len(EnabledTools) = %d, want 2", len(mcpAccess[0].EnabledTools))
	}
}

func TestAgentWithSubAgentMultipleMCPAccess(t *testing.T) {
	// Create sub-agent with access to multiple MCP servers
	multiHelper := mustSubAgent("multi-helper", &subagent.Args{
		Instructions: "Use multiple platforms",
	})
	multiHelper.GrantMcpAccess("github", "create_pr").
		GrantMcpAccess("gitlab").
		GrantMcpAccess("slack", "send_message")

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
	mcpAccess := agent.SubAgents[0].McpAccess()
	if len(mcpAccess) != 3 {
		t.Errorf("len(McpAccess()) = %d, want 3", len(mcpAccess))
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
