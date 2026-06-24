package approval

// Approval fingerprint — the Go edition of the exact-match enforcement identity
// for the HITL Tool Execution Gateway (Phase 2).
//
// A fingerprint is HMAC-SHA256(key, canonicalForm) over a canonicalized tool
// action (see canonicalize.go). Faithful port of the TS source of truth
// (backend/services/runner/src/shared/approval-fingerprint.ts). Enforcement is
// runner-side only; this edition exists to pin the contract: it must reproduce
// every `expected` in apis/testdata/hitl/fingerprint/vectors.json under the
// fixed test key, byte for byte. See that file's README for the two fidelities.
//
// Why HMAC and not a bare SHA-256 (binding decision,
// design-decisions/approval-fingerprint-vs-march-rollback.md, Rule 4): the
// fingerprint is an authorization token, not a correlation key, so it is keyed
// under a Stigmer-held secret a model cannot forge. In Phase 2 it is
// recompute-and-compare at one trusted layer, so the anti-forgery property is
// forward-looking; the Go/Java editions reproduce it so a future server-issued
// lease has one cross-language definition.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// ApprovalFingerprintVersion is prefixed to every fingerprint. Bumping it is the
// migration lever if the canonical form or MAC primitive changes: an old lease
// and a new computation will not compare equal, so a version skew re-asks (safe).
// Keep in lockstep with the TS/Java editions.
const ApprovalFingerprintVersion = "v1"

// CoarseToolIdentity is the substrate-coarsened identity of a tool action — the
// only fidelity the out-of-process Cursor deny-oracle hook can reproduce. Mirrors
// CoarseToolIdentity in TS.
type CoarseToolIdentity struct {
	Tool          string
	MCPServerSlug string
	Salient       string
}

// ComputeApprovalFingerprint is the full-fidelity fingerprint for the in-process
// deep-agent gateway. Distinct actions yield distinct fingerprints; the same
// action is byte-stable across re-invocations.
func ComputeApprovalFingerprint(key []byte, input ToolActionInput) (string, error) {
	canonical, err := CanonicalToolActionJSON(input)
	if err != nil {
		return "", err
	}
	return tagged(hmacHex(key, canonical)), nil
}

// CoarseToolIdentityOf reduces an input action to its coarse identity. `Tool` is
// the cross-taxonomy approval category for gated built-ins (write/delete/shell),
// the tool name for MCP tools, or the trimmed tool name otherwise; `Salient` is
// the single normalized resource (path or shell command), empty for MCP tools.
// Mirrors coarseToolIdentity in TS.
func CoarseToolIdentityOf(input ToolActionInput) CoarseToolIdentity {
	canonical := CanonicalizeToolAction(input)
	if canonical.MCPServerSlug != "" {
		return CoarseToolIdentity{
			Tool:          strings.TrimSpace(input.ToolName),
			MCPServerSlug: canonical.MCPServerSlug,
			Salient:       "",
		}
	}
	tool := strings.TrimSpace(input.ToolName)
	if category, ok := ToolApprovalCategory(input.ToolName); ok {
		tool = category
	}
	salient := ""
	if len(canonical.Paths) > 0 && canonical.Paths[0] != "" {
		salient = canonical.Paths[0]
	} else if canonical.ShellCommand != "" {
		salient = canonical.ShellCommand
	}
	return CoarseToolIdentity{Tool: tool, MCPServerSlug: canonical.MCPServerSlug, Salient: salient}
}

// FingerprintCoarseIdentity fingerprints an already-reduced coarse identity. Split
// out so a substrate that has already reduced a tool call to its (tool, slug,
// salient) identity fingerprints that exact identity through the one shared
// HMAC+canonical-JSON path. Mirrors fingerprintCoarseIdentity in TS.
func FingerprintCoarseIdentity(key []byte, identity CoarseToolIdentity) (string, error) {
	canonical, err := canonicalJSON(map[string]any{
		"tool":          identity.Tool,
		"mcpServerSlug": identity.MCPServerSlug,
		"salient":       identity.Salient,
	})
	if err != nil {
		return "", err
	}
	return tagged(hmacHex(key, canonical)), nil
}

// ComputeCoarseApprovalFingerprint is the coarse fingerprint for the Cursor hook.
// By construction, two actions that name the same operation in different
// taxonomies (Write vs edit) over the same resource collapse to one fingerprint.
func ComputeCoarseApprovalFingerprint(key []byte, input ToolActionInput) (string, error) {
	return FingerprintCoarseIdentity(key, CoarseToolIdentityOf(input))
}

// DeriveExecutionFingerprintKey derives the per-execution key from a runner-held
// master secret, scoped to one execution_id (stable across Temporal
// re-invocations, isolated between executions). Mirrors deriveExecutionFingerprintKey
// in TS.
func DeriveExecutionFingerprintKey(masterSecret []byte, executionID string) []byte {
	mac := hmac.New(sha256.New, masterSecret)
	mac.Write([]byte(executionID))
	return mac.Sum(nil)
}

func hmacHex(key []byte, canonical string) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(canonical))
	return hex.EncodeToString(mac.Sum(nil))
}

func tagged(mac string) string {
	return ApprovalFingerprintVersion + ":" + mac
}
