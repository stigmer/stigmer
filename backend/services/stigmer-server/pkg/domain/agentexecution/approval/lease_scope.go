package approval

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// LeaseScope identifies the class of actions that a single APPROVE_ALL decision
// covers — the Go edition of the runner's ActiveLeases scope (see
// deriveActiveLeases in backend/services/runner/src/shared/approval-policy.ts).
//
// An APPROVE_ALL ("approve all of this kind") is no longer an all-or-nothing
// gate bypass: it grants a run-lifetime lease scoped to ONE class of action —
// the clicked tool's built-in category (write/delete/shell) for a built-in, or
// its MCP server for an MCP tool. Two tool calls belong to the same scope when
// their derived LeaseScope is equal, so the struct is intentionally comparable
// for direct == comparison.
//
// Exactly one of Category / Server is non-empty for a derivable scope; both are
// empty when the tool has no scope (a read-only built-in, an unknown name) — in
// which case DeriveLeaseScope returns ok=false and the caller treats it as
// matching nothing.
type LeaseScope struct {
	// Category is the built-in approval category (write/delete/shell); empty for MCP.
	Category string
	// Server is the MCP server slug; empty for a built-in.
	Server string
}

// DeriveLeaseScope reduces a tool call to the scope its APPROVE_ALL would lease.
//
// MCP server slug takes precedence over the built-in category lookup, matching
// the runner's deriveActiveLeases ordering byte-for-byte (a real built-in never
// carries a server slug and a real MCP tool never resolves to a category, so the
// order is parity insurance, not a behavioral choice). Returns ok=false for a
// tool with no leasable scope.
func DeriveLeaseScope(tc *agentexecutionv1.ToolCall) (LeaseScope, bool) {
	if slug := tc.GetMcpServerSlug(); slug != "" {
		return LeaseScope{Server: slug}, true
	}
	if category, ok := ToolApprovalCategory(tc.GetName()); ok {
		return LeaseScope{Category: category}, true
	}
	return LeaseScope{}, false
}
