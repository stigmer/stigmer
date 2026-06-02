package workflowexecution

import (
	"sort"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// applyFilterCriteria filters a list of workflow executions against the
// given filter criteria. Returns a new slice containing only matching entries.
// Returns all entries when filter is nil.
func applyFilterCriteria(
	executions []*workflowexecutionv1.WorkflowExecution,
	filter *workflowexecutionv1.ExecutionFilterCriteria,
) []*workflowexecutionv1.WorkflowExecution {
	if filter == nil {
		return executions
	}

	result := make([]*workflowexecutionv1.WorkflowExecution, 0, len(executions))
	for _, exec := range executions {
		if matchesFilter(exec, filter) {
			result = append(result, exec)
		}
	}
	return result
}

func matchesFilter(exec *workflowexecutionv1.WorkflowExecution, f *workflowexecutionv1.ExecutionFilterCriteria) bool {
	status := exec.GetStatus()

	if len(f.GetPhases()) > 0 {
		phase := status.GetPhase()
		found := false
		for _, p := range f.GetPhases() {
			if p == phase {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	if f.GetStartedAfter() != nil {
		started := parseTime(status.GetStartedAt())
		if started.IsZero() || started.Before(f.GetStartedAfter().AsTime()) {
			return false
		}
	}

	if f.GetStartedBefore() != nil {
		started := parseTime(status.GetStartedAt())
		if started.IsZero() || started.After(f.GetStartedBefore().AsTime()) {
			return false
		}
	}

	if f.GetMinDuration() != nil || f.GetMaxDuration() != nil {
		started := parseTime(status.GetStartedAt())
		completed := parseTime(status.GetCompletedAt())
		if started.IsZero() || completed.IsZero() {
			return false
		}
		dur := completed.Sub(started)

		if f.GetMinDuration() != nil && dur < f.GetMinDuration().AsDuration() {
			return false
		}
		if f.GetMaxDuration() != nil && dur > f.GetMaxDuration().AsDuration() {
			return false
		}
	}

	if f.GetMinCostMicros() > 0 && status.GetTotalCostMicros() < f.GetMinCostMicros() {
		return false
	}
	if f.GetMaxCostMicros() > 0 && status.GetTotalCostMicros() > f.GetMaxCostMicros() {
		return false
	}

	if f.GetFailedTaskName() != "" {
		found := false
		for _, task := range status.GetTasks() {
			if task.GetStatus() == workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED &&
				task.GetTaskName() == f.GetFailedTaskName() {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	if f.GetHasRetries() {
		hasRetry := false
		for _, task := range status.GetTasks() {
			if retryCount := extractRetryCountFromMetadata(task); retryCount > 0 {
				hasRetry = true
				break
			}
		}
		if !hasRetry {
			return false
		}
	}

	return true
}

func extractRetryCountFromMetadata(task *workflowexecutionv1.WorkflowTask) int {
	md := task.GetMetadata()
	if md == nil {
		return 0
	}
	fields := md.GetFields()
	if fields == nil {
		return 0
	}
	retryField, ok := fields["retry_count"]
	if !ok {
		retryField, ok = fields["retryCount"]
	}
	if !ok || retryField == nil {
		return 0
	}
	nv := retryField.GetNumberValue()
	if nv > 0 {
		return int(nv)
	}
	return 0
}

// applySortField sorts executions by the given sort field and direction.
// Modifies the slice in place.
func applySortField(
	executions []*workflowexecutionv1.WorkflowExecution,
	sortField workflowexecutionv1.ExecutionSortField,
	ascending bool,
) {
	if len(executions) <= 1 {
		return
	}

	sort.SliceStable(executions, func(i, j int) bool {
		a := executions[i]
		b := executions[j]
		less := compareBySortField(a, b, sortField)
		if ascending {
			return less
		}
		return !less && compareBySortField(b, a, sortField)
	})
}

func compareBySortField(
	a, b *workflowexecutionv1.WorkflowExecution,
	field workflowexecutionv1.ExecutionSortField,
) bool {
	switch field {
	case workflowexecutionv1.ExecutionSortField_EXECUTION_SORT_FIELD_DURATION:
		return executionDurationMs(a) < executionDurationMs(b)

	case workflowexecutionv1.ExecutionSortField_EXECUTION_SORT_FIELD_COST:
		return a.GetStatus().GetTotalCostMicros() < b.GetStatus().GetTotalCostMicros()

	case workflowexecutionv1.ExecutionSortField_EXECUTION_SORT_FIELD_STATUS:
		return a.GetStatus().GetPhase() < b.GetStatus().GetPhase()

	default:
		ta := parseTime(a.GetStatus().GetStartedAt())
		tb := parseTime(b.GetStatus().GetStartedAt())
		return ta.Before(tb)
	}
}

func executionDurationMs(exec *workflowexecutionv1.WorkflowExecution) int64 {
	started := parseTime(exec.GetStatus().GetStartedAt())
	completed := parseTime(exec.GetStatus().GetCompletedAt())
	if started.IsZero() || completed.IsZero() {
		return -1
	}
	return completed.Sub(started).Milliseconds()
}

func parseTime(iso string) time.Time {
	if iso == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		t, err = time.Parse(time.RFC3339, iso)
		if err != nil {
			return time.Time{}
		}
	}
	return t
}

// applyLegacyPhaseFilter applies the deprecated top-level `phase` field
// from ListWorkflowExecutionsRequest as a fallback when no filter.phases
// is specified.
func applyLegacyPhaseFilter(
	executions []*workflowexecutionv1.WorkflowExecution,
	phase workflowexecutionv1.ExecutionPhase,
) []*workflowexecutionv1.WorkflowExecution {
	if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED {
		return executions
	}
	result := make([]*workflowexecutionv1.WorkflowExecution, 0, len(executions))
	for _, exec := range executions {
		if exec.GetStatus().GetPhase() == phase {
			result = append(result, exec)
		}
	}
	return result
}
