package subagent

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
		ref         string
		opts        []SkillOption
		wantOrg     string
		wantSlug    string
		wantVersion string
	}{
		{
			name:     "explicit org/slug",
			ref:      "stigmer/web-search",
			wantOrg:  "stigmer",
			wantSlug: "web-search",
		},
		{
			name:        "explicit org/slug with version",
			ref:         "stigmer/web-search@v1.0",
			wantOrg:     "stigmer",
			wantSlug:    "web-search",
			wantVersion: "v1.0",
		},
		{
			name:        "version via option",
			ref:         "stigmer/web-search",
			opts:        []SkillOption{AtVersion("v2.0")},
			wantOrg:     "stigmer",
			wantSlug:    "web-search",
			wantVersion: "v2.0",
		},
		{
			name:        "option version overrides string version",
			ref:         "stigmer/web-search@v1.0",
			opts:        []SkillOption{AtVersion("v2.0")},
			wantOrg:     "stigmer",
			wantSlug:    "web-search",
			wantVersion: "v2.0",
		},
		{
			name:     "hyphenated org and slug",
			ref:      "acme-corp/my-custom-skill",
			wantOrg:  "acme-corp",
			wantSlug: "my-custom-skill",
		},
		{
			name:     "multiple slashes in slug (nested path)",
			ref:      "org/slug/with/extra/parts",
			wantOrg:  "org",
			wantSlug: "slug/with/extra/parts",
		},
		{
			name:        "version with special chars uses last @",
			ref:         "org/slug@email@domain.com",
			wantOrg:     "org",
			wantSlug:    "slug@email",
			wantVersion: "domain.com",
		},
		{
			name:        "semantic version",
			ref:         "stigmer/web-search@v2.1.3",
			wantOrg:     "stigmer",
			wantSlug:    "web-search",
			wantVersion: "v2.1.3",
		},
		{
			name:        "named tag version",
			ref:         "stigmer/web-search@stable",
			wantOrg:     "stigmer",
			wantSlug:    "web-search",
			wantVersion: "stable",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

			result := sub.AddSkill(tt.ref, tt.opts...)

			// Verify chaining returns same subagent
			if result != &sub {
				t.Error("AddSkill should return the same subagent for chaining")
			}

			if len(sub.skillRefs) != 1 {
				t.Fatalf("expected 1 skill ref, got %d", len(sub.skillRefs))
			}

			ref := sub.skillRefs[0]
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
		name    string
		ref     string
		wantErr error
	}{
		{
			name:    "slug-only (no org context)",
			ref:     "web-search",
			wantErr: ErrOrgRequired,
		},
		{
			name:    "empty string",
			ref:     "",
			wantErr: ErrEmptyRef,
		},
		{
			name:    "empty org in explicit ref",
			ref:     "/slug",
			wantErr: ErrEmptyOrg,
		},
		{
			name:    "empty slug in explicit ref",
			ref:     "org/",
			wantErr: ErrEmptySlug,
		},
		{
			name:    "empty slug with version",
			ref:     "org/@v1.0",
			wantErr: ErrEmptySlug,
		},
		{
			name:    "slug-only with version",
			ref:     "web-search@v1.0",
			wantErr: ErrOrgRequired,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

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

			sub.AddSkill(tt.ref)
		})
	}
}

// ============================================================================
// TryAddSkill Tests
// ============================================================================

