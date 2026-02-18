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

func TestParseVersionedResourceURI(t *testing.T) {
	tests := []struct {
		name    string
		uri     string
		wantOrg string
		wantSl  string
		wantVer string
		wantErr bool
	}{
		{
			name:    "two segments returns empty version",
			uri:     "stigmer://skills/acme/deploy-k8s",
			wantOrg: "acme",
			wantSl:  "deploy-k8s",
			wantVer: "",
		},
		{
			name:    "three segments with tag version",
			uri:     "stigmer://skills/acme/deploy-k8s/stable",
			wantOrg: "acme",
			wantSl:  "deploy-k8s",
			wantVer: "stable",
		},
		{
			name:    "three segments with sha256 version",
			uri:     "stigmer://skills/acme/deploy-k8s/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			wantOrg: "acme",
			wantSl:  "deploy-k8s",
			wantVer: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		},
		{
			name:    "three segments with semver-style tag",
			uri:     "stigmer://skills/stigmer/go-linter/v2.1.0",
			wantOrg: "stigmer",
			wantSl:  "go-linter",
			wantVer: "v2.1.0",
		},
		{
			name:    "works for agent kind",
			uri:     "stigmer://agents/acme/code-reviewer/beta",
			wantOrg: "acme",
			wantSl:  "code-reviewer",
			wantVer: "beta",
		},
		{
			name:    "works for workflow kind",
			uri:     "stigmer://workflows/myorg/deploy-pipeline/canary",
			wantOrg: "myorg",
			wantSl:  "deploy-pipeline",
			wantVer: "canary",
		},
		{
			name:    "trailing slash on two segments is tolerated",
			uri:     "stigmer://skills/acme/deploy-k8s/",
			wantOrg: "acme",
			wantSl:  "deploy-k8s",
			wantVer: "",
		},
		{
			name:    "trailing slash on three segments is tolerated",
			uri:     "stigmer://skills/acme/deploy-k8s/stable/",
			wantOrg: "acme",
			wantSl:  "deploy-k8s",
			wantVer: "stable",
		},
		{
			name:    "wrong scheme",
			uri:     "https://skills/acme/deploy-k8s/stable",
			wantErr: true,
		},
		{
			name:    "missing slug",
			uri:     "stigmer://skills/acme",
			wantErr: true,
		},
		{
			name:    "missing org and slug",
			uri:     "stigmer://skills",
			wantErr: true,
		},
		{
			name:    "too many segments",
			uri:     "stigmer://skills/acme/deploy-k8s/stable/extra",
			wantErr: true,
		},
		{
			name:    "empty string",
			uri:     "",
			wantErr: true,
		},
		{
			name:    "no scheme",
			uri:     "skills/acme/deploy-k8s/stable",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			org, slug, ver, err := domains.ParseVersionedResourceURI(tt.uri)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error for URI %q, got org=%q slug=%q version=%q", tt.uri, org, slug, ver)
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
			if ver != tt.wantVer {
				t.Errorf("version = %q, want %q", ver, tt.wantVer)
			}
		})
	}
}
