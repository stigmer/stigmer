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

func TestBuildResourceURI(t *testing.T) {
	tests := []struct {
		name string
		kind string
		org  string
		slug string
		want string
	}{
		{
			name: "agent",
			kind: "agent",
			org:  "acme",
			slug: "code-reviewer",
			want: "stigmer://agents/acme/code-reviewer",
		},
		{
			name: "skill",
			kind: "skill",
			org:  "acme",
			slug: "deploy-k8s",
			want: "stigmer://skills/acme/deploy-k8s",
		},
		{
			name: "workflow",
			kind: "workflow",
			org:  "acme",
			slug: "ci-pipeline",
			want: "stigmer://workflows/acme/ci-pipeline",
		},
		{
			name: "mcp_server has no resource template",
			kind: "mcp_server",
			org:  "acme",
			slug: "my-server",
			want: "",
		},
		{
			name: "unknown kind",
			kind: "project",
			org:  "acme",
			slug: "foo",
			want: "",
		},
		{
			name: "empty kind",
			kind: "",
			org:  "acme",
			slug: "foo",
			want: "",
		},
		{
			name: "empty org",
			kind: "agent",
			org:  "",
			slug: "code-reviewer",
			want: "",
		},
		{
			name: "empty slug",
			kind: "agent",
			org:  "acme",
			slug: "",
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := domains.BuildResourceURI(tt.kind, tt.org, tt.slug)
			if got != tt.want {
				t.Errorf("BuildResourceURI(%q, %q, %q) = %q, want %q",
					tt.kind, tt.org, tt.slug, got, tt.want)
			}
		})
	}
}

func TestBuildResourceURI_roundTrip(t *testing.T) {
	uri := domains.BuildResourceURI("agent", "acme", "code-reviewer")
	org, slug, err := domains.ParseResourceURI(uri)
	if err != nil {
		t.Fatalf("ParseResourceURI(%q) failed: %v", uri, err)
	}
	if org != "acme" {
		t.Errorf("org = %q, want %q", org, "acme")
	}
	if slug != "code-reviewer" {
		t.Errorf("slug = %q, want %q", slug, "code-reviewer")
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