func TestTryAddSkill(t *testing.T) {
	tests := []struct {
		name        string
		ref         string
		opts        []SkillOption
		wantOrg     string
		wantSlug    string
		wantVersion string
	}{
		{
			name:     "explicit org/slug",
			ref:      "stigmer/web-search",
			wantOrg:  "stigmer",
			wantSlug: "web-search",
		},
		{
			name:        "with version option",
			ref:         "stigmer/web-search",
			opts:        []SkillOption{AtVersion("v1.0")},
			wantOrg:     "stigmer",
			wantSlug:    "web-search",
			wantVersion: "v1.0",
		},
		{
			name:        "with version in string",
			ref:         "acme/code-review@stable",
			wantOrg:     "acme",
			wantSlug:    "code-review",
			wantVersion: "stable",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

			result, err := sub.TryAddSkill(tt.ref, tt.opts...)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if result != &sub {
				t.Error("TryAddSkill should return the same subagent")
			}

			if len(sub.skillRefs) != 1 {
				t.Fatalf("expected 1 skill ref, got %d", len(sub.skillRefs))
			}

			ref := sub.skillRefs[0]
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
		name    string
		ref     string
		wantErr error
	}{
		{
			name:    "slug-only (no org context)",
			ref:     "web-search",
			wantErr: ErrOrgRequired,
		},
		{
			name:    "empty string",
			ref:     "",
			wantErr: ErrEmptyRef,
		},
		{
			name:    "empty org",
			ref:     "/slug",
			wantErr: ErrEmptyOrg,
		},
		{
			name:    "empty slug",
			ref:     "org/",
			wantErr: ErrEmptySlug,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

			_, err := sub.TryAddSkill(tt.ref)
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

			// Verify subagent was not modified
			if len(sub.skillRefs) != 0 {
				t.Errorf("expected 0 skill refs after error, got %d", len(sub.skillRefs))
			}
		})
	}
}

// ============================================================================
// AddSkills Tests
// ============================================================================

func TestAddSkills(t *testing.T) {
	t.Run("multiple valid refs", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		result := sub.AddSkills(
			"stigmer/web-search",
			"acme/code-review",
			"stigmer/security@v2.0",
		)

		if result != &sub {
			t.Error("AddSkills should return the same subagent")
		}

		if len(sub.skillRefs) != 3 {
			t.Fatalf("expected 3 skill refs, got %d", len(sub.skillRefs))
		}

		// Verify first ref
		if sub.skillRefs[0].Org != "stigmer" || sub.skillRefs[0].Slug != "web-search" {
			t.Errorf("first ref = %s/%s, want stigmer/web-search",
				sub.skillRefs[0].Org, sub.skillRefs[0].Slug)
		}

		// Verify second ref
		if sub.skillRefs[1].Org != "acme" || sub.skillRefs[1].Slug != "code-review" {
			t.Errorf("second ref = %s/%s, want acme/code-review",
				sub.skillRefs[1].Org, sub.skillRefs[1].Slug)
		}

		// Verify third ref with version
		if sub.skillRefs[2].Org != "stigmer" || sub.skillRefs[2].Slug != "security" || sub.skillRefs[2].Version != "v2.0" {
			t.Errorf("third ref = %s/%s@%s, want stigmer/security@v2.0",
				sub.skillRefs[2].Org, sub.skillRefs[2].Slug, sub.skillRefs[2].Version)
		}
	})

	t.Run("empty list is no-op", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		result := sub.AddSkills()

		if result != &sub {
			t.Error("AddSkills should return the same subagent")
		}

		if len(sub.skillRefs) != 0 {
			t.Errorf("expected 0 skill refs, got %d", len(sub.skillRefs))
		}
	})

	t.Run("panics on first invalid ref - atomic", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		defer func() {
			r := recover()
			if r == nil {
				t.Fatal("expected panic, got none")
			}

			// Verify no refs were added (atomic operation)
			if len(sub.skillRefs) != 0 {
				t.Errorf("expected 0 skill refs after panic, got %d", len(sub.skillRefs))
			}
		}()

		sub.AddSkills(
			"stigmer/valid-skill",
			"", // Invalid - should panic
			"acme/another-valid",
		)
	})

	t.Run("panics on slug-only ref - atomic", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		defer func() {
			r := recover()
			if r == nil {
				t.Fatal("expected panic, got none")
			}

			err, ok := r.(error)
			if !ok {
				t.Fatalf("panic value is not an error: %v", r)
			}

			if !errors.Is(err, ErrOrgRequired) {
				t.Errorf("panic error = %v, want %v", err, ErrOrgRequired)
			}

			// Verify no refs were added (atomic operation)
			if len(sub.skillRefs) != 0 {
				t.Errorf("expected 0 skill refs after panic, got %d", len(sub.skillRefs))
			}
		}()

		sub.AddSkills(
			"stigmer/valid-skill",
			"slug-only", // Invalid - no org
			"acme/another-valid",
		)
	})
}

