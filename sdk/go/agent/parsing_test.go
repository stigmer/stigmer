package agent

import (
	"errors"
	"sync"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// ============================================================================
// AddSkill Tests
// ============================================================================

func TestAddSkill(t *testing.T) {
	tests := []struct {
		name        string
		agentOrg    string
		ref         string
		opts        []SkillOption
		wantOrg     string
		wantSlug    string
		wantVersion string
	}{
		{
			name:     "slug-only with agent org",
			agentOrg: "my-org",
			ref:      "web-search",
			wantOrg:  "my-org",
			wantSlug: "web-search",
		},
		{
			name:     "explicit org/slug",
			agentOrg: "my-org",
			ref:      "stigmer/web-search",
			wantOrg:  "stigmer",
			wantSlug: "web-search",
		},
		{
			name:     "explicit org/slug without agent org",
			agentOrg: "",
			ref:      "stigmer/web-search",
			wantOrg:  "stigmer",
			wantSlug: "web-search",
		},
		{
			name:        "slug-only with version in string",
			agentOrg:    "my-org",
			ref:         "web-search@v1.0",
			wantOrg:     "my-org",
			wantSlug:    "web-search",
			wantVersion: "v1.0",
		},
		{
			name:        "explicit org/slug with version",
			agentOrg:    "my-org",
			ref:         "stigmer/web-search@v2.0",
			wantOrg:     "stigmer",
			wantSlug:    "web-search",
			wantVersion: "v2.0",
		},
		{
			name:        "slug-only with version option",
			agentOrg:    "my-org",
			ref:         "web-search",
			opts:        []SkillOption{AtVersion("stable")},
			wantOrg:     "my-org",
			wantSlug:    "web-search",
			wantVersion: "stable",
		},
		{
			name:        "version option overrides string version",
			agentOrg:    "my-org",
			ref:         "web-search@v1.0",
			opts:        []SkillOption{AtVersion("v2.0")},
			wantOrg:     "my-org",
			wantSlug:    "web-search",
			wantVersion: "v2.0",
		},
		{
			name:     "hyphenated org and slug",
			agentOrg: "",
			ref:      "acme-corp/my-custom-skill",
			wantOrg:  "acme-corp",
			wantSlug: "my-custom-skill",
		},
		{
			name:     "multiple slashes in slug",
			agentOrg: "",
			ref:      "org/slug/with/extra/parts",
			wantOrg:  "org",
			wantSlug: "slug/with/extra/parts",
		},
		{
			name:        "version with special chars uses last @",
			agentOrg:    "",
			ref:         "org/slug@email@domain.com",
			wantOrg:     "org",
			wantSlug:    "slug@email",
			wantVersion: "domain.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &Agent{Org: tt.agentOrg, Args: &AgentArgs{}}
			agent.Args.SkillRefs = nil // Ensure clean slate

			result := agent.AddSkill(tt.ref, tt.opts...)

			// Verify chaining returns same agent
			if result != agent {
				t.Error("AddSkill should return the same agent for chaining")
			}

			if len(agent.Args.SkillRefs) != 1 {
				t.Fatalf("expected 1 skill ref, got %d", len(agent.Args.SkillRefs))
			}

			ref := agent.Args.SkillRefs[0]
			if ref.Org != tt.wantOrg {
				t.Errorf("Org = %q, want %q", ref.Org, tt.wantOrg)
			}
			if ref.Slug != tt.wantSlug {
				t.Errorf("Slug = %q, want %q", ref.Slug, tt.wantSlug)
			}
			if ref.Version != tt.wantVersion {
				t.Errorf("Version = %q, want %q", ref.Version, tt.wantVersion)
			}
			if ref.Kind != apiresourcekind.ApiResourceKind_skill {
				t.Errorf("Kind = %v, want skill", ref.Kind)
			}
		})
	}
}

