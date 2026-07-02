package approval

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// TestDeriveLeaseScope verifies the Go scope oracle stays in lockstep with the
// runner's deriveActiveLeases: a built-in leases its category, an MCP tool leases
// its server (slug wins), and an ungated/unknown tool has no scope.
func TestDeriveLeaseScope(t *testing.T) {
	tests := []struct {
		name       string
		toolName   string
		serverSlug string
		wantScope  LeaseScope
		wantOK     bool
	}{
		{"built-in write", "write_file", "", LeaseScope{Category: "write"}, true},
		{"built-in edit collapses to write", "edit_file", "", LeaseScope{Category: "write"}, true},
		{"built-in delete", "remove_file", "", LeaseScope{Category: "delete"}, true},
		{"built-in shell", "execute_command", "", LeaseScope{Category: "shell"}, true},
		{"mcp tool leases its server", "create_issue", "github", LeaseScope{Server: "github"}, true},
		{"slug wins over name lookup", "write_file", "weird-server", LeaseScope{Server: "weird-server"}, true},
		{"read-only built-in has no scope", "read", "", LeaseScope{}, false},
		{"unknown ungated name has no scope", "noop_tool", "", LeaseScope{}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tc := &agentexecutionv1.ToolCall{Name: tt.toolName, McpServerSlug: tt.serverSlug}
			scope, ok := DeriveLeaseScope(tc)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if scope != tt.wantScope {
				t.Errorf("scope = %+v, want %+v", scope, tt.wantScope)
			}
		})
	}
}
