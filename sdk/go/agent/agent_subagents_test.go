package agent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/subagent"
)

// mustInline creates an inline sub-agent or panics on error.
// This is a test helper for concise test cases.
func mustInline(opts ...subagent.InlineOption) subagent.SubAgent {
	sub, err := subagent.Inline(opts...)
	if err != nil {
		panic("failed to create inline sub-agent: " + err.Error())
	}
	return sub
}

func TestAgentWithInlineSubAgent(t *testing.T) {
	helper := mustInline(
		subagent.WithName("helper"),
		subagent.WithInstructions("Helper instructions"),
	)

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
	if !agent.SubAgents[0].IsInline() {
		t.Error("expected inline sub-agent")
	}
}

func TestAgentWithReferencedSubAgent(t *testing.T) {
	refAgent := subagent.Reference("helper", "prod")

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent instructions",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add referenced sub-agent using builder method
	agent.AddSubAgent(refAgent)

	if len(agent.SubAgents) != 1 {
		t.Errorf("len(SubAgents) = %d, want 1", len(agent.SubAgents))
	}
	if !agent.SubAgents[0].IsReference() {
		t.Error("expected referenced sub-agent")
	}
}

func TestAgentWithMultipleSubAgents(t *testing.T) {
	analyzer := mustInline(
		subagent.WithName("analyzer"),
		subagent.WithInstructions("Analyze code for bugs"),
	)

	reviewer := mustInline(
		subagent.WithName("reviewer"),
		subagent.WithInstructions("Review code for style"),
	)

	securityRef := subagent.Reference("security", "sec-prod")

	agent, err := New(nil, "orchestrator", &AgentArgs{
		Instructions: "Orchestrate multiple sub-agents",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add all sub-agents using builder method
	agent.AddSubAgents(analyzer, reviewer, securityRef)

	if len(agent.SubAgents) != 3 {
		t.Errorf("len(SubAgents) = %d, want 3", len(agent.SubAgents))
	}
	if !agent.SubAgents[0].IsInline() {
		t.Error("expected first sub-agent to be inline")
	}
	if !agent.SubAgents[1].IsInline() {
		t.Error("expected second sub-agent to be inline")
	}
	if !agent.SubAgents[2].IsReference() {
		t.Error("expected third sub-agent to be reference")
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

	githubHelper := mustInline(
		subagent.WithName("github-helper"),
		subagent.WithInstructions("Help with GitHub operations"),
		subagent.WithMCPServer("github"),
	)

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
	skilledHelper := mustInline(
		subagent.WithName("skilled-helper"),
		subagent.WithInstructions("Use coding knowledge"),
		subagent.WithSkills(
			skill.Platform("coding-best-practices"),
			skill.Organization("my-org", "internal-apis"),
		),
	)

	agent, err := New(nil, "main-agent", &AgentArgs{
		Instructions: "Main agent with sub-agent that uses skills",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add sub-agent using builder method
	agent.AddSubAgent(skilledHelper)

	if len(agent.SubAgents) != 1 {
		t.Errorf("len(SubAgents) = %d, want 1", len(agent.SubAgents))
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

	selectiveHelper := mustInline(
		subagent.WithName("selective-helper"),
		subagent.WithInstructions("Use specific GitHub tools"),
		subagent.WithMCPServer("github"),
		subagent.WithToolSelection("github", "create_issue", "list_repos"),
	)

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
}