func TestAddSkillPanics(t *testing.T) {
	tests := []struct {
		name     string
		agentOrg string
		ref      string
		wantErr  error
	}{
		{
			name:     "slug-only without agent org",
			agentOrg: "",
			ref:      "web-search",
			wantErr:  ErrOrgRequired,
		},
		{
			name:     "empty string",
			agentOrg: "my-org",
			ref:      "",
			wantErr:  ErrEmptyRef,
		},
		{
			name:     "empty org in explicit ref",
			agentOrg: "my-org",
			ref:      "/slug",
			wantErr:  ErrEmptyOrg,
		},
		{
			name:     "empty slug in explicit ref",
			agentOrg: "my-org",
			ref:      "org/",
			wantErr:  ErrEmptySlug,
		},
		{
			name:     "empty slug with version",
			agentOrg: "my-org",
			ref:      "org/@v1.0",
			wantErr:  ErrEmptySlug,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &Agent{Org: tt.agentOrg, Args: &AgentArgs{}}

			defer func() {
				r := recover()
				if r == nil {
					t.Fatal("expected panic, got none")
				}

				err, ok := r.(error)
				if !ok {
					t.Fatalf("panic value is not an error: %v", r)
				}

				if !errors.Is(err, tt.wantErr) {
					t.Errorf("panic error = %v, want %v", err, tt.wantErr)
				}

				// Verify it's a RefParseError
				var parseErr *RefParseError
				if !errors.As(err, &parseErr) {
					t.Errorf("expected RefParseError, got %T", err)
				}
			}()

			agent.AddSkill(tt.ref)
		})
	}
}

// ============================================================================
// TryAddSkill Tests
// ============================================================================

func TestTryAddSkill(t *testing.T) {
	tests := []struct {
		name        string
		agentOrg    string
		ref         string
		opts        []SkillOption
		wantOrg     string
		wantSlug    string
		wantVersion string
	}{
		{
			name:     "slug-only with agent org",
			agentOrg: "my-org",
			ref:      "web-search",
			wantOrg:  "my-org",
			wantSlug: "web-search",
		},
		{
			name:        "with version option",
			agentOrg:    "my-org",
			ref:         "web-search",
			opts:        []SkillOption{AtVersion("v1.0")},
			wantOrg:     "my-org",
			wantSlug:    "web-search",
			wantVersion: "v1.0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &Agent{Org: tt.agentOrg, Args: &AgentArgs{}}
			agent.Args.SkillRefs = nil

			result, err := agent.TryAddSkill(tt.ref, tt.opts...)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if result != agent {
				t.Error("TryAddSkill should return the same agent")
			}

			if len(agent.Args.SkillRefs) != 1 {
				t.Fatalf("expected 1 skill ref, got %d", len(agent.Args.SkillRefs))
			}

			ref := agent.Args.SkillRefs[0]
			if ref.Org != tt.wantOrg {
				t.Errorf("Org = %q, want %q", ref.Org, tt.wantOrg)
			}
			if ref.Slug != tt.wantSlug {
				t.Errorf("Slug = %q, want %q", ref.Slug, tt.wantSlug)
			}
			if ref.Version != tt.wantVersion {
				t.Errorf("Version = %q, want %q", ref.Version, tt.wantVersion)
			}
		})
	}
}

func TestTryAddSkillErrors(t *testing.T) {
	tests := []struct {
		name     string
		agentOrg string
		ref      string
		wantErr  error
	}{
		{
			name:     "slug-only without agent org",
			agentOrg: "",
			ref:      "web-search",
			wantErr:  ErrOrgRequired,
		},
		{
			name:     "empty string",
			agentOrg: "my-org",
			ref:      "",
			wantErr:  ErrEmptyRef,
		},
		{
			name:     "empty org",
			agentOrg: "my-org",
			ref:      "/slug",
			wantErr:  ErrEmptyOrg,
		},
		{
			name:     "empty slug",
			agentOrg: "my-org",
			ref:      "org/",
			wantErr:  ErrEmptySlug,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &Agent{Org: tt.agentOrg, Args: &AgentArgs{}}
			agent.Args.SkillRefs = nil

			_, err := agent.TryAddSkill(tt.ref)
			if err == nil {
				t.Fatal("expected error, got nil")
			}

			if !errors.Is(err, tt.wantErr) {
				t.Errorf("error = %v, want %v", err, tt.wantErr)
			}

			var parseErr *RefParseError
			if !errors.As(err, &parseErr) {
				t.Errorf("expected RefParseError, got %T", err)
			}

			// Verify agent was not modified
			if len(agent.Args.SkillRefs) != 0 {
				t.Errorf("expected 0 skill refs after error, got %d", len(agent.Args.SkillRefs))
			}
		})
	}
}

