package ref

import (
	"errors"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestMcpServer(t *testing.T) {
	tests := []struct {
		name     string
		org      string
		slug     string
		wantOrg  string
		wantSlug string
	}{
		{
			name:     "basic org/slug",
			org:      "stigmer",
			slug:     "github",
			wantOrg:  "stigmer",
			wantSlug: "github",
		},
		{
			name:     "internal tools",
			org:      "acme",
			slug:     "internal-tools",
			wantOrg:  "acme",
			wantSlug: "internal-tools",
		},
		{
			name:     "hyphenated org name",
			org:      "acme-corp",
			slug:     "slack-integration",
			wantOrg:  "acme-corp",
			wantSlug: "slack-integration",
		},
		{
			name:     "underscore in slug",
			org:      "my-org",
			slug:     "my_server",
			wantOrg:  "my-org",
			wantSlug: "my_server",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ref := McpServer(tt.org, tt.slug)

			if ref.Org != tt.wantOrg {
				t.Errorf("Org = %q, want %q", ref.Org, tt.wantOrg)
			}
			if ref.Slug != tt.wantSlug {
				t.Errorf("Slug = %q, want %q", ref.Slug, tt.wantSlug)
			}
			if ref.Kind != apiresourcekind.ApiResourceKind_mcp_server {
				t.Errorf("Kind = %v, want mcp_server", ref.Kind)
			}
			// MCP servers don't support versioning
			if ref.Version != "" {
				t.Errorf("Version = %q, want empty (MCP servers don't support versioning)", ref.Version)
			}
		})
	}
}

func TestParseMcpServer(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantOrg  string
		wantSlug string
		wantErr  error
	}{
		{
			name:     "basic org/slug",
			input:    "stigmer/github",
			wantOrg:  "stigmer",
			wantSlug: "github",
		},
		{
			name:     "internal tools",
			input:    "acme/internal-tools",
			wantOrg:  "acme",
			wantSlug: "internal-tools",
		},
		{
			name:     "hyphenated names",
			input:    "acme-corp/my-custom-server",
			wantOrg:  "acme-corp",
			wantSlug: "my-custom-server",
		},
		{
			name:     "underscore in slug",
			input:    "my-org/my_server",
			wantOrg:  "my-org",
			wantSlug: "my_server",
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
			input:    "org123/server456",
			wantOrg:  "org123",
			wantSlug: "server456",
		},
		{
			name:     "dots in slug",
			input:    "acme/api.v2",
			wantOrg:  "acme",
			wantSlug: "api.v2",
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
			ref, err := ParseMcpServer(tt.input)

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
				} else if parseErr.Kind != mcpServerKind {
					t.Errorf("ParseError.Kind = %q, want %q", parseErr.Kind, mcpServerKind)
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
			if ref.Kind != apiresourcekind.ApiResourceKind_mcp_server {
				t.Errorf("Kind = %v, want mcp_server", ref.Kind)
			}
			// MCP servers don't support versioning
			if ref.Version != "" {
				t.Errorf("Version = %q, want empty (MCP servers don't support versioning)", ref.Version)
			}
		})
	}
}

func TestMustParseMcpServer(t *testing.T) {
	t.Run("valid reference", func(t *testing.T) {
		ref := MustParseMcpServer("stigmer/github")
		if ref.Org != "stigmer" {
			t.Errorf("Org = %q, want %q", ref.Org, "stigmer")
		}
		if ref.Slug != "github" {
			t.Errorf("Slug = %q, want %q", ref.Slug, "github")
		}
	})

	t.Run("valid reference with hyphenated names", func(t *testing.T) {
		ref := MustParseMcpServer("acme-corp/internal-tools")
		if ref.Org != "acme-corp" {
			t.Errorf("Org = %q, want %q", ref.Org, "acme-corp")
		}
		if ref.Slug != "internal-tools" {
			t.Errorf("Slug = %q, want %q", ref.Slug, "internal-tools")
		}
	})

	t.Run("panics on invalid", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseMcpServer("") // Should panic
	})

	t.Run("panics on missing slash", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseMcpServer("no-slash") // Should panic
	})

	t.Run("panics on empty org", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseMcpServer("/slug") // Should panic
	})

	t.Run("panics on empty slug", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic, got none")
			}
		}()
		MustParseMcpServer("org/") // Should panic
	})
}

func TestMcpServerKindIsMcpServer(t *testing.T) {
	// Verify all creation methods return mcp_server kind
	refs := []struct {
		name string
		fn   func() interface{}
	}{
		{"McpServer", func() interface{} { return McpServer("org", "slug") }},
		{"ParseMcpServer", func() interface{} { ref, _ := ParseMcpServer("org/slug"); return ref }},
		{"MustParseMcpServer", func() interface{} { return MustParseMcpServer("org/slug") }},
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
			if ref.GetKind() != apiresourcekind.ApiResourceKind_mcp_server {
				t.Errorf("Kind = %v, want mcp_server", ref.GetKind())
			}
		})
	}
}

func TestMcpServerNoVersionSupport(t *testing.T) {
	// MCP servers do NOT support versioning - verify Version is always empty

	t.Run("McpServer returns empty version", func(t *testing.T) {
		ref := McpServer("org", "slug")
		if ref.Version != "" {
			t.Errorf("Version = %q, want empty", ref.Version)
		}
	})

	t.Run("ParseMcpServer returns empty version", func(t *testing.T) {
		ref, err := ParseMcpServer("org/slug")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ref.Version != "" {
			t.Errorf("Version = %q, want empty", ref.Version)
		}
	})

	t.Run("ParseMcpServer with @ in input treats it as part of slug", func(t *testing.T) {
		// Unlike ParseSkill which extracts version from @,
		// ParseMcpServer treats @ as part of the slug
		ref, err := ParseMcpServer("org/slug@v1")
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
