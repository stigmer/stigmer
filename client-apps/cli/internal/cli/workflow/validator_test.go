package workflow

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
)

// =============================================================================
// Test Helpers
// =============================================================================

// newWorkflowTask creates a workflow task with the given name.
func newWorkflowTask(name string) *workflowv1.WorkflowTask {
	return &workflowv1.WorkflowTask{
		Name: name,
		Kind: workflowv1.WorkflowTaskKind_set_vars,
	}
}

// newWorkflowTaskWithFlow creates a workflow task with flow control.
func newWorkflowTaskWithFlow(name, then string) *workflowv1.WorkflowTask {
	return &workflowv1.WorkflowTask{
		Name: name,
		Kind: workflowv1.WorkflowTaskKind_set_vars,
		Flow: &workflowv1.FlowControl{Then: then},
	}
}

// newWorkflow creates a workflow with the given tasks.
func newWorkflow(tasks ...*workflowv1.WorkflowTask) *workflowv1.Workflow {
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Spec: &workflowv1.WorkflowSpec{
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test",
				Name:      "test-workflow",
				Version:   "1.0.0",
			},
			Tasks: tasks,
		},
	}
}

// =============================================================================
// Validate Tests - Edge Cases
// =============================================================================

func TestValidate_NilWorkflow(t *testing.T) {
	err := Validate(nil)
	assert.NoError(t, err, "nil workflow should pass validation")
}

func TestValidate_NilSpec(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
	}
	err := Validate(workflow)
	assert.NoError(t, err, "nil spec should pass validation")
}

func TestValidate_EmptySpec(t *testing.T) {
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Spec:       &workflowv1.WorkflowSpec{},
	}
	err := Validate(workflow)
	assert.NoError(t, err, "empty spec should pass validation")
}

func TestValidate_EmptyTasks(t *testing.T) {
	workflow := newWorkflow()
	workflow.Spec.Tasks = []*workflowv1.WorkflowTask{}
	err := Validate(workflow)
	assert.NoError(t, err, "empty tasks should pass validation")
}

// =============================================================================
// Validate Tests - Valid Workflows
// =============================================================================

func TestValidate_ValidSequentialFlow(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTask("step1"),
		newWorkflowTask("step2"),
		newWorkflowTask("step3"),
	)
	err := Validate(workflow)
	assert.NoError(t, err, "sequential workflow should pass validation")
}

func TestValidate_ValidExplicitJumps(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("init", "process"),
		newWorkflowTask("process"),
		newWorkflowTaskWithFlow("cleanup", "end"),
	)
	err := Validate(workflow)
	assert.NoError(t, err, "explicit jumps to valid tasks should pass")
}

func TestValidate_ValidEndTermination(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTask("step1"),
		newWorkflowTaskWithFlow("step2", "end"),
	)
	err := Validate(workflow)
	assert.NoError(t, err, "'end' termination should pass validation")
}

func TestValidate_ValidEmptyThen(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("step1", ""),
		newWorkflowTask("step2"),
	)
	err := Validate(workflow)
	assert.NoError(t, err, "empty 'then' should pass validation")
}

func TestValidate_ValidComplexFlow(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("start", "validate"),
		newWorkflowTaskWithFlow("validate", "process"),
		newWorkflowTaskWithFlow("process", "notify"),
		newWorkflowTaskWithFlow("notify", "end"),
	)
	err := Validate(workflow)
	assert.NoError(t, err, "complex flow should pass validation")
}

// =============================================================================
// Unique Task Name Tests
// =============================================================================

func TestValidate_DuplicateTaskName(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTask("fetchData"),
		newWorkflowTask("processData"),
		newWorkflowTask("fetchData"), // Duplicate!
	)

	err := Validate(workflow)
	require.Error(t, err, "duplicate task name should fail")
	assert.Contains(t, err.Error(), "duplicate task name")
	assert.Contains(t, err.Error(), "fetchData")
	assert.Contains(t, err.Error(), "tasks[2]")
	assert.Contains(t, err.Error(), "tasks[0]")
}