func TestTryAddSkills(t *testing.T) {
	t.Run("multiple valid refs", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		result, err := sub.TryAddSkills(
			"stigmer/web-search",
			"acme/code-review",
		)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if result != &sub {
			t.Error("TryAddSkills should return the same subagent")
		}

		if len(sub.skillRefs) != 2 {
			t.Fatalf("expected 2 skill refs, got %d", len(sub.skillRefs))
		}
	})

	t.Run("error on invalid ref - atomic", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		_, err := sub.TryAddSkills(
			"stigmer/valid-skill",
			"", // Invalid
			"acme/another-valid",
		)
		if err == nil {
			t.Fatal("expected error, got nil")
		}

		// Verify no refs were added (atomic operation)
		if len(sub.skillRefs) != 0 {
			t.Errorf("expected 0 skill refs after error, got %d", len(sub.skillRefs))
		}
	})

	t.Run("error on slug-only ref - atomic", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		_, err := sub.TryAddSkills(
			"stigmer/valid-skill",
			"slug-only", // Invalid - no org
		)
		if err == nil {
			t.Fatal("expected error, got nil")
		}

		if !errors.Is(err, ErrOrgRequired) {
			t.Errorf("error = %v, want %v", err, ErrOrgRequired)
		}

		// Verify no refs were added (atomic operation)
		if len(sub.skillRefs) != 0 {
			t.Errorf("expected 0 skill refs after error, got %d", len(sub.skillRefs))
		}
	})

	t.Run("empty list is no-op", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		result, err := sub.TryAddSkills()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if result != &sub {
			t.Error("TryAddSkills should return the same subagent")
		}
	})
}

// ============================================================================
// Chaining Tests
// ============================================================================

func TestChaining(t *testing.T) {
	sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

	// Chain skill additions with MCP access grants
	sub.
		AddSkill("stigmer/web-search").
		AddSkill("acme/code-review@v1.0").
		GrantMcpAccess("github", "create_pr").
		AddSkill("stigmer/security@v2.0")

	if len(sub.skillRefs) != 3 {
		t.Errorf("expected 3 skill refs, got %d", len(sub.skillRefs))
	}

	if len(sub.mcpAccess) != 1 {
		t.Errorf("expected 1 mcp access grant, got %d", len(sub.mcpAccess))
	}

	// Verify skills in order
	expectedSkills := []struct {
		org     string
		slug    string
		version string
	}{
		{"stigmer", "web-search", ""},
		{"acme", "code-review", "v1.0"},
		{"stigmer", "security", "v2.0"},
	}

	for i, expected := range expectedSkills {
		if sub.skillRefs[i].Org != expected.org {
			t.Errorf("skill[%d].Org = %q, want %q", i, sub.skillRefs[i].Org, expected.org)
		}
		if sub.skillRefs[i].Slug != expected.slug {
			t.Errorf("skill[%d].Slug = %q, want %q", i, sub.skillRefs[i].Slug, expected.slug)
		}
		if sub.skillRefs[i].Version != expected.version {
			t.Errorf("skill[%d].Version = %q, want %q", i, sub.skillRefs[i].Version, expected.version)
		}
	}

	// Verify MCP access
	if sub.mcpAccess[0].McpServer != "github" {
		t.Errorf("mcp access server = %q, want %q", sub.mcpAccess[0].McpServer, "github")
	}
}

func TestChainingWithAddSkills(t *testing.T) {
	sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

	sub.
		AddSkills("stigmer/skill-a", "acme/skill-b").
		GrantMcpAccess("github").
		AddSkill("stigmer/skill-c@v1.0")

	if len(sub.skillRefs) != 3 {
		t.Errorf("expected 3 skill refs, got %d", len(sub.skillRefs))
	}

	if len(sub.mcpAccess) != 1 {
		t.Errorf("expected 1 mcp access grant, got %d", len(sub.mcpAccess))
	}
}

// ============================================================================
// Thread Safety Tests
// ============================================================================

func TestAddSkillConcurrent(t *testing.T) {
	sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

	var wg sync.WaitGroup
	numGoroutines := 100

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			sub.AddSkill("stigmer/skill-" + string(rune('a'+n%26)))
		}(i)
	}

	wg.Wait()

	if len(sub.skillRefs) != numGoroutines {
		t.Errorf("expected %d skill refs, got %d", numGoroutines, len(sub.skillRefs))
	}
}

