package approval

import (
	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// MergePendingApprovals merges incoming PendingApproval entries with existing
// ones using upsert-by-tool_call_id semantics, forward-only lifecycle
// enforcement, and post-merge pruning of resolved entries.
//
// Algorithm:
//  1. If incoming is empty, return existing unchanged
//  2. Build a map of existing PAs by ToolCallId
//  3. For each incoming PA:
//     - Skip if ToolCallId is empty (backward compat with old sentinels)
//     - If existing PA found: keep the one with higher LifecycleState
//     - If no existing PA: add as new entry
//  4. Preserve existing PAs not present in incoming list
//  5. Prune entries where LifecycleState >= RESUME_RECONCILED
func MergePendingApprovals(
	existing []*agentexecutionv1.PendingApproval,
	incoming []*agentexecutionv1.PendingApproval,
) []*agentexecutionv1.PendingApproval {
	if len(incoming) == 0 {
		result := make([]*agentexecutionv1.PendingApproval, len(existing))
		copy(result, existing)
		return result
	}

	type entry struct {
		pa    *agentexecutionv1.PendingApproval
		order int
	}
	merged := make(map[string]*entry)
	nextOrder := 0

	for _, pa := range existing {
		if pa.GetToolCallId() != "" {
			merged[pa.GetToolCallId()] = &entry{pa: pa, order: nextOrder}
			nextOrder++
		}
	}

	for _, incomingPA := range incoming {
		toolCallID := incomingPA.GetToolCallId()

		if toolCallID == "" {
			log.Debug().Msg("Skipping incoming PendingApproval with empty tool_call_id (backward compat sentinel)")
			continue
		}

		existingEntry, found := merged[toolCallID]
		if found {
			if incomingPA.GetLifecycleState() >= existingEntry.pa.GetLifecycleState() {
				log.Debug().
					Str("tool_call_id", toolCallID).
					Str("from", existingEntry.pa.GetLifecycleState().String()).
					Str("to", incomingPA.GetLifecycleState().String()).
					Msg("Upsert PendingApproval")
				existingEntry.pa = incomingPA
			} else {
				log.Debug().
					Str("tool_call_id", toolCallID).
					Str("existing", existingEntry.pa.GetLifecycleState().String()).
					Str("incoming", incomingPA.GetLifecycleState().String()).
					Msg("Keeping existing PendingApproval (forward-only)")
			}
		} else {
			merged[toolCallID] = &entry{pa: incomingPA, order: nextOrder}
			nextOrder++
			log.Debug().
				Str("tool_call_id", toolCallID).
				Str("lifecycle", incomingPA.GetLifecycleState().String()).
				Msg("Adding new PendingApproval")
		}
	}

	sorted := make([]*entry, 0, len(merged))
	for _, e := range merged {
		sorted = append(sorted, e)
	}
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[i].order > sorted[j].order {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	result := make([]*agentexecutionv1.PendingApproval, 0, len(sorted))
	for _, e := range sorted {
		if e.pa.GetLifecycleState() < agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_RESUME_RECONCILED {
			result = append(result, e.pa)
		} else {
			log.Debug().
				Str("tool_call_id", e.pa.GetToolCallId()).
				Str("lifecycle", e.pa.GetLifecycleState().String()).
				Msg("Pruning resolved PendingApproval")
		}
	}

	return result
}
