package ref

import (
	"errors"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestEnvironment(t *testing.T) {
	tests := []struct {
		name     string
		org      string
		slug     string
		wantOrg  string
		wantSlug string
	}{
		{
			name:     "basic org/slug",
			org:      "acme",
			slug:     "production-aws",
			wantOrg:  "acme",
			wantSlug: "production-aws",
		},
		{
			name:     "staging environment",
			org:      "acme",
			slug:     "staging-gcp",
			wantOrg:  "acme",
			wantSlug: "staging-gcp",
		},
		{
			name:     "hyphenated org name",
			org:      "acme-corp",
			slug:     "development",
			wantOrg:  "acme-corp",
			wantSlug: "development",
		},
		{
			name:     "underscore in slug",
			org:      "my-org",
			slug:     "prod_secrets",
			wantOrg:  "my-org",
			wantSlug: "prod_secrets",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ref := Environment(tt.org, tt.slug)

			if ref.Org != tt.wantOrg {
				t.Errorf("Org = %q, want %q", ref.Org, tt.wantOrg)
			}
			if ref.Slug != tt.wantSlug {
				t.Errorf("Slug = %q, want %q", ref.Slug, tt.wantSlug)
			}
			if ref.Kind != apiresourcekind.ApiResourceKind_environment {
				t.Errorf("Kind = %v, want environment", ref.Kind)
			}
			// Environments don't support versioning
			if ref.Version != "" {
				t.Errorf("Version = %q, want empty (environments don't support versioning)", ref.Version)
			}
		})
	}
}

func TestParseEnvironment(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantOrg  string
		wantSlug string
		wantErr  error
	}{
		{
			name:     "basic org/slug",
			input:    "acme/production-aws",
			wantOrg:  "acme",
			wantSlug: "production-aws",
		},
		{
			name:     "staging environment",
			input:    "acme/staging-gcp",
			wantOrg:  "acme",
			wantSlug: "staging-gcp",
		},
		{
			name:     "hyphenated names",
			input:    "acme-corp/production-secrets",
			wantOrg:  "acme-corp",
			wantSlug: "production-secrets",
		},
		{
			name:     "underscore in slug",
			input:    "my-org/prod_secrets",
			wantOrg:  "my-org",
			wantSlug: "prod_secrets",
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
			name:     "multiple slashes uses first",
			input:    "org/slug/extra",
			wantOrg:  "org",
			wantSlug: "slug/extra",
		},
		{
			name:     "numbers in names",
			input:    "org123/env456",
			wantOrg:  "org123",
			wantSlug: "env456",
		},
		{
			name:     "dots in slug",
			input:    "acme/env.v2",
			wantOrg:  "acme",
			wantSlug: "env.v2",
		},
		{
			name:     "@ treated as part of slug",
			input:    "org/slug@v1",
			wantOrg:  "org",
			wantSlug: "slug@v1",
		},
		{
			name:     "multiple @ treated as part of slug",
			input:    "org/slug@email@domain.com",
			wantOrg:  "org",
			wantSlug: "slug@email@domain.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ref, err := ParseEnvironment(tt.input)

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
				} else if parseErr.Kind != environmentKind {
					t.Errorf("ParseError.Kind = %q, want %q", parseErr.Kind, environmentKind)
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
			if ref.Kind != apiresourcekind.ApiResourceKind_environment {
				t.Errorf("Kind = %v, want environment", ref.Kind)
			}
			// Environments don't support versioning
			if ref.Version != "" {
				t.Errorf("Version = %q, want empty (environments don't support versioning)", ref.Version)
			}
		})
	}
}

func TestMustParseEnvironment(t *testing.T) {
	t.Run("valid reference", func(t *testing.T) {
		ref := MustParseEnvironment("acme/production-aws")
		if ref.Org != "acme" {
			t.Errorf("Org = %q, want %q", ref.Org, "acme")
		}
		if ref.Slug != "production-aws" {
			t.Errorf("Slug = %q, want %q", ref.Slug, "production-aws")
		}
	})

	t.Run("valid reference with hyphenated names", func(t *testing.T) {
		ref := MustParseEnvironment("acme-corp/staging-secrets")
		if ref.Org != "acme-corp" {
			t.Errorf("Org = %q, want %q", ref.Org, "acme-corp")
		}
		if ref.Slug != "staging-secrets" {
			t.Errorf("Slug = %q, want %q", ref.Slug, "staging-secrets")
		}
	})

	t.Run("panics on invalid", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseEnvironment("") // Should panic
	})

	t.Run("panics on missing slash", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseEnvironment("no-slash") // Should panic
	})

	t.Run("panics on empty org", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseEnvironment("/slug") // Should panic
	})

	t.Run("panics on empty slug", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseEnvironment("org/") // Should panic
	})
}

func TestEnvironmentKindIsEnvironment(t *testing.T) {
	// Verify all creation methods return environment kind
	refs := []struct {
		name string
		fn   func() interface{}
	}{
		{"Environment", func() interface{} { return Environment("org", "slug") }},
		{"ParseEnvironment", func() interface{} { ref, _ := ParseEnvironment("org/slug"); return ref }},
		{"MustParseEnvironment", func() interface{} { return MustParseEnvironment("org/slug") }},
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
			if ref.GetKind() != apiresourcekind.ApiResourceKind_environment {
				t.Errorf("Kind = %v, want environment", ref.GetKind())
			}
		})
	}
}

func TestEnvironmentNoVersionSupport(t *testing.T) {
	// Environments do NOT support versioning - verify Version is always empty

	t.Run("Environment returns empty version", func(t *testing.T) {
		ref := Environment("org", "slug")
		if ref.Version != "" {
			t.Errorf("Version = %q, want empty", ref.Version)
		}
	})

	t.Run("ParseEnvironment returns empty version", func(t *testing.T) {
		ref, err := ParseEnvironment("org/slug")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ref.Version != "" {
			t.Errorf("Version = %q, want empty", ref.Version)
		}
	})

	t.Run("ParseEnvironment with @ in input treats it as part of slug", func(t *testing.T) {
		// Unlike ParseSkill which extracts version from @,
		// ParseEnvironment treats @ as part of the slug
		ref, err := ParseEnvironment("org/slug@v1")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// The @ and version become part of the slug
		if ref.Slug != "slug@v1" {
			t.Errorf("Slug = %q, want %q", ref.Slug, "slug@v1")
		}
		if ref.Version != "" {
			t.Errorf("Version = %q, want empty", ref.Version)
		}
	})
}