// ============================================================================
// AddSkills Tests
// ============================================================================

func TestAddSkills(t *testing.T) {
	t.Run("multiple valid refs", func(t *testing.T) {
		agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
		agent.Args.SkillRefs = nil

		result := agent.AddSkills(
			"web-search",
			"stigmer/code-review",
			"stigmer/security@v2.0",
		)

		if result != agent {
			t.Error("AddSkills should return the same agent")
		}

		if len(agent.Args.SkillRefs) != 3 {
			t.Fatalf("expected 3 skill refs, got %d", len(agent.Args.SkillRefs))
		}

		// Verify first ref
		if agent.Args.SkillRefs[0].Org != "my-org" || agent.Args.SkillRefs[0].Slug != "web-search" {
			t.Errorf("first ref = %s/%s, want my-org/web-search",
				agent.Args.SkillRefs[0].Org, agent.Args.SkillRefs[0].Slug)
		}

		// Verify second ref
		if agent.Args.SkillRefs[1].Org != "stigmer" || agent.Args.SkillRefs[1].Slug != "code-review" {
			t.Errorf("second ref = %s/%s, want stigmer/code-review",
				agent.Args.SkillRefs[1].Org, agent.Args.SkillRefs[1].Slug)
		}

		// Verify third ref with version
		if agent.Args.SkillRefs[2].Org != "stigmer" || agent.Args.SkillRefs[2].Slug != "security" || agent.Args.SkillRefs[2].Version != "v2.0" {
			t.Errorf("third ref = %s/%s@%s, want stigmer/security@v2.0",
				agent.Args.SkillRefs[2].Org, agent.Args.SkillRefs[2].Slug, agent.Args.SkillRefs[2].Version)
		}
	})

	t.Run("empty list is no-op", func(t *testing.T) {
		agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
		agent.Args.SkillRefs = nil

		result := agent.AddSkills()

		if result != agent {
			t.Error("AddSkills should return the same agent")
		}

		if len(agent.Args.SkillRefs) != 0 {
			t.Errorf("expected 0 skill refs, got %d", len(agent.Args.SkillRefs))
		}
	})

	t.Run("panics on first invalid ref", func(t *testing.T) {
		agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
		agent.Args.SkillRefs = nil

		defer func() {
			r := recover()
			if r == nil {
				t.Fatal("expected panic, got none")
			}

			// Verify no refs were added (atomic operation)
			if len(agent.Args.SkillRefs) != 0 {
				t.Errorf("expected 0 skill refs after panic, got %d", len(agent.Args.SkillRefs))
			}
		}()

		agent.AddSkills(
			"valid-skill",
			"", // Invalid - should panic
			"another-valid",
		)
	})
}

func TestTryAddSkills(t *testing.T) {
	t.Run("multiple valid refs", func(t *testing.T) {
		agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
		agent.Args.SkillRefs = nil

		result, err := agent.TryAddSkills(
			"web-search",
			"stigmer/code-review",
		)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if result != agent {
			t.Error("TryAddSkills should return the same agent")
		}

		if len(agent.Args.SkillRefs) != 2 {
			t.Fatalf("expected 2 skill refs, got %d", len(agent.Args.SkillRefs))
		}
	})

	t.Run("error on invalid ref - atomic", func(t *testing.T) {
		agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
		agent.Args.SkillRefs = nil

		_, err := agent.TryAddSkills(
			"valid-skill",
			"", // Invalid
			"another-valid",
		)
		if err == nil {
			t.Fatal("expected error, got nil")
		}

		// Verify no refs were added (atomic operation)
		if len(agent.Args.SkillRefs) != 0 {
			t.Errorf("expected 0 skill refs after error, got %d", len(agent.Args.SkillRefs))
		}
	})

	t.Run("empty list is no-op", func(t *testing.T) {
		agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
		agent.Args.SkillRefs = nil

		result, err := agent.TryAddSkills()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if result != agent {
			t.Error("TryAddSkills should return the same agent")
		}
	})
}

// ============================================================================
// UseMCP Tests
// ============================================================================

