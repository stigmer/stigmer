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

func TestAgentWithSubAgents(t *testing.T) {
	tests := []struct {
		name    string
		opts    []Option
		wantErr bool
		check   func(*testing.T, *Agent)
	}{
		{
			name: "agent with inline sub-agent",
			opts: []Option{
				WithName("main-agent"),
				WithInstructions("Main agent instructions"),
				WithSubAgent(mustInline(
					subagent.WithName("helper"),
					subagent.WithInstructions("Helper instructions"),
				)),
			},
			wantErr: false,
			check: func(t *testing.T, a *Agent) {
				if len(a.SubAgents) != 1 {
					t.Errorf("len(SubAgents) = %d, want 1", len(a.SubAgents))
				}
				if !a.SubAgents[0].IsInline() {
					t.Error("expected inline sub-agent")
				}
			},
		},
		{
			name: "agent with referenced sub-agent",
			opts: []Option{
				WithName("main-agent"),
				WithInstructions("Main agent instructions"),
				WithSubAgent(subagent.Reference("security-checker", "sec-prod")),
			},
			wantErr: false,
			check: func(t *testing.T, a *Agent) {
				if len(a.SubAgents) != 1 {
					t.Errorf("len(SubAgents) = %d, want 1", len(a.SubAgents))
				}
				if !a.SubAgents[0].IsReference() {
					t.Error("expected referenced sub-agent")
				}
			},
		},
		{
			name: "agent with multiple sub-agents",
			opts: []Option{
				WithName("orchestrator"),
				WithInstructions("Orchestrate multiple sub-agents"),
				WithSubAgents(
					mustInline(
						subagent.WithName("analyzer"),
						subagent.WithInstructions("Analyze code for bugs"),
					),
					mustInline(
						subagent.WithName("reviewer"),
						subagent.WithInstructions("Review code for style"),
					),
					subagent.Reference("security", "sec-prod"),
				),
			},
			wantErr: false,
			check: func(t *testing.T, a *Agent) {
				if len(a.SubAgents) != 3 {
					t.Errorf("len(SubAgents) = %d, want 3", len(a.SubAgents))
				}
				if !a.SubAgents[0].IsInline() {
					t.Error("expected first sub-agent to be inline")
				}
				if !a.SubAgents[1].IsInline() {
					t.Error("expected second sub-agent to be inline")
				}
				if !a.SubAgents[2].IsReference() {
					t.Error("expected third sub-agent to be reference")
				}
			},
		},
		{
			name: "agent with inline sub-agent with MCP servers",
			opts: func() []Option {
				github, err := mcpserver.Stdio(
					mcpserver.WithName("github"),
					mcpserver.WithCommand("npx"),
					mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
				)
				if err != nil {
					t.Fatalf("Failed to create MCP server: %v", err)
				}
				return []Option{
					WithName("main-agent"),
					WithInstructions("Main agent with sub-agent that uses MCP servers"),
					WithMCPServer(github),
					WithSubAgent(mustInline(
						subagent.WithName("github-helper"),
						subagent.WithInstructions("Help with GitHub operations"),
						subagent.WithMCPServer("github"),
					)),
				}
			}(),
			wantErr: false,
			check: func(t *testing.T, a *Agent) {
				if len(a.MCPServers) != 1 {
					t.Errorf("len(MCPServers) = %d, want 1", len(a.MCPServers))
				}
				if len(a.SubAgents) != 1 {
					t.Errorf("len(SubAgents) = %d, want 1", len(a.SubAgents))
				}
			},
		},
		{
			name: "agent with inline sub-agent with skills",
			opts: []Option{
				WithName("main-agent"),
				WithInstructions("Main agent with sub-agent that uses skills"),
				WithSubAgent(mustInline(
					subagent.WithName("skilled-helper"),
					subagent.WithInstructions("Use coding knowledge"),
					subagent.WithSkills(
						skill.Platform("coding-best-practices"),
						skill.Organization("my-org", "internal-apis"),
					),
				)),
			},
			wantErr: false,
			check: func(t *testing.T, a *Agent) {
				if len(a.SubAgents) != 1 {
					t.Errorf("len(SubAgents) = %d, want 1", len(a.SubAgents))
				}
			},
		},
		{
			name: "agent with inline sub-agent with tool selections",
			opts: func() []Option {
				github, err := mcpserver.Stdio(
					mcpserver.WithName("github"),
					mcpserver.WithCommand("npx"),
					mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
				)
				if err != nil {
					t.Fatalf("Failed to create MCP server: %v", err)
				}
				return []Option{
					WithName("main-agent"),
					WithInstructions("Main agent with selective sub-agent"),
					WithMCPServer(github),
					WithSubAgent(mustInline(
						subagent.WithName("selective-helper"),
						subagent.WithInstructions("Use specific GitHub tools"),
						subagent.WithMCPServer("github"),
						subagent.WithToolSelection("github", "create_issue", "list_repos"),
					)),
				}
			}(),
			wantErr: false,
			check: func(t *testing.T, a *Agent) {
				if len(a.SubAgents) != 1 {
					t.Errorf("len(SubAgents) = %d, want 1", len(a.SubAgents))
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a, err := New(tt.opts...)
			if (err != nil) != tt.wantErr {
				t.Errorf("New() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if tt.check != nil && !tt.wantErr {
				tt.check(t, a)
			}
		})
	}
}
