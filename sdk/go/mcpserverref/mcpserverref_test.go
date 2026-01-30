package mcpserverref

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestPlatform(t *testing.T) {
	tests := []struct {
		name      string
		slug      string
		wantSlug  string
		wantScope apiresource.ApiResourceOwnerScope
		wantKind  apiresourcekind.ApiResourceKind
	}{
		{
			name:      "basic platform reference",
			slug:      "github",
			wantSlug:  "github",
			wantScope: apiresource.ApiResourceOwnerScope_platform,
			wantKind:  apiresourcekind.ApiResourceKind_mcp_server,
		},
		{
			name:      "aws platform reference",
			slug:      "aws",
			wantSlug:  "aws",
			wantScope: apiresource.ApiResourceOwnerScope_platform,
			wantKind:  apiresourcekind.ApiResourceKind_mcp_server,
		},
		{
			name:      "slack platform reference",
			slug:      "slack",
			wantSlug:  "slack",
			wantScope: apiresource.ApiResourceOwnerScope_platform,
			wantKind:  apiresourcekind.ApiResourceKind_mcp_server,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ref := Platform(tt.slug)

			if ref.Slug != tt.wantSlug {
				t.Errorf("Slug = %q, want %q", ref.Slug, tt.wantSlug)
			}
			if ref.Scope != tt.wantScope {
				t.Errorf("Scope = %v, want %v", ref.Scope, tt.wantScope)
			}
			if ref.Kind != tt.wantKind {
				t.Errorf("Kind = %v, want %v", ref.Kind, tt.wantKind)
			}
			if ref.Version != "" {
				t.Errorf("Version = %q, want empty", ref.Version)
			}
			if ref.Org != "" {
				t.Errorf("Org = %q, want empty", ref.Org)
			}
		})
	}
}

func TestOrganization(t *testing.T) {
	tests := []struct {
		name      string
		org       string
		slug      string
		wantOrg   string
		wantSlug  string
		wantScope apiresource.ApiResourceOwnerScope
		wantKind  apiresourcekind.ApiResourceKind
	}{
		{
			name:      "basic org reference",
			org:       "acme-corp",
			slug:      "internal-tools",
			wantOrg:   "acme-corp",
			wantSlug:  "internal-tools",
			wantScope: apiresource.ApiResourceOwnerScope_organization,
			wantKind:  apiresourcekind.ApiResourceKind_mcp_server,
		},
		{
			name:      "another org reference",
			org:       "my-org",
			slug:      "custom-server",
			wantOrg:   "my-org",
			wantSlug:  "custom-server",
			wantScope: apiresource.ApiResourceOwnerScope_organization,
			wantKind:  apiresourcekind.ApiResourceKind_mcp_server,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ref := Organization(tt.org, tt.slug)

			if ref.Org != tt.wantOrg {
				t.Errorf("Org = %q, want %q", ref.Org, tt.wantOrg)
			}
			if ref.Slug != tt.wantSlug {
				t.Errorf("Slug = %q, want %q", ref.Slug, tt.wantSlug)
			}
			if ref.Scope != tt.wantScope {
				t.Errorf("Scope = %v, want %v", ref.Scope, tt.wantScope)
			}
			if ref.Kind != tt.wantKind {
				t.Errorf("Kind = %v, want %v", ref.Kind, tt.wantKind)
			}
			if ref.Version != "" {
				t.Errorf("Version = %q, want empty", ref.Version)
			}
		})
	}
}

func TestPersonal(t *testing.T) {
	tests := []struct {
		name      string
		slug      string
		wantSlug  string
		wantScope apiresource.ApiResourceOwnerScope
		wantKind  apiresourcekind.ApiResourceKind
	}{
		{
			name:      "basic personal reference",
			slug:      "my-dev-tools",
			wantSlug:  "my-dev-tools",
			wantScope: apiresource.ApiResourceOwnerScope_identity_account,
			wantKind:  apiresourcekind.ApiResourceKind_mcp_server,
		},
		{
			name:      "another personal reference",
			slug:      "custom-mcp",
			wantSlug:  "custom-mcp",
			wantScope: apiresource.ApiResourceOwnerScope_identity_account,
			wantKind:  apiresourcekind.ApiResourceKind_mcp_server,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ref := Personal(tt.slug)

			if ref.Slug != tt.wantSlug {
				t.Errorf("Slug = %q, want %q", ref.Slug, tt.wantSlug)
			}
			if ref.Scope != tt.wantScope {
				t.Errorf("Scope = %v, want %v", ref.Scope, tt.wantScope)
			}
			if ref.Kind != tt.wantKind {
				t.Errorf("Kind = %v, want %v", ref.Kind, tt.wantKind)
			}
			if ref.Version != "" {
				t.Errorf("Version = %q, want empty", ref.Version)
			}
			if ref.Org != "" {
				t.Errorf("Org = %q, want empty for personal scope", ref.Org)
			}
		})
	}
}

func TestKindIsMcpServer(t *testing.T) {
	// Verify all functions return mcp_server kind (44)
	refs := []*apiresource.ApiResourceReference{
		Platform("test"),
		Organization("org", "test"),
		Personal("test"),
	}

	for i, ref := range refs {
		if ref.Kind != apiresourcekind.ApiResourceKind_mcp_server {
			t.Errorf("ref[%d].Kind = %v, want mcp_server (44)", i, ref.Kind)
		}
	}
}
