package ref

import (
	"errors"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestSkill(t *testing.T) {
	tests := []struct {
		name        string
		org         string
		slug        string
		opts        []SkillOption
		wantOrg     string
		wantSlug    string
		wantVersion string
	}{
		{
			name:        "basic org/slug",
			org:         "stigmer",
			slug:        "web-search",
			wantOrg:     "stigmer",
			wantSlug:    "web-search",
			wantVersion: "",
		},
		{
			name:        "with version tag",
			org:         "stigmer",
			slug:        "code-review",
			opts:        []SkillOption{WithVersion("v1.0")},
			wantOrg:     "stigmer",
			wantSlug:    "code-review",
			wantVersion: "v1.0",
		},
		{
			name:        "with stable tag",
			org:         "acme",
			slug:        "internal-docs",
			opts:        []SkillOption{WithVersion("stable")},
			wantOrg:     "acme",
			wantSlug:    "internal-docs",
			wantVersion: "stable",
		},
		{
			name:        "with latest version",
			org:         "stigmer",
			slug:        "test-skill",
			opts:        []SkillOption{WithVersion("latest")},
			wantOrg:     "stigmer",
			wantSlug:    "test-skill",
			wantVersion: "latest",
		},
		{
			name:        "with exact hash",
			org:         "stigmer",
			slug:        "immutable",
			opts:        []SkillOption{WithVersion("abc123def456abc123def456abc123def456abc123def456abc123def456abc123")},
			wantOrg:     "stigmer",
			wantSlug:    "immutable",
			wantVersion: "abc123def456abc123def456abc123def456abc123def456abc123def456abc123",
		},
		{
			name:        "empty version option is no-op",
			org:         "org",
			slug:        "slug",
			opts:        []SkillOption{WithVersion("")},
			wantOrg:     "org",
			wantSlug:    "slug",
			wantVersion: "",
		},
		{
			name:        "hyphenated names",
			org:         "acme-corp",
			slug:        "my-custom-skill",
			wantOrg:     "acme-corp",
			wantSlug:    "my-custom-skill",
			wantVersion: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ref := Skill(tt.org, tt.slug, tt.opts...)

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

func TestParseSkill(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantOrg     string
		wantSlug    string
		wantVersion string
		wantErr     error
	}{
		{
			name:     "basic org/slug",
			input:    "stigmer/web-search",
			wantOrg:  "stigmer",
			wantSlug: "web-search",
		},
		{
			name:        "with version",
			input:       "stigmer/web-search@v1.0",
			wantOrg:     "stigmer",
			wantSlug:    "web-search",
			wantVersion: "v1.0",
		},
		{
			name:        "with stable tag",
			input:       "acme/internal-docs@stable",
			wantOrg:     "acme",
			wantSlug:    "internal-docs",
			wantVersion: "stable",
		},
		{
			name:        "with latest version",
			input:       "stigmer/test@latest",
			wantOrg:     "stigmer",
			wantSlug:    "test",
			wantVersion: "latest",
		},
		{
			name:        "with hash version",
			input:       "stigmer/immutable@abc123",
			wantOrg:     "stigmer",
			wantSlug:    "immutable",
			wantVersion: "abc123",
		},
		{
			name:     "hyphenated names",
			input:    "acme-corp/my-custom-skill",
			wantOrg:  "acme-corp",
			wantSlug: "my-custom-skill",
		},
		{
			name:    "empty string",
			input:   "",
			wantErr: ErrInvalidFormat,
		},
		{
			name:    "no slash",
			input:   "just-slug",
			wantErr: ErrInvalidFormat,
		},
		{
			name:    "empty org",
			input:   "/slug",
			wantErr: ErrEmptyOrg,
		},
		{
			name:    "empty slug",
			input:   "org/",
			wantErr: ErrEmptySlug,
		},
		{
			name:    "empty slug with version",
			input:   "org/@v1.0",
			wantErr: ErrEmptySlug,
		},
		{
			name:     "multiple slashes uses first",
			input:    "org/slug/extra",
			wantOrg:  "org",
			wantSlug: "slug/extra",
		},
		{
			name:        "version with @ in it uses last @",
			input:       "org/slug@email@domain.com",
			wantOrg:     "org",
			wantSlug:    "slug@email",
			wantVersion: "domain.com",
		},
		{
			name:     "numbers in names",
			input:    "org123/skill456",
			wantOrg:  "org123",
			wantSlug: "skill456",
		},
		{
			name:     "dots in slug",
			input:    "acme/api.v2",
			wantOrg:  "acme",
			wantSlug: "api.v2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ref, err := ParseSkill(tt.input)

			if tt.wantErr != nil {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("error = %v, want %v", err, tt.wantErr)
				}
				// Verify it's a ParseError
				var parseErr *ParseError
				if !errors.As(err, &parseErr) {
					t.Errorf("expected ParseError, got %T", err)
				} else if parseErr.Kind != skillKind {
					t.Errorf("ParseError.Kind = %q, want %q", parseErr.Kind, skillKind)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

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

func TestMustParseSkill(t *testing.T) {
	t.Run("valid reference", func(t *testing.T) {
		ref := MustParseSkill("stigmer/web-search")
		if ref.Org != "stigmer" {
			t.Errorf("Org = %q, want %q", ref.Org, "stigmer")
		}
		if ref.Slug != "web-search" {
			t.Errorf("Slug = %q, want %q", ref.Slug, "web-search")
		}
	})

	t.Run("valid reference with version", func(t *testing.T) {
		ref := MustParseSkill("stigmer/web-search@v1.0")
		if ref.Org != "stigmer" {
			t.Errorf("Org = %q, want %q", ref.Org, "stigmer")
		}
		if ref.Slug != "web-search" {
			t.Errorf("Slug = %q, want %q", ref.Slug, "web-search")
		}
		if ref.Version != "v1.0" {
			t.Errorf("Version = %q, want %q", ref.Version, "v1.0")
		}
	})

	t.Run("panics on invalid", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseSkill("") // Should panic
	})

	t.Run("panics on missing slash", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseSkill("no-slash") // Should panic
	})

	t.Run("panics on empty org", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseSkill("/slug") // Should panic
	})

	t.Run("panics on empty slug", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseSkill("org/") // Should panic
	})
}

func TestSkillKindIsSkill(t *testing.T) {
	// Verify all creation methods return skill kind
	refs := []struct {
		name string
		fn   func() interface{}
	}{
		{"Skill", func() interface{} { return Skill("org", "slug") }},
		{"Skill with version", func() interface{} { return Skill("org", "slug", WithVersion("v1")) }},
		{"ParseSkill", func() interface{} { ref, _ := ParseSkill("org/slug"); return ref }},
		{"MustParseSkill", func() interface{} { return MustParseSkill("org/slug") }},
	}

	for _, tt := range refs {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.fn()
			if result == nil {
				t.Fatal("got nil result")
			}
			// Type assert since we return interface{}
			ref, ok := result.(interface {
				GetKind() apiresourcekind.ApiResourceKind
			})
			if !ok {
				t.Fatal("result doesn't have GetKind method")
			}
			if ref.GetKind() != apiresourcekind.ApiResourceKind_skill {
				t.Errorf("Kind = %v, want skill", ref.GetKind())
			}
		})
	}
}