func TestValidate_DuplicateTaskNameAdjacent(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTask("step"),
		newWorkflowTask("step"), // Duplicate adjacent
	)

	err := Validate(workflow)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "duplicate task name")
}

func TestValidate_UniqueTaskNames(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTask("step1"),
		newWorkflowTask("step2"),
		newWorkflowTask("step3"),
	)

	err := Validate(workflow)
	assert.NoError(t, err, "unique task names should pass")
}

// =============================================================================
// Flow Control Reference Tests
// =============================================================================

func TestValidate_InvalidFlowReference(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("step1", "nonexistent"),
		newWorkflowTask("step2"),
	)

	err := Validate(workflow)
	require.Error(t, err, "invalid flow reference should fail")
	assert.Contains(t, err.Error(), "invalid flow reference")
	assert.Contains(t, err.Error(), "nonexistent")
	assert.Contains(t, err.Error(), "tasks[0].flow.then")
}

func TestValidate_InvalidFlowReferenceShowsAvailable(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("init", "missing"),
		newWorkflowTask("process"),
		newWorkflowTask("cleanup"),
	)

	err := Validate(workflow)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Available task names:")
	assert.Contains(t, err.Error(), "cleanup")
	assert.Contains(t, err.Error(), "init")
	assert.Contains(t, err.Error(), "process")
}

func TestValidate_ValidFlowReferenceToEnd(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("step1", "end"),
	)

	err := Validate(workflow)
	assert.NoError(t, err, "'end' is a valid flow reference")
}

func TestValidate_FlowReferenceIsCaseSensitive(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("init", "Process"), // Wrong case
		newWorkflowTask("process"),
	)

	err := Validate(workflow)
	require.Error(t, err, "flow references should be case-sensitive")
	assert.Contains(t, err.Error(), "Process")
}

// =============================================================================
// Cycle Detection Tests
// =============================================================================

func TestValidate_SelfLoop(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("loop", "loop"), // Self-loop
	)

	err := Validate(workflow)
	require.Error(t, err, "self-loop should be detected")
	assert.Contains(t, err.Error(), "circular dependency")
	assert.Contains(t, err.Error(), "loop -> loop")
}

func TestValidate_SimpleCycle(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("A", "B"),
		newWorkflowTaskWithFlow("B", "A"), // A -> B -> A
	)

	err := Validate(workflow)
	require.Error(t, err, "simple cycle should be detected")
	assert.Contains(t, err.Error(), "circular dependency")
}

func TestValidate_ComplexCycle(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("A", "B"),
		newWorkflowTaskWithFlow("B", "C"),
		newWorkflowTaskWithFlow("C", "D"),
		newWorkflowTaskWithFlow("D", "B"), // B -> C -> D -> B
	)

	err := Validate(workflow)
	require.Error(t, err, "complex cycle should be detected")
	assert.Contains(t, err.Error(), "circular dependency")
}

func TestValidate_NoCycleWithEnd(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("A", "B"),
		newWorkflowTaskWithFlow("B", "C"),
		newWorkflowTaskWithFlow("C", "end"),
	)

	err := Validate(workflow)
	assert.NoError(t, err, "chain ending with 'end' should pass")
}

func TestValidate_NoCycleDisjointPaths(t *testing.T) {
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("A", "B"),
		newWorkflowTaskWithFlow("B", "end"),
		newWorkflowTaskWithFlow("C", "D"),
		newWorkflowTaskWithFlow("D", "end"),
	)

	err := Validate(workflow)
	assert.NoError(t, err, "disjoint paths should pass")
}

func TestValidate_NoCycleConvergingPaths(t *testing.T) {
	// A -> C, B -> C (convergence is OK, not a cycle)
	workflow := newWorkflow(
		newWorkflowTaskWithFlow("A", "C"),
		newWorkflowTaskWithFlow("B", "C"),
		newWorkflowTaskWithFlow("C", "end"),
	)

	err := Validate(workflow)
	assert.NoError(t, err, "converging paths should pass")
}

// =============================================================================
// Error Message Quality Tests
// =============================================================================