func TestUseMCP(t *testing.T) {
	tests := []struct {
		name         string
		agentOrg     string
		ref          string
		enabledTools []string
		wantOrg      string
		wantSlug     string
	}{
		{
			name:     "slug-only with agent org",
			agentOrg: "my-org",
			ref:      "github",
			wantOrg:  "my-org",
			wantSlug: "github",
		},
		{
			name:     "explicit org/slug",
			agentOrg: "my-org",
			ref:      "stigmer/github",
			wantOrg:  "stigmer",
			wantSlug: "github",
		},
		{
			name:     "explicit org/slug without agent org",
			agentOrg: "",
			ref:      "stigmer/github",
			wantOrg:  "stigmer",
			wantSlug: "github",
		},
		{
			name:         "with enabled tools",
			agentOrg:     "my-org",
			ref:          "github",
			enabledTools: []string{"create_pr", "search_code"},
			wantOrg:      "my-org",
			wantSlug:     "github",
		},
		{
			name:     "hyphenated names",
			agentOrg: "",
			ref:      "acme-corp/internal-tools",
			wantOrg:  "acme-corp",
			wantSlug: "internal-tools",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &Agent{Org: tt.agentOrg, Args: &AgentArgs{}}
			agent.Args.McpServerUsages = nil

			result := agent.UseMCP(tt.ref, tt.enabledTools...)

			if result != agent {
				t.Error("UseMCP should return the same agent for chaining")
			}

			if len(agent.Args.McpServerUsages) != 1 {
				t.Fatalf("expected 1 mcp server usage, got %d", len(agent.Args.McpServerUsages))
			}

			usage := agent.Args.McpServerUsages[0]
			if usage.McpServerRef.Org != tt.wantOrg {
				t.Errorf("Org = %q, want %q", usage.McpServerRef.Org, tt.wantOrg)
			}
			if usage.McpServerRef.Slug != tt.wantSlug {
				t.Errorf("Slug = %q, want %q", usage.McpServerRef.Slug, tt.wantSlug)
			}
			if usage.McpServerRef.Kind != apiresourcekind.ApiResourceKind_mcp_server {
				t.Errorf("Kind = %v, want mcp_server", usage.McpServerRef.Kind)
			}

			// Verify enabled tools
			if len(tt.enabledTools) > 0 {
				if len(usage.EnabledTools) != len(tt.enabledTools) {
					t.Errorf("EnabledTools count = %d, want %d",
						len(usage.EnabledTools), len(tt.enabledTools))
				}
				for i, tool := range tt.enabledTools {
					if usage.EnabledTools[i] != tool {
						t.Errorf("EnabledTools[%d] = %q, want %q",
							i, usage.EnabledTools[i], tool)
					}
				}
			}
		})
	}
}

func TestUseMCPPanics(t *testing.T) {
	tests := []struct {
		name     string
		agentOrg string
		ref      string
		wantErr  error
	}{
		{
			name:     "slug-only without agent org",
			agentOrg: "",
			ref:      "github",
			wantErr:  ErrOrgRequired,
		},
		{
			name:     "empty string",
			agentOrg: "my-org",
			ref:      "",
			wantErr:  ErrEmptyRef,
		},
		{
			name:     "empty org in explicit ref",
			agentOrg: "my-org",
			ref:      "/github",
			wantErr:  ErrEmptyOrg,
		},
		{
			name:     "empty slug",
			agentOrg: "my-org",
			ref:      "org/",
			wantErr:  ErrEmptySlug,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &Agent{Org: tt.agentOrg, Args: &AgentArgs{}}

			defer func() {
				r := recover()
				if r == nil {
					t.Fatal("expected panic, got none")
				}

				err, ok := r.(error)
				if !ok {
					t.Fatalf("panic value is not an error: %v", r)
				}

				if !errors.Is(err, tt.wantErr) {
					t.Errorf("panic error = %v, want %v", err, tt.wantErr)
				}
			}()

			agent.UseMCP(tt.ref)
		})
	}
}

func TestTryUseMCP(t *testing.T) {
	t.Run("valid ref", func(t *testing.T) {
		agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
		agent.Args.McpServerUsages = nil

		result, err := agent.TryUseMCP("github", "create_pr")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if result != agent {
			t.Error("TryUseMCP should return the same agent")
		}

		if len(agent.Args.McpServerUsages) != 1 {
			t.Fatalf("expected 1 mcp server usage, got %d", len(agent.Args.McpServerUsages))
		}
	})

	t.Run("error on invalid ref", func(t *testing.T) {
		agent := &Agent{Org: "", Args: &AgentArgs{}}
		agent.Args.McpServerUsages = nil

		_, err := agent.TryUseMCP("github")
		if err == nil {
			t.Fatal("expected error, got nil")
		}

		if !errors.Is(err, ErrOrgRequired) {
			t.Errorf("error = %v, want %v", err, ErrOrgRequired)
		}

		if len(agent.Args.McpServerUsages) != 0 {
			t.Errorf("expected 0 usages after error, got %d", len(agent.Args.McpServerUsages))
		}
	})
}

