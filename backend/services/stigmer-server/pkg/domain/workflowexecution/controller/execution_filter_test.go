package workflowexecution

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

func makeExec(id string, phase workflowexecutionv1.ExecutionPhase, startedAt, completedAt string, costMicros int64, tasks []*workflowexecutionv1.WorkflowTask) *workflowexecutionv1.WorkflowExecution {
	return &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: id},
		Status: &workflowexecutionv1.WorkflowExecutionStatus{
			Phase:           phase,
			StartedAt:       startedAt,
			CompletedAt:     completedAt,
			TotalCostMicros: costMicros,
			Tasks:           tasks,
		},
	}
}

func ids(execs []*workflowexecutionv1.WorkflowExecution) []string {
	out := make([]string, len(execs))
	for i, e := range execs {
		out[i] = e.GetMetadata().GetId()
	}
	return out
}

func TestApplyFilterCriteria_NilFilter(t *testing.T) {
	execs := []*workflowexecutionv1.WorkflowExecution{
		makeExec("a", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "", "", 0, nil),
	}
	result := applyFilterCriteria(execs, nil)
	assert.Len(t, result, 1)
}

func TestApplyFilterCriteria_PhaseFilter(t *testing.T) {
	execs := []*workflowexecutionv1.WorkflowExecution{
		makeExec("completed", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "", "", 0, nil),
		makeExec("failed", workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, "", "", 0, nil),
		makeExec("running", workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "", "", 0, nil),
	}

	filter := &workflowexecutionv1.ExecutionFilterCriteria{
		Phases: []workflowexecutionv1.ExecutionPhase{
			workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		},
	}

	result := applyFilterCriteria(execs, filter)
	assert.Equal(t, []string{"failed"}, ids(result))
}

func TestApplyFilterCriteria_MultiplePhases(t *testing.T) {
	execs := []*workflowexecutionv1.WorkflowExecution{
		makeExec("completed", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "", "", 0, nil),
		makeExec("failed", workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, "", "", 0, nil),
		makeExec("running", workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "", "", 0, nil),
	}

	filter := &workflowexecutionv1.ExecutionFilterCriteria{
		Phases: []workflowexecutionv1.ExecutionPhase{
			workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		},
	}

	result := applyFilterCriteria(execs, filter)
	assert.Equal(t, []string{"completed", "running"}, ids(result))
}

func TestApplyFilterCriteria_StartedAfter(t *testing.T) {
	execs := []*workflowexecutionv1.WorkflowExecution{
		makeExec("old", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "2026-05-20T10:00:00Z", "2026-05-20T10:01:00Z", 0, nil),
		makeExec("new", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "2026-05-23T10:00:00Z", "2026-05-23T10:01:00Z", 0, nil),
	}

	after := parseTime("2026-05-22T00:00:00Z")
	filter := &workflowexecutionv1.ExecutionFilterCriteria{
		StartedAfter: timestamppb.New(after),
	}

	result := applyFilterCriteria(execs, filter)
	assert.Equal(t, []string{"new"}, ids(result))
}

func TestApplyFilterCriteria_DurationRange(t *testing.T) {
	execs := []*workflowexecutionv1.WorkflowExecution{
		makeExec("fast", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "2026-05-23T10:00:00Z", "2026-05-23T10:00:05Z", 0, nil),
		makeExec("slow", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "2026-05-23T10:00:00Z", "2026-05-23T10:05:00Z", 0, nil),
		makeExec("running", workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "2026-05-23T10:00:00Z", "", 0, nil),
	}

	filter := &workflowexecutionv1.ExecutionFilterCriteria{
		MaxDuration: durationpb.New(60_000_000_000), // 60 seconds
	}

	result := applyFilterCriteria(execs, filter)
	assert.Equal(t, []string{"fast"}, ids(result))
}

func TestApplyFilterCriteria_CostRange(t *testing.T) {
	execs := []*workflowexecutionv1.WorkflowExecution{
		makeExec("cheap", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "", "", 10_000, nil),
		makeExec("expensive", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "", "", 500_000, nil),
	}

	filter := &workflowexecutionv1.ExecutionFilterCriteria{
		MinCostMicros: 100_000,
	}

	result := applyFilterCriteria(execs, filter)
	assert.Equal(t, []string{"expensive"}, ids(result))
}

