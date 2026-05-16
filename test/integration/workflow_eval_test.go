//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverless "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// ---------------------------------------------------------------------------
// Offline tests (no API keys — only proto validation through the Temporal
// validation pipeline). These run as part of make test-integration.
// ---------------------------------------------------------------------------

// TestValidateSpec_EvalTask_Valid verifies that a well-formed eval task config
// passes spec validation through the Temporal validation pipeline.
func TestValidateSpec_EvalTask_Valid(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"model":        "gpt-4o",
		"subject":      "${ $context.summary.text }",
		"rubric":       "Evaluate whether this summary is accurate and complete.",
		"scoring_mode": "EVAL_PASS_FAIL",
		"on_fail":      "EVAL_FAIL_RAISE",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-eval-valid",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Valid eval task for spec validation test",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "validate-eval-valid",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "checkQuality",
					Kind:       workflowv1.WorkflowTaskKind_eval,
					TaskConfig: taskConfig,
					Export:     &workflowv1.Export{As: "${.}"},
				},
			},
		},
	}

	result, err := clients.WorkflowCommand.ValidateSpec(ctx, workflow)
	require.NoError(t, err, "validateSpec should not return an error for a valid eval task")

	assert.Equal(t, serverless.ValidationState_VALID, result.GetState(),
		"expected VALID state, got %s: errors=%v", result.GetState().String(), result.GetErrors())

	t.Logf("validateSpec VALID for eval task: yaml_length=%d", len(result.GetYaml()))
}

// TestValidateSpec_EvalTask_MissingModel verifies that an eval task missing the
// required model field is rejected during spec validation.
func TestValidateSpec_EvalTask_MissingModel(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"subject": "${ $context.summary.text }",
		"rubric":  "Evaluate quality.",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-eval-no-model",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Eval task missing required model field",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "validate-eval-no-model",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "badEval",
					Kind:       workflowv1.WorkflowTaskKind_eval,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	result, err := clients.WorkflowCommand.ValidateSpec(ctx, workflow)
	if err != nil {
		t.Logf("validateSpec returned error for missing model (acceptable): %v", err)
		return
	}

	assert.NotEqual(t, serverless.ValidationState_VALID, result.GetState(),
		"eval task missing model should not be VALID")

	t.Logf("validateSpec result: state=%s, errors=%v", result.GetState().String(), result.GetErrors())
}

// TestValidateSpec_EvalTask_MultiCriteria verifies that a multi-criteria eval
// task with criteria definitions passes spec validation.
func TestValidateSpec_EvalTask_MultiCriteria(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"model":        "gpt-4o",
		"subject":      "${ $context.response }",
		"rubric":       "Evaluate this customer support response.",
		"scoring_mode": "EVAL_MULTI_CRITERIA",
		"threshold":    0.75,
		"on_fail":      "EVAL_FAIL_WARN",
		"criteria": []any{
			map[string]any{
				"name":        "accuracy",
				"description": "Is the information factually correct?",
				"weight":      3.0,
			},
			map[string]any{
				"name":        "helpfulness",
				"description": "Does it address the customer's actual question?",
				"weight":      2.0,
			},
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-eval-multicriteria",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Multi-criteria eval task for spec validation test",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "validate-eval-multicriteria",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "evaluateResponse",
					Kind:       workflowv1.WorkflowTaskKind_eval,
					TaskConfig: taskConfig,
					Export:     &workflowv1.Export{As: "${.}"},
				},
			},
		},
	}

	result, err := clients.WorkflowCommand.ValidateSpec(ctx, workflow)
	require.NoError(t, err, "validateSpec should not return an error for a valid multi-criteria eval task")

	assert.Equal(t, serverless.ValidationState_VALID, result.GetState(),
		"expected VALID state for multi-criteria eval, got %s: errors=%v",
		result.GetState().String(), result.GetErrors())

	t.Logf("validateSpec VALID for multi-criteria eval: yaml_length=%d", len(result.GetYaml()))
}

// ---------------------------------------------------------------------------
// Provider-backed tests (need ANTHROPIC_API_KEY — real LLM calls).
// These run as part of make test-providers.
// ---------------------------------------------------------------------------

// TestWorkflowEval_PassFail exercises a pass/fail eval task against a
// trivially-correct subject. Uses claude-sonnet to minimise cost.
// Skipped when ANTHROPIC_API_KEY is not set.
func TestWorkflowEval_PassFail(t *testing.T) {
	requireLlmPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "eval-pf", suiteLogger)
	defer deployer.Cleanup(ctx)

	// Two-task workflow: set_vars provides the subject, eval judges it.
	subjectConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"summary": "The Earth orbits the Sun. It takes approximately 365.25 days to complete one orbit.",
		},
	})
	require.NoError(t, err)

	evalConfig, err := structpb.NewStruct(map[string]any{
		"model":        "claude-sonnet-4-20250514",
		"subject":      "${ $context.setSummary.summary }",
		"rubric":       "Is this statement factually accurate? It should be a correct astronomical fact.",
		"scoring_mode": "EVAL_PASS_FAIL",
		"on_fail":      "EVAL_FAIL_RAISE",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-eval-passfail",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: eval pass/fail with correct subject",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-eval-passfail",
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "eval pass/fail test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	t.Logf("execution created: id=%s", execution.GetMetadata().GetId())

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "setSummary",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "checkQuality",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("eval pass/fail completed: id=%s, tasks=%d",
		result.GetMetadata().GetId(),
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowEval_NumericScore exercises a numeric-score eval task with a
// threshold. The subject is a well-formed sentence so the score should exceed
// the low threshold.
func TestWorkflowEval_NumericScore(t *testing.T) {
	requireLlmPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "eval-ns", suiteLogger)
	defer deployer.Cleanup(ctx)

	subjectConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"text": "Machine learning is a subset of artificial intelligence that focuses on building systems that learn from data to improve their performance on specific tasks.",
		},
	})
	require.NoError(t, err)

	evalConfig, err := structpb.NewStruct(map[string]any{
		"model":        "claude-sonnet-4-20250514",
		"subject":      "${ $context.setSubject.text }",
		"rubric":       "Rate the clarity and accuracy of this definition on a scale from 0.0 to 1.0.",
		"scoring_mode": "EVAL_NUMERIC_SCORE",
		"threshold":    0.3,
		"on_fail":      "EVAL_FAIL_RAISE",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-eval-numeric",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: eval numeric score",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-eval-numeric",
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "eval numeric score test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "scoreDefinition",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("eval numeric score completed: id=%s", result.GetMetadata().GetId())
}

// TestWorkflowEval_WarnPolicy exercises the EVAL_FAIL_WARN policy. The eval
// task deliberately evaluates nonsensical text with a high threshold so the
// judge fails — but the workflow should still COMPLETE because warn policy
// allows continuation.
func TestWorkflowEval_WarnPolicy(t *testing.T) {
	requireLlmPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "eval-warn", suiteLogger)
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
		"rubric":       "Is this a well-formed, grammatically correct English sentence with clear meaning?",
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
			Name: "integration-test-eval-warn",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: eval warn policy continues after failure",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-eval-warn",
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "eval warn policy test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED (warn policy continues)")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "afterEval",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("eval warn policy completed: all 3 tasks reached COMPLETED, id=%s",
		result.GetMetadata().GetId())
}