// ============================================================================
// Chaining Tests
// ============================================================================

func TestChaining(t *testing.T) {
	agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
	agent.Args.SkillRefs = nil
	agent.Args.McpServerUsages = nil

	// Chain skill and MCP server additions
	agent.
		AddSkill("web-search").
		AddSkill("stigmer/code-review@v1.0").
		UseMCP("github", "create_pr").
		UseMCP("stigmer/slack", "send_message")

	if len(agent.Args.SkillRefs) != 2 {
		t.Errorf("expected 2 skill refs, got %d", len(agent.Args.SkillRefs))
	}

	if len(agent.Args.McpServerUsages) != 2 {
		t.Errorf("expected 2 mcp server usages, got %d", len(agent.Args.McpServerUsages))
	}

	// Verify first skill
	if agent.Args.SkillRefs[0].Org != "my-org" || agent.Args.SkillRefs[0].Slug != "web-search" {
		t.Errorf("first skill = %s/%s, want my-org/web-search",
			agent.Args.SkillRefs[0].Org, agent.Args.SkillRefs[0].Slug)
	}

	// Verify second skill with version
	if agent.Args.SkillRefs[1].Org != "stigmer" || agent.Args.SkillRefs[1].Slug != "code-review" || agent.Args.SkillRefs[1].Version != "v1.0" {
		t.Errorf("second skill = %s/%s@%s, want stigmer/code-review@v1.0",
			agent.Args.SkillRefs[1].Org, agent.Args.SkillRefs[1].Slug, agent.Args.SkillRefs[1].Version)
	}

	// Verify first MCP server
	if agent.Args.McpServerUsages[0].McpServerRef.Org != "my-org" ||
		agent.Args.McpServerUsages[0].McpServerRef.Slug != "github" {
		t.Errorf("first mcp = %s/%s, want my-org/github",
			agent.Args.McpServerUsages[0].McpServerRef.Org,
			agent.Args.McpServerUsages[0].McpServerRef.Slug)
	}
}

// ============================================================================
// Thread Safety Tests
// ============================================================================

func TestAddSkillConcurrent(t *testing.T) {
	agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
	agent.Args.SkillRefs = nil

	var wg sync.WaitGroup
	numGoroutines := 100

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			agent.AddSkill("skill-" + string(rune('a'+n%26)))
		}(i)
	}

	wg.Wait()

	if len(agent.Args.SkillRefs) != numGoroutines {
		t.Errorf("expected %d skill refs, got %d", numGoroutines, len(agent.Args.SkillRefs))
	}
}

func TestUseMCPConcurrent(t *testing.T) {
	agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
	agent.Args.McpServerUsages = nil

	var wg sync.WaitGroup
	numGoroutines := 100

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			agent.UseMCP("server-" + string(rune('a'+n%26)))
		}(i)
	}

	wg.Wait()

	if len(agent.Args.McpServerUsages) != numGoroutines {
		t.Errorf("expected %d mcp usages, got %d", numGoroutines, len(agent.Args.McpServerUsages))
	}
}

func TestMixedConcurrent(t *testing.T) {
	agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
	agent.Args.SkillRefs = nil
	agent.Args.McpServerUsages = nil

	var wg sync.WaitGroup
	numGoroutines := 50

	// Add skills concurrently
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			agent.AddSkill("skill-" + string(rune('a'+n%26)))
		}(i)
	}

	// Add MCP servers concurrently
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			agent.UseMCP("server-" + string(rune('a'+n%26)))
		}(i)
	}

	wg.Wait()

	if len(agent.Args.SkillRefs) != numGoroutines {
		t.Errorf("expected %d skill refs, got %d", numGoroutines, len(agent.Args.SkillRefs))
	}

	if len(agent.Args.McpServerUsages) != numGoroutines {
		t.Errorf("expected %d mcp usages, got %d", numGoroutines, len(agent.Args.McpServerUsages))
	}
}

