package domains_test

import (
	"testing"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
)

func TestParseResourceURI(t *testing.T) {
	tests := []struct {
		name    string
		uri     string
		wantOrg string
		wantSl  string
		wantErr bool
	}{
		{
			name:    "valid agent URI",
			uri:     "stigmer://agents/acme/code-reviewer",
			wantOrg: "acme",
			wantSl:  "code-reviewer",
		},
		{
			name:    "valid skill URI",
			uri:     "stigmer://skills/stigmer/go-linter",
			wantOrg: "stigmer",
			wantSl:  "go-linter",
		},
		{
			name:    "valid workflow URI",
			uri:     "stigmer://workflows/myorg/deploy-pipeline",
			wantOrg: "myorg",
			wantSl:  "deploy-pipeline",
		},
		{
			name:    "trailing slash is tolerated",
			uri:     "stigmer://agents/acme/code-reviewer/",
			wantOrg: "acme",
			wantSl:  "code-reviewer",
		},
		{
			name:    "wrong scheme",
			uri:     "https://agents/acme/code-reviewer",
			wantErr: true,
		},
		{
			name:    "missing slug",
			uri:     "stigmer://agents/acme",
			wantErr: true,
		},
		{
			name:    "missing org and slug",
			uri:     "stigmer://agents",
			wantErr: true,
		},
		{
			name:    "too many segments",
			uri:     "stigmer://agents/acme/code-reviewer/extra",
			wantErr: true,
		},
		{
			name:    "empty string",
			uri:     "",
			wantErr: true,
		},
		{
			name:    "no scheme",
			uri:     "agents/acme/code-reviewer",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			org, slug, err := domains.ParseResourceURI(tt.uri)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error for URI %q, got org=%q slug=%q", tt.uri, org, slug)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for URI %q: %v", tt.uri, err)
			}
			if org != tt.wantOrg {
				t.Errorf("org = %q, want %q", org, tt.wantOrg)
			}
			if slug != tt.wantSl {
				t.Errorf("slug = %q, want %q", slug, tt.wantSl)
			}
		})
	}
}
