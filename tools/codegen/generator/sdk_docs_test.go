package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestDocDisplayName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Agent", "Agent"},
		{"AgentExecution", "Agent Execution"},
		{"McpServer", "MCP Server"},
		{"ApiKey", "API Key"},
		{"IamPolicy", "IAM Policy"},
		{"OAuthApp", "OAuth App"},
		{"Organization", "Organization"},
		{"IdentityProvider", "Identity Provider"},
		{"WorkflowExecution", "Workflow Execution"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := docDisplayName(tt.input)
			if got != tt.want {
				t.Errorf("docDisplayName(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestDocRemoveStalePages(t *testing.T) {
	dir := t.TempDir()
	seed := func(name string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0644); err != nil {
			t.Fatalf("failed to seed %s: %v", name, err)
		}
	}

	// Files a real generation run leaves behind, plus two stale pages and a
	// non-.mdx file that must never be touched.
	seed("agent.mdx")
	seed("commons.mdx")
	seed("meta.json")
	seed("platform-client-create-response.mdx") // stale: from an older generator version
	seed("zz-legacy.mdx")                       // stale
	if err := os.Mkdir(filepath.Join(dir, "nested"), 0755); err != nil {
		t.Fatalf("failed to create nested dir: %v", err)
	}

	removed, err := docRemoveStalePages(dir, []string{"agent", "commons"})
	if err != nil {
		t.Fatalf("docRemoveStalePages returned error: %v", err)
	}

	want := []string{"platform-client-create-response.mdx", "zz-legacy.mdx"}
	if !reflect.DeepEqual(removed, want) {
		t.Errorf("removed = %v, want %v", removed, want)
	}

	for _, name := range []string{"agent.mdx", "commons.mdx", "meta.json", "nested"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s should have been retained: %v", name, err)
		}
	}
	for _, name := range want {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Errorf("%s should have been deleted (stat err: %v)", name, err)
		}
	}
}

func TestDocRemoveStalePages_NothingStale(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "agent.mdx"), []byte("x"), 0644); err != nil {
		t.Fatalf("failed to seed agent.mdx: %v", err)
	}

	removed, err := docRemoveStalePages(dir, []string{"agent"})
	if err != nil {
		t.Fatalf("docRemoveStalePages returned error: %v", err)
	}
	if len(removed) != 0 {
		t.Errorf("removed = %v, want empty", removed)
	}
}

func TestDocSlug(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Agent", "agent"},
		{"AgentExecution", "agent-execution"},
		{"McpServer", "mcp-server"},
		{"ApiKey", "api-key"},
		{"IamPolicy", "iam-policy"},
		{"OAuthApp", "oauth-app"},
		{"IdentityProvider", "identity-provider"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := docSlug(tt.input)
			if got != tt.want {
				t.Errorf("docSlug(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