func TestApplyFilterCriteria_FailedTaskName(t *testing.T) {
	execs := []*workflowexecutionv1.WorkflowExecution{
		makeExec("a", workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, "", "", 0, []*workflowexecutionv1.WorkflowTask{
			{TaskName: "validate", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED},
		}),
		makeExec("b", workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, "", "", 0, []*workflowexecutionv1.WorkflowTask{
			{TaskName: "send_email", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED},
		}),
	}

	filter := &workflowexecutionv1.ExecutionFilterCriteria{
		FailedTaskName: "validate",
	}

	result := applyFilterCriteria(execs, filter)
	assert.Equal(t, []string{"a"}, ids(result))
}

func TestApplyFilterCriteria_HasRetries(t *testing.T) {
	retryMeta, err := structpb.NewStruct(map[string]interface{}{
		"retry_count": 3.0,
	})
	require.NoError(t, err)

	execs := []*workflowexecutionv1.WorkflowExecution{
		makeExec("retried", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "", "", 0, []*workflowexecutionv1.WorkflowTask{
			{TaskName: "flaky", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED, Metadata: retryMeta},
		}),
		makeExec("clean", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "", "", 0, []*workflowexecutionv1.WorkflowTask{
			{TaskName: "stable", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED},
		}),
	}

	filter := &workflowexecutionv1.ExecutionFilterCriteria{
		HasRetries: true,
	}

	result := applyFilterCriteria(execs, filter)
	assert.Equal(t, []string{"retried"}, ids(result))
}

func TestApplySortField_StartedAt(t *testing.T) {
	execs := []*workflowexecutionv1.WorkflowExecution{
		makeExec("b", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "2026-05-23T12:00:00Z", "", 0, nil),
		makeExec("a", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "2026-05-23T10:00:00Z", "", 0, nil),
		makeExec("c", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "2026-05-23T14:00:00Z", "", 0, nil),
	}

	applySortField(execs, workflowexecutionv1.ExecutionSortField_EXECUTION_SORT_FIELD_STARTED_AT, true)
	assert.Equal(t, []string{"a", "b", "c"}, ids(execs))

	applySortField(execs, workflowexecutionv1.ExecutionSortField_EXECUTION_SORT_FIELD_STARTED_AT, false)
	assert.Equal(t, []string{"c", "b", "a"}, ids(execs))
}

func TestApplySortField_Cost(t *testing.T) {
	execs := []*workflowexecutionv1.WorkflowExecution{
		makeExec("mid", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "", "", 200_000, nil),
		makeExec("low", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "", "", 50_000, nil),
		makeExec("high", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "", "", 500_000, nil),
	}

	applySortField(execs, workflowexecutionv1.ExecutionSortField_EXECUTION_SORT_FIELD_COST, true)
	assert.Equal(t, []string{"low", "mid", "high"}, ids(execs))
}

func TestApplyFilterCriteria_CombinedFilters(t *testing.T) {
	execs := []*workflowexecutionv1.WorkflowExecution{
		makeExec("match", workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, "2026-05-23T10:00:00Z", "2026-05-23T10:01:00Z", 200_000, []*workflowexecutionv1.WorkflowTask{
			{TaskName: "validate", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED},
		}),
		makeExec("wrong-phase", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "2026-05-23T10:00:00Z", "2026-05-23T10:01:00Z", 200_000, nil),
		makeExec("wrong-cost", workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, "2026-05-23T10:00:00Z", "2026-05-23T10:01:00Z", 10, []*workflowexecutionv1.WorkflowTask{
			{TaskName: "validate", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED},
		}),
	}

	filter := &workflowexecutionv1.ExecutionFilterCriteria{
		Phases:         []workflowexecutionv1.ExecutionPhase{workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED},
		MinCostMicros:  100_000,
		FailedTaskName: "validate",
	}

	result := applyFilterCriteria(execs, filter)
	assert.Equal(t, []string{"match"}, ids(result))
}
