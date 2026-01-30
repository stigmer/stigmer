package subagent

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
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

func TestGrantMcpAccess(t *testing.T) {
	tests := []struct {
		name   string
		grants []struct {
			server string
			tools  []string
		}
		wantCount int
	}{
		{
			name: "single server all tools",
			grants: []struct {
				server string
				tools  []string
			}{
				{server: "github", tools: nil},
			},
			wantCount: 1,
		},
		{
			name: "single server specific tools",
			grants: []struct {
				server string
				tools  []string
			}{
				{server: "github", tools: []string{"create_issue", "list_repos"}},
			},
			wantCount: 1,
		},
		{
			name: "multiple servers",
			grants: []struct {
				server string
				tools  []string
			}{
				{server: "github", tools: []string{"create_issue"}},
				{server: "gitlab", tools: nil},
			},
			wantCount: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sub, err := New("test-sub", &Args{
				Instructions: "Test sub-agent with MCP access",
			})
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}

			// Apply grants
			for _, grant := range tt.grants {
				sub.GrantMcpAccess(grant.server, grant.tools...)
			}

			// Check result
			access := sub.McpAccess()
			if len(access) != tt.wantCount {
				t.Errorf("len(McpAccess()) = %d, want %d", len(access), tt.wantCount)
			}

			// Verify first grant details
			if len(tt.grants) > 0 && len(access) > 0 {
				if access[0].McpServer != tt.grants[0].server {
					t.Errorf("access[0].McpServer = %q, want %q", access[0].McpServer, tt.grants[0].server)
				}
				if len(tt.grants[0].tools) > 0 {
					if len(access[0].EnabledTools) != len(tt.grants[0].tools) {
						t.Errorf("len(access[0].EnabledTools) = %d, want %d",
							len(access[0].EnabledTools), len(tt.grants[0].tools))
					}
				}
			}
		})
	}
}

func TestGrantMcpAccess_Chaining(t *testing.T) {
	sub, err := New("chained-sub", &Args{
		Instructions: "Test chaining MCP access grants",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Test fluent chaining
	sub.GrantMcpAccess("github", "create_issue").
		GrantMcpAccess("gitlab").
		GrantMcpAccess("slack", "send_message", "list_channels")

	access := sub.McpAccess()
	if len(access) != 3 {
		t.Errorf("len(McpAccess()) = %d, want 3", len(access))
	}

	// Verify each grant
	if access[0].McpServer != "github" {
		t.Errorf("access[0].McpServer = %q, want %q", access[0].McpServer, "github")
	}
	if len(access[0].EnabledTools) != 1 {
		t.Errorf("len(access[0].EnabledTools) = %d, want 1", len(access[0].EnabledTools))
	}

	if access[1].McpServer != "gitlab" {
		t.Errorf("access[1].McpServer = %q, want %q", access[1].McpServer, "gitlab")
	}
	if len(access[1].EnabledTools) != 0 {
		t.Errorf("len(access[1].EnabledTools) = %d, want 0 (all tools)", len(access[1].EnabledTools))
	}

	if access[2].McpServer != "slack" {
		t.Errorf("access[2].McpServer = %q, want %q", access[2].McpServer, "slack")
	}
	if len(access[2].EnabledTools) != 2 {
		t.Errorf("len(access[2].EnabledTools) = %d, want 2", len(access[2].EnabledTools))
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

func TestAddSkillRef(t *testing.T) {
	sub, err := New("skilled-sub", &Args{
		Instructions: "Use skills",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add skill using builder method
	ref := &apiresource.ApiResourceReference{
		Kind:  apiresourcekind.ApiResourceKind_skill,
		Slug:  "test-skill",
		Scope: apiresource.ApiResourceOwnerScope_platform,
	}
	sub.AddSkillRef(ref)

	refs := sub.SkillRefs()
	if len(refs) != 1 {
		t.Errorf("len(SkillRefs()) = %d, want 1", len(refs))
	}
	if refs[0].Slug != "test-skill" {
		t.Errorf("refs[0].Slug = %q, want %q", refs[0].Slug, "test-skill")
	}
}

func TestAddSkillRefs(t *testing.T) {
	sub, err := New("multi-skilled-sub", &Args{
		Instructions: "Use multiple skills",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add multiple skills
	ref1 := &apiresource.ApiResourceReference{
		Kind:  apiresourcekind.ApiResourceKind_skill,
		Slug:  "skill1",
		Scope: apiresource.ApiResourceOwnerScope_platform,
	}
	ref2 := &apiresource.ApiResourceReference{
		Kind:  apiresourcekind.ApiResourceKind_skill,
		Slug:  "skill2",
		Scope: apiresource.ApiResourceOwnerScope_organization,
		Org:   "my-org",
	}
	sub.AddSkillRefs(ref1, ref2)

	refs := sub.SkillRefs()
	if len(refs) != 2 {
		t.Errorf("len(SkillRefs()) = %d, want 2", len(refs))
	}
}

func TestAddOrgSkillRef(t *testing.T) {
	sub, err := New("org-skilled-sub", &Args{
		Instructions: "Use org skills",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add org skill without version
	sub.AddOrgSkillRef("acme-corp", "internal-docs")

	// Add org skill with version
	sub.AddOrgSkillRef("acme-corp", "guidelines", "v1.0")

	refs := sub.SkillRefs()
	if len(refs) != 2 {
		t.Errorf("len(SkillRefs()) = %d, want 2", len(refs))
	}

	// Verify first ref
	if refs[0].Slug != "internal-docs" {
		t.Errorf("refs[0].Slug = %q, want %q", refs[0].Slug, "internal-docs")
	}
	if refs[0].Org != "acme-corp" {
		t.Errorf("refs[0].Org = %q, want %q", refs[0].Org, "acme-corp")
	}
	if refs[0].Scope != apiresource.ApiResourceOwnerScope_organization {
		t.Errorf("refs[0].Scope = %v, want organization", refs[0].Scope)
	}

	// Verify second ref has version
	if refs[1].Version != "v1.0" {
		t.Errorf("refs[1].Version = %q, want %q", refs[1].Version, "v1.0")
	}
}
