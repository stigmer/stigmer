package subagent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

func TestNew(t *testing.T) {
	tests := []struct {
		name    string
		subName string
		args    *Args
		check   func(*testing.T, SubAgent)
	}{
		{
			name:    "basic sub-agent",
			subName: "code-analyzer",
			args: &Args{
				Instructions: "Analyze code for bugs and security issues",
			},
			check: func(t *testing.T, s SubAgent) {
				if s.Name() != "code-analyzer" {
					t.Errorf("Name() = %q, want %q", s.Name(), "code-analyzer")
				}
				if s.Instructions() != "Analyze code for bugs and security issues" {
					t.Errorf("Instructions() = %q, want longer text", s.Instructions())
				}
			},
		},
		{
			name:    "with description",
			subName: "security-checker",
			args: &Args{
				Instructions: "Check code for security vulnerabilities",
				Description:  "Security analysis sub-agent",
			},
			check: func(t *testing.T, s SubAgent) {
				if s.Description() != "Security analysis sub-agent" {
					t.Errorf("Description() = %q, want %q", s.Description(), "Security analysis sub-agent")
				}
			},
		},
		{
			name:    "with MCP servers",
			subName: "github-bot",
			args: &Args{
				Instructions: "Interact with GitHub repositories",
				McpServers:   []string{"github", "gitlab"},
			},
			check: func(t *testing.T, s SubAgent) {
				servers := s.MCPServerNames()
				if len(servers) != 2 {
					t.Errorf("len(MCPServerNames()) = %d, want 2", len(servers))
				}
				if servers[0] != "github" || servers[1] != "gitlab" {
					t.Errorf("MCPServerNames() = %v, want [github gitlab]", servers)
				}
			},
		},
		{
			name:    "with tool selections",
			subName: "selective-bot",
			args: &Args{
				Instructions: "Use specific GitHub tools only",
				McpServers:   []string{"github"},
				McpToolSelections: map[string]*types.McpToolSelection{
					"github": {EnabledTools: []string{"create_issue", "list_repos"}},
				},
			},
			check: func(t *testing.T, s SubAgent) {
				selections := s.ToolSelections()
				if len(selections) != 1 {
					t.Errorf("len(ToolSelections()) = %d, want 1", len(selections))
				}
				tools, ok := selections["github"]
				if !ok {
					t.Error("ToolSelections() missing 'github' key")
				}
				if len(tools.EnabledTools) != 2 {
					t.Errorf("len(tools.EnabledTools) = %d, want 2", len(tools.EnabledTools))
				}
			},
		},
		{
			name:    "with nil args",
			subName: "minimal-bot",
			args:    nil,
			check: func(t *testing.T, s SubAgent) {
				if s.Name() != "minimal-bot" {
					t.Errorf("Name() = %q, want %q", s.Name(), "minimal-bot")
				}
				if s.Instructions() != "" {
					t.Errorf("Instructions() = %q, want empty", s.Instructions())
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sub, err := New(tt.subName, tt.args)
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}

			if tt.check != nil {
				tt.check(t, sub)
			}
		})
	}
}

func TestString(t *testing.T) {
	sub, err := New("analyzer", &Args{
		Instructions: "Analyze code",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	want := "SubAgent(analyzer)"
	got := sub.String()
	if got != want {
		t.Errorf("String() = %q, want %q", got, want)
	}
}

func TestSkillRefs(t *testing.T) {
	sub, err := New("skilled-bot", &Args{
		Instructions: "Use multiple skills",
		SkillRefs: []*types.ApiResourceReference{
			{Slug: "skill1", Scope: "platform"},
			{Slug: "skill2", Scope: "organization", Org: "my-org"},
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	refs := sub.SkillRefs()
	if len(refs) != 2 {
		t.Errorf("len(SkillRefs()) = %d, want 2", len(refs))
	}
	if refs[0].Slug != "skill1" {
		t.Errorf("refs[0].Slug = %q, want %q", refs[0].Slug, "skill1")
	}
	if refs[1].Slug != "skill2" {
		t.Errorf("refs[1].Slug = %q, want %q", refs[1].Slug, "skill2")
	}
}