// ============================================================================
// RefParseError Tests
// ============================================================================

func TestRefParseError(t *testing.T) {
	t.Run("error message with ref", func(t *testing.T) {
		err := &RefParseError{
			Ref:     "bad-input",
			Message: "something went wrong",
			Err:     ErrEmptyOrg,
		}
		want := `agent: cannot parse "bad-input": something went wrong`
		if err.Error() != want {
			t.Errorf("Error() = %q, want %q", err.Error(), want)
		}
	})

	t.Run("error message without ref", func(t *testing.T) {
		err := &RefParseError{
			Ref:     "",
			Message: "reference string is empty",
			Err:     ErrEmptyRef,
		}
		want := `agent: reference string is empty`
		if err.Error() != want {
			t.Errorf("Error() = %q, want %q", err.Error(), want)
		}
	})

	t.Run("unwrap returns underlying error", func(t *testing.T) {
		err := &RefParseError{
			Ref:     "test",
			Message: "test message",
			Err:     ErrOrgRequired,
		}
		if !errors.Is(err, ErrOrgRequired) {
			t.Error("errors.Is should return true for underlying error")
		}
	})
}

// ============================================================================
// Integration Tests
// ============================================================================

func TestIntegrationWithAgentNew(t *testing.T) {
	// Create a full agent using New() and then add skills/MCP servers
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test agent for integration testing",
	})
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	// Set org for slug-only references
	agent.Org = "my-org"

	// Add skills and MCP servers using smart parsing
	agent.
		AddSkill("web-search").
		AddSkill("stigmer/code-review@v1.0").
		AddSkills("security", "stigmer/analytics").
		UseMCP("github", "create_pr", "search_code").
		UseMCP("stigmer/slack")

	// Verify skills
	if len(agent.Args.SkillRefs) != 4 {
		t.Errorf("expected 4 skill refs, got %d", len(agent.Args.SkillRefs))
	}

	// Verify MCP servers
	if len(agent.Args.McpServerUsages) != 2 {
		t.Errorf("expected 2 mcp usages, got %d", len(agent.Args.McpServerUsages))
	}

	// Verify specific refs
	expectedSkills := []struct {
		org     string
		slug    string
		version string
	}{
		{"my-org", "web-search", ""},
		{"stigmer", "code-review", "v1.0"},
		{"my-org", "security", ""},
		{"stigmer", "analytics", ""},
	}

	for i, expected := range expectedSkills {
		if agent.Args.SkillRefs[i].Org != expected.org {
			t.Errorf("skill[%d].Org = %q, want %q", i, agent.Args.SkillRefs[i].Org, expected.org)
		}
		if agent.Args.SkillRefs[i].Slug != expected.slug {
			t.Errorf("skill[%d].Slug = %q, want %q", i, agent.Args.SkillRefs[i].Slug, expected.slug)
		}
		if agent.Args.SkillRefs[i].Version != expected.version {
			t.Errorf("skill[%d].Version = %q, want %q", i, agent.Args.SkillRefs[i].Version, expected.version)
		}
	}

	// Verify MCP server enabled tools
	if len(agent.Args.McpServerUsages[0].EnabledTools) != 2 {
		t.Errorf("expected 2 enabled tools for github, got %d",
			len(agent.Args.McpServerUsages[0].EnabledTools))
	}
}

func TestKindIsCorrect(t *testing.T) {
	agent := &Agent{Org: "my-org", Args: &AgentArgs{}}
	agent.Args.SkillRefs = nil
	agent.Args.McpServerUsages = nil

	agent.AddSkill("web-search")
	agent.UseMCP("github")

	// Verify skill kind
	if agent.Args.SkillRefs[0].Kind != apiresourcekind.ApiResourceKind_skill {
		t.Errorf("skill kind = %v, want skill", agent.Args.SkillRefs[0].Kind)
	}

	// Verify MCP server kind
	if agent.Args.McpServerUsages[0].McpServerRef.Kind != apiresourcekind.ApiResourceKind_mcp_server {
		t.Errorf("mcp server kind = %v, want mcp_server",
			agent.Args.McpServerUsages[0].McpServerRef.Kind)
	}
}
