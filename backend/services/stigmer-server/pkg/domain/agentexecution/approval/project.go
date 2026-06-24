package approval

import (
	"sort"
	"strings"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"google.golang.org/protobuf/proto"
)

// ProjectPendingApprovals is the single seam every caller uses to recompute
// pending_approvals. It exists so the approval projection has exactly one entry
// point per edition: the message scan stays authoritative, but the same call
// also derives the shadow approval-event stream and asserts the two agree.
//
// It returns the message-scan result unchanged — callers keep their own
// assignment and persistence. On divergence it emits a structured warning (the
// signal monitoring alerts on) but never alters the returned value, so the
// shadow projection can never affect runtime behavior. When the source of truth
// flips in a later phase, it flips here, once, for all callers.
func ProjectPendingApprovals(
	messages []*agentexecutionv1.AgentMessage,
	subAgentExecutions []*agentexecutionv1.SubAgentExecution,
) []*agentexecutionv1.PendingApproval {
	fromScan := ComputePendingApprovals(messages, subAgentExecutions)

	stream := EmitApprovalEvents(messages, subAgentExecutions)
	fromEvents := ComputePendingApprovalsFromEvents(stream)

	if diff := diffPendingApprovals(fromScan, fromEvents); diff != "" {
		// OSS has no metrics facility in this domain yet, so this structured
		// warning IS the divergence signal; swap in a counter when one exists.
		// Behavior is never gated on it — fromScan is always returned.
		log.Warn().
			Str("signal", "hitl_pending_approvals_projection_divergence").
			Int("scan_count", len(fromScan)).
			Int("events_count", len(fromEvents)).
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
