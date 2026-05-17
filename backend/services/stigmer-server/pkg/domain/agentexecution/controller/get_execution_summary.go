package agentexecution

import (
	"context"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
)

// GetExecutionSummary returns aggregated agent execution statistics for
// the requested organization and time window. For OSS (single-user local),
// org filtering is a no-op — all executions are aggregated.
//
// Cost is intentionally excluded from this response. The dashboard sources
// cost from getOrgUsageReport (billing source of truth) to prevent
// double-counting when workflows delegate to agents. See AD-DASH-005.
//
// @since Unified Platform Dashboard
func (c *AgentExecutionController) GetExecutionSummary(
	ctx context.Context,
	req *agentexecutionv1.GetAgentExecutionSummaryRequest,
) (*agentexecutionv1.AgentExecutionSummary, error) {
	data, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_agent_execution)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list agent executions for summary")
	}

	cutoff := resolveAgentTimeCutoff(req.GetTimeWindow())

	phaseCounts := make(map[int32]int32)
	var activeCount int32
	var completedDurations []time.Duration
	failureCounts := make(map[string]int32)
	agentNames := make(map[string]string)

	for _, d := range data {
		exec := &agentexecutionv1.AgentExecution{}
		if err := proto.Unmarshal(d, exec); err != nil {
			continue
		}

		createdAt := agentAuditCreatedAt(exec)
		if !createdAt.IsZero() && !cutoff.IsZero() && createdAt.Before(cutoff) {
			continue
		}

		phase := exec.GetStatus().GetPhase()
		phaseCounts[int32(phase)]++

		if isAgentActivePhase(phase) {
			activeCount++
		}

		agentID := exec.GetSpec().GetAgentId()

		if phase == agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
			if d := agentCompletionDuration(exec); d > 0 {
				completedDurations = append(completedDurations, d)
			}
		}

		if phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED && agentID != "" {
			failureCounts[agentID]++
			if name := exec.GetMetadata().GetName(); name != "" {
				agentNames[agentID] = name
			}
		}
	}

	summary := &agentexecutionv1.AgentExecutionSummary{
		ActiveCount: activeCount,
		PhaseCounts: phaseCounts,
	}

	if len(completedDurations) > 0 {
		var total time.Duration
		for _, d := range completedDurations {
			total += d
		}
		avg := total / time.Duration(len(completedDurations))
		summary.AvgDuration = durationpb.New(avg)
	}

	summary.TopFailingAgents = buildAgentFailureRanks(failureCounts, agentNames, 10)

	return summary, nil
}

func resolveAgentTimeCutoff(tw agentexecutionv1.AgentExecutionSummaryTimeWindow) time.Time {
	now := time.Now()
	switch tw {
	case agentexecutionv1.AgentExecutionSummaryTimeWindow_AGENT_EXECUTION_SUMMARY_TIME_WINDOW_LAST_24H:
		return now.Add(-24 * time.Hour)
	case agentexecutionv1.AgentExecutionSummaryTimeWindow_AGENT_EXECUTION_SUMMARY_TIME_WINDOW_LAST_7D:
		return now.Add(-7 * 24 * time.Hour)
	case agentexecutionv1.AgentExecutionSummaryTimeWindow_AGENT_EXECUTION_SUMMARY_TIME_WINDOW_LAST_30D:
		return now.Add(-30 * 24 * time.Hour)
	case agentexecutionv1.AgentExecutionSummaryTimeWindow_AGENT_EXECUTION_SUMMARY_TIME_WINDOW_ALL_TIME:
		return time.Time{}
	default:
		return now.Add(-7 * 24 * time.Hour)
	}
}

func isAgentActivePhase(p agentexecutionv1.ExecutionPhase) bool {
	return p == agentexecutionv1.ExecutionPhase_EXECUTION_PENDING ||
		p == agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS ||
		p == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL ||
		p == agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED
}

func agentAuditCreatedAt(exec *agentexecutionv1.AgentExecution) time.Time {
	ts := exec.GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
	if ts == nil {
		return time.Time{}
	}
	return ts.AsTime()
}

func agentCompletionDuration(exec *agentexecutionv1.AgentExecution) time.Duration {
	started := exec.GetStatus().GetStartedAt()
	completed := exec.GetStatus().GetCompletedAt()
	if started == "" || completed == "" {
		return 0
	}
	s, err1 := time.Parse(time.RFC3339, started)
	c, err2 := time.Parse(time.RFC3339, completed)
	if err1 != nil || err2 != nil {
		return 0
	}
	return c.Sub(s)
}

type agentFailureEntry struct {
	agentID string
	count   int32
}

func buildAgentFailureRanks(
	counts map[string]int32,
	names map[string]string,
	limit int,
) []*agentexecutionv1.AgentFailureRank {
	entries := make([]agentFailureEntry, 0, len(counts))
	for id, count := range counts {
		entries = append(entries, agentFailureEntry{id, count})
	}
	for i := 1; i < len(entries); i++ {
		for j := i; j > 0 && entries[j].count > entries[j-1].count; j-- {
			entries[j], entries[j-1] = entries[j-1], entries[j]
		}
	}
	if len(entries) > limit {
		entries = entries[:limit]
	}
	result := make([]*agentexecutionv1.AgentFailureRank, len(entries))
	for i, e := range entries {
		result[i] = &agentexecutionv1.AgentFailureRank{
			AgentSlug:    e.agentID,
			AgentName:    names[e.agentID],
			FailureCount: e.count,
		}
	}
	return result
}
