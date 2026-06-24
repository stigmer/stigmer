package approval

import (
	"sort"
	"strings"
	"sync/atomic"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"google.golang.org/protobuf/proto"
)

// pendingApprovalDivergence is the process-lifetime count of seam divergences —
// times the message-scan and event-stream projections disagreed. It is the OSS
// divergence backstop: a monotonic counter the eventual source-of-truth flip is
// gated on (the rollout posture is "flip once this stays zero across a bake
// window"), readable by a metrics exporter or by tests. It NEVER gates runtime —
// the seam always returns the message-scan result regardless of this count.
var pendingApprovalDivergence atomic.Int64

// PendingApprovalDivergenceCount returns the process-lifetime number of times the
// pending_approvals message-scan and event-stream projections diverged at the
// seam. Exposed for the flip's deterministic gate and for tests; reading it has no
// side effects.
func PendingApprovalDivergenceCount() int64 {
	return pendingApprovalDivergence.Load()
}

// ProjectPendingApprovals is the single seam every caller uses to recompute
// pending_approvals. It exists so the approval projection has exactly one entry
// point per edition: the message scan stays authoritative, but the same call
// also projects the persisted approval-event stream and asserts the two agree.
//
// It is a PURE read — it never mutates the stream. Authoring the stream is the
// job of the EnsureApprovalRequests / RecordDecisionEvent commands (author.go),
// which callers run before this projection so the passed stream is current.
//
// "Pending" is execution-phase-aware: a terminal execution has no actionable
// approvals (the workflow that would resume a gated call is gone), so the seam
// returns empty for a terminal phase. Both projections collapse identically, so
// this both fixes a pre-existing edition split (OSS cleared a failed-at-gate
// execution's pending_approvals via an incidental message wipe while Cloud
// retained them) and makes every terminal-execution gate-exit correct without a
// per-call retraction event — retractions are reserved for in-flight orphans.
//
// The parity check projects the caller-supplied persisted stream (not a fresh
// re-derivation), so it is a genuine cross-writer guard: a decision the
// SubmitApproval writer failed to author shows up here as a divergence. It
// returns the message-scan result unchanged — callers keep their own assignment
// and persistence — and on divergence emits a structured warning (the signal
// monitoring alerts on) but never alters the returned value, so the event stream
// can never affect runtime behavior. When the source of truth flips in a later
// phase, it flips here, once, for all callers.
func ProjectPendingApprovals(
	phase agentexecutionv1.ExecutionPhase,
	messages []*agentexecutionv1.AgentMessage,
	subAgentExecutions []*agentexecutionv1.SubAgentExecution,
	stream *agentexecutionv1.ApprovalEventStream,
) []*agentexecutionv1.PendingApproval {
	if isTerminalExecution(phase) {
		return nil
	}

	fromScan := ComputePendingApprovals(messages, subAgentExecutions)

	fromEvents := ComputePendingApprovalsFromEvents(stream)

	if diff := diffPendingApprovals(fromScan, fromEvents); diff != "" {
		// Bump the monotonic backstop counter the flip is gated on, then emit the
		// structured signal monitoring alerts on. Behavior is never gated on either
		// — fromScan is always returned.
		pendingApprovalDivergence.Add(1)
		log.Warn().
			Str("signal", "hitl_pending_approvals_projection_divergence").
			Int("scan_count", len(fromScan)).
			Int("events_count", len(fromEvents)).
			Int64("divergence_total", pendingApprovalDivergence.Load()).
			Str("diff", diff).
			Msg("pending_approvals message-scan vs event-stream projection diverged")
	}

	return fromScan
}

// diffPendingApprovals compares two pending-approval sets order-independently by
// tool_call_id and returns a short, stable description of the differences, or ""
// when they are semantically equal. Used only to populate the divergence
// warning; it never affects the projection result.
func diffPendingApprovals(scan, events []*agentexecutionv1.PendingApproval) string {
	scanByID := indexByToolCallID(scan)
	eventsByID := indexByToolCallID(events)

	// A collision means a set carried the same tool_call_id twice — itself a
	// divergence-worthy bug, since pending approvals are a set keyed by call id.
	if len(scanByID) != len(scan) || len(eventsByID) != len(events) {
		return "duplicate tool_call_id within a projection set"
	}

	var diffs []string
	for id, pa := range scanByID {
		other, ok := eventsByID[id]
		if !ok {
			diffs = append(diffs, "only-in-scan:"+id)
			continue
		}
		if !proto.Equal(pa, other) {
			diffs = append(diffs, "field-mismatch:"+id)
		}
	}
	for id := range eventsByID {
		if _, ok := scanByID[id]; !ok {
			diffs = append(diffs, "only-in-events:"+id)
		}
	}

	sort.Strings(diffs)
	return strings.Join(diffs, ",")
}

func indexByToolCallID(list []*agentexecutionv1.PendingApproval) map[string]*agentexecutionv1.PendingApproval {
	m := make(map[string]*agentexecutionv1.PendingApproval, len(list))
	for _, pa := range list {
		m[pa.GetToolCallId()] = pa
	}
	return m
}
