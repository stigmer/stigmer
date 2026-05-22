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

func requireEvalPrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, grpcConn, "gRPC connection required")
}

func TestOffline_Eval_PassFail(t *testing.T) {
	requireEvalPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			`{"pass": true, "reasoning": "The statement is factually accurate."}`,
			200, 60,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "offline-eval-pf", suiteLogger)
	defer deployer.Cleanup(ctx)

	subjectConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"summary": "The Earth orbits the Sun. It takes approximately 365.25 days to complete one orbit.",
		},
	})
	require.NoError(t, err)

	evalConfig, err := structpb.NewStruct(map[string]any{
		"model":        "claude-sonnet-4-20250514",
		"subject":      "${ $context.setSummary.summary }",
		"rubric":       "Is this statement factually accurate?",
		"scoring_mode": "EVAL_PASS_FAIL",
		"on_fail":      "EVAL_FAIL_RAISE",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "offline-eval-passfail",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Offline test: eval pass/fail with mock LLM",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "offline-eval-passfail",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setSummary",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: subjectConfig,
					Export:     &workflowv1.Export{As: "${.}"},
				},
				{
					Name:       "checkQuality",
					Kind:       workflowv1.WorkflowTaskKind_eval,
					TaskConfig: evalConfig,
					Export:     &workflowv1.Export{As: "${.}"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "eval pass/fail offline")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	_, err = mgr.AddWorkflowExecution(ctx, execution.GetMetadata().GetId())
	require.NoError(t, err, "AddWorkflowExecution should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "setSummary",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "checkQuality",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	assert.Equal(t, 0, mockLLM.Remaining(), "all mock entries should be consumed")

	t.Logf("offline eval pass/fail completed: id=%s, mock_consumed=%d",
		result.GetMetadata().GetId(), mockLLM.Consumed())
}

func TestOffline_Eval_NumericScore(t *testing.T) {
	requireEvalPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			`{"score": 0.85, "reasoning": "The definition is clear and accurate."}`,
			200, 55,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "offline-eval-ns", suiteLogger)
	defer deployer.Cleanup(ctx)

	subjectConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"text": "Machine learning is a subset of artificial intelligence.",
		},
	})
	require.NoError(t, err)

	evalConfig, err := structpb.NewStruct(map[string]any{
		"model":        "claude-sonnet-4-20250514",
		"subject":      "${ $context.setSubject.text }",
		"rubric":       "Rate the clarity and accuracy on a scale from 0.0 to 1.0.",
		"scoring_mode": "EVAL_NUMERIC_SCORE",
		"threshold":    0.3,
		"on_fail":      "EVAL_FAIL_RAISE",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "offline-eval-numeric",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Offline test: eval numeric score with mock LLM",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "offline-eval-numeric",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setSubject",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: subjectConfig,
					Export:     &workflowv1.Export{As: "${.}"},
				},
				{
					Name:       "scoreDefinition",
					Kind:       workflowv1.WorkflowTaskKind_eval,
					TaskConfig: evalConfig,
					Export:     &workflowv1.Export{As: "${.}"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "eval numeric score offline")
	require.NoError(t, err)

	_, err = mgr.AddWorkflowExecution(ctx, execution.GetMetadata().GetId())
	require.NoError(t, err, "AddWorkflowExecution should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "scoreDefinition",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	assert.Equal(t, 0, mockLLM.Remaining())

	t.Logf("offline eval numeric score completed: id=%s", result.GetMetadata().GetId())
}

func TestOffline_Eval_WarnPolicy(t *testing.T) {
	requireEvalPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			`{"pass": false, "reasoning": "The text is not a well-formed sentence."}`,
			200, 60,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "offline-eval-warn", suiteLogger)
	defer deployer.Cleanup(ctx)

	subjectConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"text": "asdfghjkl qwerty zxcvbnm",
		},
	})
	require.NoError(t, err)

	evalConfig, err := structpb.NewStruct(map[string]any{
		"model":        "claude-sonnet-4-20250514",
		"subject":      "${ $context.setSubject.text }",
		"rubric":       "Is this a well-formed English sentence?",
		"scoring_mode": "EVAL_NUMERIC_SCORE",
		"threshold":    0.9,
		"on_fail":      "EVAL_FAIL_WARN",
	})
	require.NoError(t, err)

	afterEvalConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"continuation": "reached",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "offline-eval-warn",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Offline test: eval warn policy continues after failure",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "offline-eval-warn",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setSubject",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: subjectConfig,
					Export:     &workflowv1.Export{As: "${.}"},
				},
				{
					Name:       "evalWithWarn",
					Kind:       workflowv1.WorkflowTaskKind_eval,
					TaskConfig: evalConfig,
				},
				{
					Name:       "afterEval",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: afterEvalConfig,
					Export:     &workflowv1.Export{As: "${.}"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "eval warn policy offline")
	require.NoError(t, err)

	_, err = mgr.AddWorkflowExecution(ctx, execution.GetMetadata().GetId())
	require.NoError(t, err, "AddWorkflowExecution should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED (warn policy continues)")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "afterEval",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	assert.Equal(t, 0, mockLLM.Remaining())

	t.Logf("offline eval warn policy completed: id=%s", result.GetMetadata().GetId())
}
