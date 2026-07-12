//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverless "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestValidateSpec_CrossRefTypoSuggestion verifies that ValidateSpec detects
// invalid cross-task references (e.g. switch_case `then` pointing to a
// non-existent task) and provides "did you mean?" suggestions via
// Levenshtein distance.
//
// Workflow: switch with case.then="handleCriticl" (typo for handleCritical)
func TestValidateSpec_CrossRefTypoSuggestion(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"severity": "critical",
		},
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "critical",
				"when": "${ $data.severity == \"critical\" }",
				"then": "handleCriticl",
			},
		},
	})
	require.NoError(t, err)

	handleConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "handled",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-test-crossref-typo",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "ValidateSpec test: cross-ref typo suggestion",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "validate-test-crossref-typo",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
				},
				{
					Name:       "routeBySeverity",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleCritical",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleConfig,
				},
			},
		},
	}

	result, err := clients.WorkflowCommand.ValidateSpec(ctx, workflow)

	// #189 contract: validateSpec never throws for a user-fixable spec and always
	// returns a structured verdict. With #219 closed, the Java service backing
	// this harness now detects switch cases[].then cross-references at parity with
	// the Go validator, so we assert the strict INVALID + "did you mean?" outcome
	// here (the Go-side equivalent lives in TestValidateSpec_Layer2CrossRefTypo).
	require.NoError(t, err, "validateSpec must not throw for a cross-ref typo")
	require.NotNil(t, result, "validateSpec must return a structured result")
	assert.Equal(t, serverless.ValidationState_INVALID, result.GetState(),
		"a dangling switch cases[].then must be INVALID")
	joined := strings.Join(result.GetErrors(), " ")
	assert.Contains(t, joined, "handleCriticl", "error should name the dangling target")
	assert.Contains(t, joined, "did you mean", "error should offer a Levenshtein suggestion")
	assert.Contains(t, joined, "handleCritical", "suggestion should point at the intended task")
}

// TestValidateSpec_BudgetWithoutCostTasks verifies that ValidateSpec produces
// a warning when a workflow has a budget but no cost-generating tasks
// (no llm_call or agent_call).
func TestValidateSpec_BudgetWithoutCostTasks(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"greeting": "hello",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-test-budget-no-cost",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "ValidateSpec test: budget without cost tasks",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "validate-test-budget-no-cost",
				Version:   "1.0.0",
			},
			Budget: &workflowv1.WorkflowBudget{
				MaxCostMicros: 5000000,
				OnExceeded:    workflowv1.BudgetExceededPolicy_budget_exceeded_terminate,
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setGreeting",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	result, err := clients.WorkflowCommand.ValidateSpec(ctx, workflow)

	require.NoError(t, err, "validateSpec must not throw for a valid workflow with warnings")
	require.NotNil(t, result)
	// A budget with no cost-bearing tasks is a warning, not an error, so the
	// workflow stays VALID.
	assert.Equal(t, serverless.ValidationState_VALID, result.GetState(),
		"budget-without-cost-tasks is a warning, so the workflow remains VALID")

	joined := strings.ToLower(strings.Join(result.GetWarnings(), " "))
	assert.True(t,
		strings.Contains(joined, "budget") || strings.Contains(joined, "cost"),
		"expected a budget/cost warning, got warnings=%v", result.GetWarnings())
}

// TestValidateSpec_HumanInputCrossRef verifies that ValidateSpec detects
// invalid outcome.then references in human_input tasks and provides suggestions.
func TestValidateSpec_HumanInputCrossRef(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "Review this",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{
				"name":  "reject",
				"label": "Reject",
				"then":  "nonExistentTask",
			},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	afterConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"done": "true",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-test-hitl-crossref",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "ValidateSpec test: human_input outcome.then cross-ref",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "validate-test-hitl-crossref",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "awaitReview",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: humanInputConfig,
				},
				{
					Name:       "afterReview",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: afterConfig,
				},
			},
		},
	}

	result, err := clients.WorkflowCommand.ValidateSpec(ctx, workflow)

	// #189 contract: no throw, structured result. With #219 closed, the Java
	// service now detects human_input outcomes[].then cross-references at parity
	// with the Go validator, so we assert the strict INVALID outcome here.
	require.NoError(t, err, "validateSpec must not throw for an invalid outcome.then")
	require.NotNil(t, result, "validateSpec must return a structured result")
	assert.Equal(t, serverless.ValidationState_INVALID, result.GetState(),
		"a dangling human_input outcomes[].then must be INVALID")
	assert.Contains(t, strings.Join(result.GetErrors(), " "), "nonExistentTask",
		"error should name the dangling outcome target")
}

// TestValidateSpec_EvalTaskAccepted verifies that ValidateSpec accepts the
// eval task kind without errors (since eval was recently added and may have
// been missing from some validation paths).
func TestValidateSpec_EvalTaskAccepted(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	evalConfig, err := structpb.NewStruct(map[string]any{
		"model":        "gpt-4o",
		"subject":      "${ $data.content }",
		"rubric":       "Verify overall output quality and correctness",
		"scoring_mode": "EVAL_PASS_FAIL",
		"criteria": []any{
			map[string]any{
				"name":        "quality_check",
				"description": "Verify output quality",
			},
		},
	})
	require.NoError(t, err)

	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"content": "test content for evaluation",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-test-eval-accepted",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "ValidateSpec test: eval task kind is accepted",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "validate-test-eval-accepted",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initData",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
				},
				{
					Name:       "evaluate",
					Kind:       workflowv1.WorkflowTaskKind_eval,
					TaskConfig: evalConfig,
				},
			},
		},
	}

	result, err := clients.WorkflowCommand.ValidateSpec(ctx, workflow)

	require.NoError(t, err, "validateSpec must not throw for a valid eval task")
	require.NotNil(t, result)
	assert.Equal(t, serverless.ValidationState_VALID, result.GetState(),
		"eval task should be accepted by ValidateSpec")
	assert.Empty(t, result.GetErrors(), "eval task should have no validation errors")
}