func TestGrantMcpAccessConcurrent(t *testing.T) {
	sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

	var wg sync.WaitGroup
	numGoroutines := 100

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			sub.GrantMcpAccess("server-"+string(rune('a'+n%26)), "tool1", "tool2")
		}(i)
	}

	wg.Wait()

	if len(sub.mcpAccess) != numGoroutines {
		t.Errorf("expected %d mcp access grants, got %d", numGoroutines, len(sub.mcpAccess))
	}
}

func TestMixedConcurrent(t *testing.T) {
	sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

	var wg sync.WaitGroup
	numGoroutines := 50

	// Add skills concurrently
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			sub.AddSkill("stigmer/skill-" + string(rune('a'+n%26)))
		}(i)
	}

	// Grant MCP access concurrently
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			sub.GrantMcpAccess("server-" + string(rune('a'+n%26)))
		}(i)
	}

	wg.Wait()

	if len(sub.skillRefs) != numGoroutines {
		t.Errorf("expected %d skill refs, got %d", numGoroutines, len(sub.skillRefs))
	}

	if len(sub.mcpAccess) != numGoroutines {
		t.Errorf("expected %d mcp access grants, got %d", numGoroutines, len(sub.mcpAccess))
	}
}

func TestTryAddSkillConcurrent(t *testing.T) {
	sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

	var wg sync.WaitGroup
	numGoroutines := 100
	errCount := 0
	var errMu sync.Mutex

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_, err := sub.TryAddSkill("stigmer/skill-" + string(rune('a'+n%26)))
			if err != nil {
				errMu.Lock()
				errCount++
				errMu.Unlock()
			}
		}(i)
	}

	wg.Wait()

	if errCount != 0 {
		t.Errorf("expected 0 errors, got %d", errCount)
	}

	if len(sub.skillRefs) != numGoroutines {
		t.Errorf("expected %d skill refs, got %d", numGoroutines, len(sub.skillRefs))
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
		want := `subagent: cannot parse "bad-input": something went wrong`
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
		want := `subagent: reference string is empty`
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

	t.Run("errors.As works correctly", func(t *testing.T) {
		err := &RefParseError{
			Ref:     "invalid",
			Message: "test message",
			Err:     ErrEmptySlug,
		}

		var parseErr *RefParseError
		if !errors.As(err, &parseErr) {
			t.Error("errors.As should return true for RefParseError")
		}

		if parseErr.Ref != "invalid" {
			t.Errorf("Ref = %q, want %q", parseErr.Ref, "invalid")
		}
	})
}

// ============================================================================
// Skill Kind Tests
// ============================================================================

func TestKindIsCorrect(t *testing.T) {
	sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

	sub.AddSkill("stigmer/web-search")

	// Verify skill kind
	if sub.skillRefs[0].Kind != apiresourcekind.ApiResourceKind_skill {
		t.Errorf("skill kind = %v, want skill", sub.skillRefs[0].Kind)
	}
}

// ============================================================================
// Edge Cases
// ============================================================================

func TestEdgeCases(t *testing.T) {
	t.Run("unicode in org and slug", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		// This should work - unicode is valid in org/slug
		sub.AddSkill("組織/スキル")

		if len(sub.skillRefs) != 1 {
			t.Fatalf("expected 1 skill ref, got %d", len(sub.skillRefs))
		}

		if sub.skillRefs[0].Org != "組織" {
			t.Errorf("Org = %q, want %q", sub.skillRefs[0].Org, "組織")
		}
		if sub.skillRefs[0].Slug != "スキル" {
			t.Errorf("Slug = %q, want %q", sub.skillRefs[0].Slug, "スキル")
		}
	})

	t.Run("very long org and slug", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		longOrg := "org" + string(make([]byte, 100))
		longSlug := "slug" + string(make([]byte, 100))

		// This should work - no length validation in parsing
		sub.AddSkill(longOrg + "/" + longSlug)

		if len(sub.skillRefs) != 1 {
			t.Fatalf("expected 1 skill ref, got %d", len(sub.skillRefs))
		}
	})

	t.Run("version with special characters", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		sub.AddSkill("stigmer/skill@v1.0-beta+build.123")

		if len(sub.skillRefs) != 1 {
			t.Fatalf("expected 1 skill ref, got %d", len(sub.skillRefs))
		}

		if sub.skillRefs[0].Version != "v1.0-beta+build.123" {
			t.Errorf("Version = %q, want %q", sub.skillRefs[0].Version, "v1.0-beta+build.123")
		}
	})

	t.Run("empty version after @", func(t *testing.T) {
		sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

		// "org/slug@" results in empty version
		sub.AddSkill("stigmer/skill@")

		if len(sub.skillRefs) != 1 {
			t.Fatalf("expected 1 skill ref, got %d", len(sub.skillRefs))
		}

		// Empty version is allowed (resolved at runtime)
		if sub.skillRefs[0].Version != "" {
			t.Errorf("Version = %q, want empty", sub.skillRefs[0].Version)
		}
	})
}

