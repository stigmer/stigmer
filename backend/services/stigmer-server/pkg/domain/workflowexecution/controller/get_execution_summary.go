package workflowexecution

import (
	"context"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
)

// GetExecutionSummary returns aggregated execution statistics for the requested
// organization and time window. For OSS (single-user local), org filtering is
// a no-op — all executions are aggregated.
//
// @since T14 (Dashboard Integration)
func (c *WorkflowExecutionController) GetExecutionSummary(
	ctx context.Context,
	req *workflowexecutionv1.GetExecutionSummaryRequest,
) (*workflowexecutionv1.ExecutionSummary, error) {
	data, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow_execution)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list workflow executions for summary")
	}

	cutoff := resolveTimeCutoff(req.GetTimeWindow())

	phaseCounts := make(map[int32]int32)
	var activeCount int32
	var completedDurations []time.Duration
	failureCounts := make(map[string]int32)    // workflow slug → failure count
	workflowNames := make(map[string]string)   // workflow slug → name
	execByWorkflow := make(map[string]int32)   // workflow slug → execution count
	costByWorkflow := make(map[string]float64) // workflow slug → total cost USD

	var totalCostMicros int64
	var totalInputTokens int64
	var totalOutputTokens int64

	for _, d := range data {
		exec := &workflowexecutionv1.WorkflowExecution{}
		if err := proto.Unmarshal(d, exec); err != nil {
			continue
		}

		createdAt := auditCreatedAt(exec)
		if !createdAt.IsZero() && !cutoff.IsZero() && createdAt.Before(cutoff) {
			continue
		}

		phase := exec.GetStatus().GetPhase()
		phaseCounts[int32(phase)]++

		if isActivePhase(phase) {
			activeCount++
		}

		slug := extractWorkflowSlug(exec)
		if slug != "" {
			execByWorkflow[slug]++
			if name := exec.GetMetadata().GetName(); name != "" {
				workflowNames[slug] = name
			}
		}

		execCost := exec.GetStatus().GetTotalCostMicros()
		totalCostMicros += execCost
		totalInputTokens += exec.GetStatus().GetTotalInputTokens()
		totalOutputTokens += exec.GetStatus().GetTotalOutputTokens()
		if slug != "" && execCost > 0 {
			costByWorkflow[slug] += float64(execCost) / 1_000_000.0
		}

		if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
			if d := completionDuration(exec); d > 0 {
				completedDurations = append(completedDurations, d)
			}
		}

		if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED && slug != "" {
			failureCounts[slug]++
		}
	}

	summary := &workflowexecutionv1.ExecutionSummary{
		ActiveCount: activeCount,
		PhaseCounts: phaseCounts,
		TotalCost: &workflowexecutionv1.WorkflowCostSummary{
			TotalCostUsd:      float64(totalCostMicros) / 1_000_000.0,
			TotalInputTokens:  totalInputTokens,
			TotalOutputTokens: totalOutputTokens,
		},
	}

	if len(completedDurations) > 0 {
		var total time.Duration
		for _, d := range completedDurations {
			total += d
		}
		avg := total / time.Duration(len(completedDurations))
		summary.AvgDuration = durationpb.New(avg)
	}

	summary.TopFailingWorkflows = buildFailureRanks(failureCounts, workflowNames, 10)
	summary.CostByWorkflow = buildCostBreakdown(costByWorkflow, execByWorkflow, workflowNames, 10)

	return summary, nil
}

func resolveTimeCutoff(tw workflowexecutionv1.SummaryTimeWindow) time.Time {
	now := time.Now()
	switch tw {
	case workflowexecutionv1.SummaryTimeWindow_SUMMARY_TIME_WINDOW_LAST_24H:
		return now.Add(-24 * time.Hour)
	case workflowexecutionv1.SummaryTimeWindow_SUMMARY_TIME_WINDOW_LAST_7D:
		return now.Add(-7 * 24 * time.Hour)
	case workflowexecutionv1.SummaryTimeWindow_SUMMARY_TIME_WINDOW_LAST_30D:
		return now.Add(-30 * 24 * time.Hour)
	case workflowexecutionv1.SummaryTimeWindow_SUMMARY_TIME_WINDOW_ALL_TIME:
		return time.Time{}
	default:
		return now.Add(-7 * 24 * time.Hour)
	}
}

func isActivePhase(p workflowexecutionv1.ExecutionPhase) bool {
	return p == workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING ||
		p == workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS ||
		p == workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED
}

func auditCreatedAt(exec *workflowexecutionv1.WorkflowExecution) time.Time {
	ts := exec.GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
	if ts == nil {
		return time.Time{}
	}
	return ts.AsTime()
}

func completionDuration(exec *workflowexecutionv1.WorkflowExecution) time.Duration {
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

func extractWorkflowSlug(exec *workflowexecutionv1.WorkflowExecution) string {
	return exec.GetMetadata().GetSlug()
}

func buildFailureRanks(
	counts map[string]int32,
	names map[string]string,
	limit int,
) []*workflowexecutionv1.WorkflowFailureRank {
	type entry struct {
		slug  string
		count int32
	}
	entries := make([]entry, 0, len(counts))
	for slug, count := range counts {
		entries = append(entries, entry{slug, count})
	}
	sortDescInt32(entries, func(e entry) int32 { return e.count })
	if len(entries) > limit {
		entries = entries[:limit]
	}
	result := make([]*workflowexecutionv1.WorkflowFailureRank, len(entries))
	for i, e := range entries {
		result[i] = &workflowexecutionv1.WorkflowFailureRank{
			WorkflowSlug: e.slug,
			WorkflowName: names[e.slug],
			FailureCount: e.count,
		}
	}
	return result
}

func buildCostBreakdown(
	costs map[string]float64,
	execCounts map[string]int32,
	names map[string]string,
	limit int,
) []*workflowexecutionv1.WorkflowCostBreakdown {
	type entry struct {
		slug string
		cost float64
	}
	entries := make([]entry, 0, len(costs))
	for slug, cost := range costs {
		entries = append(entries, entry{slug, cost})
	}
	sortDescFloat64(entries, func(e entry) float64 { return e.cost })
	if len(entries) > limit {
		entries = entries[:limit]
	}
	result := make([]*workflowexecutionv1.WorkflowCostBreakdown, len(entries))
	for i, e := range entries {
		result[i] = &workflowexecutionv1.WorkflowCostBreakdown{
			WorkflowSlug:   e.slug,
			WorkflowName:   names[e.slug],
			TotalCostUsd:   e.cost,
			ExecutionCount: execCounts[e.slug],
		}
	}
	return result
}

func sortDescInt32[T any](s []T, key func(T) int32) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && key(s[j]) > key(s[j-1]); j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

func sortDescFloat64[T any](s []T, key func(T) float64) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && key(s[j]) > key(s[j-1]); j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
