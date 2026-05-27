//go:build integration

package offline

import (
	"context"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestOffline_TaskIO_PopulatesInputOutputTokens verifies that the runner
// correctly populates per-task input, output, cost, and token fields on
// status.tasks[], and execution-level totals on completion.
//
// Workflow: set_vars → llm_call (mock: 150 input, 20 output tokens)
// Asserts:
//   - Each task has non-nil input Struct
//   - LLM task has non-nil output Struct with token data
//   - LLM task has non-zero input_tokens and output_tokens
//   - LLM task has correct task_type (API_CALL)
//   - Execution-level total_input_tokens > 0
//   - Execution phase reaches COMPLETED with completed_at set
func TestOffline_TaskIO_PopulatesInputOutputTokens(t *testing.T) {
	requireEvalPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			"Hello from LLM",
			150, 20,
		)),
	}

	_, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "offline-task-io", suiteLogger)
	defer deployer.Cleanup(ctx)

	setVarsConfig, err := structpb.NewStruct(map[string]any{
		"greeting": "hello",
		"count":    float64(42),
	})
	require.NoError(t, err)

	llmConfig, err := structpb.NewStruct(map[string]any{
		"model":       "claude-sonnet-4-6",
		"prompt":      "Say hello",
		"max_tokens":  float64(100),
		"timeout":     float64(60),
		"max_retries": float64(1),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "offline-task-io",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Offline test: task I/O population",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "offline-task-io",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: setVarsConfig,
				},
				{
					Name:       "callLlm",
					Kind:       workflowv1.WorkflowTaskKind_llm_call,
					TaskConfig: llmConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "task IO population offline")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	_, err = mgr.AddWorkflowExecution(ctx, execution.GetMetadata().GetId())
	require.NoError(t, err, "AddWorkflowExecution should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"setVars": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"callLlm": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	tasks := result.GetStatus().GetTasks()
	require.GreaterOrEqual(t, len(tasks), 2, "should have at least 2 task entries")

	var setVarsTask, llmTask *workflowexecutionv1.WorkflowTask
	for _, task := range tasks {
		switch task.GetTaskName() {
		case "setVars":
			setVarsTask = task
		case "callLlm":
			llmTask = task
		}
	}
	require.NotNil(t, setVarsTask, "setVars task should exist in status")
	require.NotNil(t, llmTask, "callLlm task should exist in status")

	// set_vars task assertions
	assert.NotNil(t, setVarsTask.GetOutput(), "set_vars task should have output Struct")
	assert.Equal(t, workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_TRANSFORM,
		setVarsTask.GetTaskType(), "set_vars should map to TRANSFORM type")

	// llm_call task assertions
	assert.NotNil(t, llmTask.GetOutput(), "llm_call task should have output Struct")
	assert.Equal(t, workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_API_CALL,
		llmTask.GetTaskType(), "llm_call should map to API_CALL type")
	assert.Greater(t, llmTask.GetInputTokens(), int64(0),
		"llm_call should report non-zero input_tokens")
	assert.Greater(t, llmTask.GetOutputTokens(), int64(0),
		"llm_call should report non-zero output_tokens")

	// Execution-level totals
	status := result.GetStatus()
	assert.NotEmpty(t, status.GetCompletedAt(), "execution should have completed_at timestamp")
	assert.Greater(t, status.GetTotalInputTokens(), int64(0),
		"execution total_input_tokens should be non-zero")
	assert.Greater(t, status.GetTotalOutputTokens(), int64(0),
		"execution total_output_tokens should be non-zero")

	t.Logf("task IO test passed: llm input_tokens=%d output_tokens=%d total_input=%d total_output=%d",
		llmTask.GetInputTokens(), llmTask.GetOutputTokens(),
		status.GetTotalInputTokens(), status.GetTotalOutputTokens())
}