// ============================================================================
// SkillOption Tests
// ============================================================================

func TestAtVersion(t *testing.T) {
	t.Run("applies version correctly", func(t *testing.T) {
		opts := applySkillOptions(AtVersion("v1.0"))

		if opts.version != "v1.0" {
			t.Errorf("version = %q, want %q", opts.version, "v1.0")
		}
	})

	t.Run("empty version", func(t *testing.T) {
		opts := applySkillOptions(AtVersion(""))

		if opts.version != "" {
			t.Errorf("version = %q, want empty", opts.version)
		}
	})

	t.Run("multiple options - last wins", func(t *testing.T) {
		opts := applySkillOptions(
			AtVersion("v1.0"),
			AtVersion("v2.0"),
		)

		if opts.version != "v2.0" {
			t.Errorf("version = %q, want %q", opts.version, "v2.0")
		}
	})

	t.Run("no options", func(t *testing.T) {
		opts := applySkillOptions()

		if opts.version != "" {
			t.Errorf("version = %q, want empty", opts.version)
		}
	})
}

// ============================================================================
// Integration with Existing Methods
// ============================================================================

func TestIntegrationWithExistingMethods(t *testing.T) {
	sub, _ := New("test-sub", &Args{
		Instructions: "Test instructions for subagent integration testing",
		Description:  "A test subagent",
	})

	// Mix smart parsing with legacy methods
	sub.
		AddSkill("stigmer/smart-parsed-skill").
		AddOrgSkillRef("legacy", "org-skill-ref").
		GrantMcpAccess("github", "create_pr").
		AddSkill("acme/another-smart-skill@v1.0")

	// Verify counts
	if len(sub.skillRefs) != 3 {
		t.Errorf("expected 3 skill refs, got %d", len(sub.skillRefs))
	}

	if len(sub.mcpAccess) != 1 {
		t.Errorf("expected 1 mcp access grant, got %d", len(sub.mcpAccess))
	}

	// Verify smart-parsed skill
	if sub.skillRefs[0].Org != "stigmer" || sub.skillRefs[0].Slug != "smart-parsed-skill" {
		t.Errorf("first skill = %s/%s, want stigmer/smart-parsed-skill",
			sub.skillRefs[0].Org, sub.skillRefs[0].Slug)
	}

	// Verify legacy org skill
	if sub.skillRefs[1].Org != "legacy" || sub.skillRefs[1].Slug != "org-skill-ref" {
		t.Errorf("second skill = %s/%s, want legacy/org-skill-ref",
			sub.skillRefs[1].Org, sub.skillRefs[1].Slug)
	}

	// Verify versioned skill
	if sub.skillRefs[2].Version != "v1.0" {
		t.Errorf("third skill version = %q, want %q", sub.skillRefs[2].Version, "v1.0")
	}
}

// ============================================================================
// Comparison with Agent Behavior (Documents Intentional Differences)
// ============================================================================

func TestSlugOnlyNotSupported(t *testing.T) {
	// This test documents that SubAgent intentionally does NOT support
	// slug-only references like Agent does, because SubAgent has no Org field.

	sub, _ := New("test-sub", &Args{Instructions: "Test instructions for subagent"})

	_, err := sub.TryAddSkill("web-search") // No slash - slug only
	if err == nil {
		t.Fatal("expected error for slug-only reference, got nil")
	}

	if !errors.Is(err, ErrOrgRequired) {
		t.Errorf("error = %v, want %v", err, ErrOrgRequired)
	}

	// Verify the error message explains why
	var parseErr *RefParseError
	if errors.As(err, &parseErr) {
		if parseErr.Message == "" {
			t.Error("error message should not be empty")
		}
	}
}
