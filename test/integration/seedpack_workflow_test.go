//go:build integration

package integration

import (
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSeedpackWorkflow_Parse_ContentReviewPipeline(t *testing.T) {
	workflow, err := harness.LoadSeedpackWorkflow("content-review-pipeline.yaml")
	require.NoError(t, err)

	assert.Equal(t, "content-review-pipeline", workflow.GetMetadata().GetName())
	require.NotNil(t, workflow.GetSpec())
	assert.NotNil(t, workflow.GetSpec().GetDocument())

	tasks := workflow.GetSpec().GetTasks()
	require.NotEmpty(t, tasks)
	assert.Len(t, tasks, 4)
	assert.Equal(t, "draft_content", tasks[0].GetName())
	assert.Equal(t, workflowv1.WorkflowTaskKind_llm_call, tasks[0].GetKind())

	taskKinds := collectTaskKinds(tasks)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_llm_call)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_human_input)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_transform)
}

func TestSeedpackWorkflow_Parse_ResearchAndSummarize(t *testing.T) {
	workflow, err := harness.LoadSeedpackWorkflow("research-and-summarize.yaml")
	require.NoError(t, err)

	assert.Equal(t, "research-and-summarize", workflow.GetMetadata().GetName())
	require.NotNil(t, workflow.GetSpec())
	assert.NotNil(t, workflow.GetSpec().GetDocument())

	tasks := workflow.GetSpec().GetTasks()
	require.NotEmpty(t, tasks)
	assert.Len(t, tasks, 5)

	taskKinds := collectTaskKinds(tasks)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_fork)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_llm_call)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_transform)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_human_input)
}

func TestSeedpackWorkflow_Parse_SupportTicketTriage(t *testing.T) {
	workflow, err := harness.LoadSeedpackWorkflow("support-ticket-triage.yaml")
	require.NoError(t, err)

	assert.Equal(t, "support-ticket-triage", workflow.GetMetadata().GetName())
	require.NotNil(t, workflow.GetSpec())
	assert.NotNil(t, workflow.GetSpec().GetDocument())

	tasks := workflow.GetSpec().GetTasks()
	require.NotEmpty(t, tasks)
	assert.Len(t, tasks, 6)
	assert.Equal(t, "classify_ticket", tasks[0].GetName())
	assert.Equal(t, workflowv1.WorkflowTaskKind_llm_call, tasks[0].GetKind())

	taskKinds := collectTaskKinds(tasks)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_switch_case)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_human_input)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_transform)
}

func TestSeedpackWorkflow_Parse_DesktopResearchCapture(t *testing.T) {
	workflow, err := harness.LoadSeedpackWorkflow("desktop-research-capture.yaml")
	require.NoError(t, err)

	assert.Equal(t, "desktop-research-capture", workflow.GetMetadata().GetName())
	require.NotNil(t, workflow.GetSpec())
	assert.NotNil(t, workflow.GetSpec().GetDocument())

	tasks := workflow.GetSpec().GetTasks()
	require.NotEmpty(t, tasks)
	assert.Len(t, tasks, 3)
	assert.Equal(t, "capture", tasks[0].GetName())
	assert.Equal(t, workflowv1.WorkflowTaskKind_agent_call, tasks[0].GetKind())

	taskKinds := collectTaskKinds(tasks)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_agent_call)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_human_input)
	assert.Contains(t, taskKinds, workflowv1.WorkflowTaskKind_transform)
}

// TestSeedpackWorkflow_StrictParse verifies all seedpack workflow YAMLs can
// be parsed with DiscardUnknown: false — matching the CLI's strict behavior.
// This catches schema mismatches (e.g., using "required" instead of "optional"
// in env declarations) that lenient parsing silently ignores.
func TestSeedpackWorkflow_StrictParse(t *testing.T) {
	seedpackWorkflows := []string{
		"content-review-pipeline.yaml",
		"support-ticket-triage.yaml",
		"research-and-summarize.yaml",
		"desktop-research-capture.yaml",
	}

	for _, filename := range seedpackWorkflows {
		t.Run(filename, func(t *testing.T) {
			wf, err := harness.LoadSeedpackWorkflowStrict(filename)
			require.NoError(t, err, "strict parsing of %s should succeed (no unknown proto fields)", filename)
			require.NotNil(t, wf.Spec, "workflow spec should not be nil")
			require.NotEmpty(t, wf.Spec.Tasks, "workflow should have at least one task")

			t.Logf("strict-parsed %s: name=%s, tasks=%d",
				filename, wf.Metadata.Name, len(wf.Spec.Tasks))
		})
	}
}

func collectTaskKinds(tasks []*workflowv1.WorkflowTask) []workflowv1.WorkflowTaskKind {
	kinds := make([]workflowv1.WorkflowTaskKind, 0, len(tasks))
	for _, task := range tasks {
		kinds = append(kinds, task.GetKind())
	}
	return kinds
}
