package agent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/gen/types"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skillref"
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

func TestAgentWithSubAgentUsingMCPServers(t *testing.T) {
	github, err := mcpserver.Stdio(
		mcpserver.WithName("github"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
	)
	if err != nil {
		t.Fatalf("Failed to create MCP server: %v", err)
	}

	githubHelper := mustSubAgent("github-helper", &subagent.Args{
		Instructions: "Help with GitHub operations",
		McpServers:   []string{"github"},
	})

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent with sub-agent that uses MCP servers",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add MCP server and sub-agent using builder methods
	agent.AddMCPServer(github)
	agent.AddSubAgent(githubHelper)

	if len(agent.MCPServers) != 1 {
		t.Errorf("len(MCPServers) = %d, want 1", len(agent.MCPServers))
	}
	if len(agent.SubAgents) != 1 {
		t.Errorf("len(SubAgents) = %d, want 1", len(agent.SubAgents))
	}
}

func TestAgentWithSubAgentUsingSkills(t *testing.T) {
	skilledHelper := mustSubAgent("skilled-helper", &subagent.Args{
		Instructions: "Use coding knowledge",
		SkillRefs: []*types.ApiResourceReference{
			{Slug: "coding-best-practices", Scope: "platform"},
			{Slug: "internal-apis", Scope: "organization", Org: "my-org"},
		},
	})

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent with sub-agent that uses skills",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Also add skills to parent agent
	agent.AddSkillRef(skillref.Platform("parent-skill"))

	// Add sub-agent using builder method
	agent.AddSubAgent(skilledHelper)

	if len(agent.SubAgents) != 1 {
		t.Errorf("len(SubAgents) = %d, want 1", len(agent.SubAgents))
	}
	if len(agent.SkillRefs) != 1 {
		t.Errorf("len(SkillRefs) = %d, want 1", len(agent.SkillRefs))
	}
}

func TestAgentWithSubAgentUsingToolSelections(t *testing.T) {
	github, err := mcpserver.Stdio(
		mcpserver.WithName("github"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
	)
	if err != nil {
		t.Fatalf("Failed to create MCP server: %v", err)
	}

	selectiveHelper := mustSubAgent("selective-helper", &subagent.Args{
		Instructions: "Use specific GitHub tools",
		McpServers:   []string{"github"},
		McpToolSelections: map[string]*types.McpToolSelection{
			"github": {EnabledTools: []string{"create_issue", "list_repos"}},
		},
	})

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent with selective sub-agent",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add MCP server and sub-agent using builder methods
	agent.AddMCPServer(github)
	agent.AddSubAgent(selectiveHelper)

	if len(agent.SubAgents) != 1 {
		t.Errorf("len(SubAgents) = %d, want 1", len(agent.SubAgents))
	}

	// Verify tool selections are preserved
	selections := agent.SubAgents[0].ToolSelections()
	if len(selections) != 1 {
		t.Errorf("len(ToolSelections()) = %d, want 1", len(selections))
	}
	if _, ok := selections["github"]; !ok {
		t.Error("ToolSelections() missing 'github' key")
	}
}
