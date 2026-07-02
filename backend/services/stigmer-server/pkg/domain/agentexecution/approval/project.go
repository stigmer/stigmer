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
// times the now-authoritative event-stream projection disagreed with the legacy
// message scan. It is the OSS regression backstop: a monotonic counter that must
// stay zero, readable by a metrics exporter or by tests. It NEVER gates runtime —
// the seam always returns the event-stream result regardless of this count; a
// non-zero value means the retained scan cross-check caught the authoritative
// stream drifting and is a bug to investigate, not a fallback that kicks in.
var pendingApprovalDivergence atomic.Int64

// PendingApprovalDivergenceCount returns the process-lifetime number of times the
// pending_approvals event-stream projection diverged from the legacy message-scan
// cross-check at the seam. Exposed for the regression metric and for tests;
// reading it has no side effects.
func PendingApprovalDivergenceCount() int64 {
	return pendingApprovalDivergence.Load()
}

// ProjectPendingApprovals is the single seam every caller uses to recompute
// pending_approvals. It exists so the approval projection has exactly one entry
// point per edition: the persisted approval-event stream is the source of truth,
// and the same call also runs the message scan as a cross-check and asserts the
// two agree.
//
// It is a PURE read — it never mutates the stream. Authoring the stream is the
// job of the EnsureApprovalRequests / RecordDecisionEvent commands (author.go),
// which callers run before this projection so the passed stream is current. That
// author-then-project ordering is the seam's contract: the returned value is only
// as correct as the stream the caller has already brought up to date.
//
// "Pending" is execution-phase-aware: a terminal execution has no actionable
// approvals (the workflow that would resume a gated call is gone), so the seam
// returns empty for a terminal phase. Both projections collapse identically, so
// this both fixes a pre-existing edition split (OSS cleared a failed-at-gate
// execution's pending_approvals via an incidental message wipe while Cloud
// retained them) and makes every terminal-execution gate-exit correct without a
// per-call retraction event — retractions are reserved for in-flight orphans.
//
// The retained message scan is a cross-check, not the result: it projects the
// same authoritative inputs and, on any disagreement with the event stream, bumps
// the divergence counter and emits a structured warning (the signal monitoring
// alerts on) without ever altering the returned value. So the scan can no longer
// affect runtime behavior, but it still catches an event-authoring regression the
// moment one appears.
func ProjectPendingApprovals(
	phase agentexecutionv1.ExecutionPhase,
	messages []*agentexecutionv1.AgentMessage,
	subAgentExecutions []*agentexecutionv1.SubAgentExecution,
	stream *agentexecutionv1.ApprovalEventStream,
) []*agentexecutionv1.PendingApproval {
	if isTerminalExecution(phase) {
		return nil
	}

	fromEvents := ComputePendingApprovalsFromEvents(stream)

	fromScan := ComputePendingApprovals(messages, subAgentExecutions)

	if diff := diffPendingApprovals(fromScan, fromEvents); diff != "" {
		// Bump the monotonic regression counter, then emit the structured signal
		// monitoring alerts on. Behavior is never gated on either projection —
		// fromEvents (the source of truth) is always returned; the scan is only the
		// cross-check that detected the drift.
		pendingApprovalDivergence.Add(1)
		log.Warn().
			Str("signal", "hitl_pending_approvals_projection_divergence").
			Int("scan_count", len(fromScan)).
			Int("events_count", len(fromEvents)).
			Int64("divergence_total", pendingApprovalDivergence.Load()).
			Str("diff", diff).
			Msg("pending_approvals event-stream source of truth diverged from the message-scan cross-check")
	}

	return fromEvents
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