func TestValidate_ErrorMessageIncludesGuidance(t *testing.T) {
	tests := []struct {
		name         string
		workflow     *workflowv1.Workflow
		wantContains []string
	}{
		{
			name: "duplicate_provides_fix",
			workflow: newWorkflow(
				newWorkflowTask("dup"),
				newWorkflowTask("dup"),
			),
			wantContains: []string{"duplicate", "dup", "Rename"},
		},
		{
			name: "invalid_ref_provides_available",
			workflow: newWorkflow(
				newWorkflowTaskWithFlow("init", "missing"),
				newWorkflowTask("cleanup"),
			),
			wantContains: []string{"missing", "Available", "cleanup"},
		},
		{
			name: "cycle_provides_fix",
			workflow: newWorkflow(
				newWorkflowTaskWithFlow("A", "B"),
				newWorkflowTaskWithFlow("B", "A"),
			),
			wantContains: []string{"circular", "Break", "end"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := Validate(tt.workflow)
			require.Error(t, err)

			errMsg := err.Error()
			for _, want := range tt.wantContains {
				assert.True(t,
					strings.Contains(errMsg, want),
					"error message should contain %q, got: %s", want, errMsg,
				)
			}
		})
	}
}

// =============================================================================
// Helper Function Tests
// =============================================================================

func TestCollectTaskNames(t *testing.T) {
	tasks := []*workflowv1.WorkflowTask{
		newWorkflowTask("first"),
		newWorkflowTask("second"),
		newWorkflowTask("third"),
	}

	names := collectTaskNames(tasks)

	assert.Len(t, names, 3)
	assert.Equal(t, 0, names["first"])
	assert.Equal(t, 1, names["second"])
	assert.Equal(t, 2, names["third"])
}

func TestCollectTaskNames_SkipsNilAndEmpty(t *testing.T) {
	tasks := []*workflowv1.WorkflowTask{
		newWorkflowTask("valid"),
		nil,
		{Kind: workflowv1.WorkflowTaskKind_set_vars}, // Empty name
		newWorkflowTask("another"),
	}

	names := collectTaskNames(tasks)

	assert.Len(t, names, 2)
	assert.Contains(t, names, "valid")
	assert.Contains(t, names, "another")
}

func TestFormatAvailableTaskNames_Empty(t *testing.T) {
	result := formatAvailableTaskNames(map[string]int{})
	assert.Equal(t, "(none)", result)
}

func TestFormatAvailableTaskNames_Sorted(t *testing.T) {
	names := map[string]int{"zebra": 0, "alpha": 1, "beta": 2}
	result := formatAvailableTaskNames(names)
	assert.Equal(t, "alpha, beta, zebra", result)
}

func TestBuildFlowGraph(t *testing.T) {
	tasks := []*workflowv1.WorkflowTask{
		newWorkflowTaskWithFlow("A", "B"),
		newWorkflowTask("B"), // No flow
		newWorkflowTaskWithFlow("C", "end"),
	}

	graph := buildFlowGraph(tasks)

	assert.Len(t, graph, 2)
	assert.Equal(t, "B", graph["A"])
	assert.Equal(t, "end", graph["C"])
	_, hasB := graph["B"]
	assert.False(t, hasB, "B has no flow.then")
}

func TestReconstructCyclePath(t *testing.T) {
	tests := []struct {
		name       string
		pathOrder  []string
		cycleStart string
		want       string
	}{
		{
			name:       "simple_cycle",
			pathOrder:  []string{"A", "B"},
			cycleStart: "A",
			want:       "A -> B -> A",
		},
		{
			name:       "self_loop",
			pathOrder:  []string{"X"},
			cycleStart: "X",
			want:       "X -> X",
		},
		{
			name:       "longer_cycle",
			pathOrder:  []string{"A", "B", "C", "D"},
			cycleStart: "B",
			want:       "B -> C -> D -> B",
		},
		{
			name:       "not_in_path",
			pathOrder:  []string{"A", "B"},
			cycleStart: "Z",
			want:       "Z -> Z",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := reconstructCyclePath(tt.pathOrder, tt.cycleStart)
			assert.Equal(t, tt.want, result)
		})
	}
}
