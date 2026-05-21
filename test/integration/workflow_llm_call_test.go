//go:build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowLlmCall_StructuredOutput exercises a single llm_call task
// with a response_schema requesting structured JSON. Uses claude-haiku-3-5 to
// minimise cost. Skipped when ANTHROPIC_API_KEY is not set.
func TestWorkflowLlmCall_StructuredOutput(t *testing.T) {
	requireLlmPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	if testHarness.OTelEnabled() {
		tc := harness.StartTestTrace(ctx, t, testHarness.Jaeger)
		tc.RegisterCleanup(t, testHarness.OutputDir())
		ctx = tc.Context()
	}

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "llm-struct", suiteLogger)
	defer deployer.Cleanup(ctx)

	schema, err := structpb.NewStruct(map[string]any{
		"type":     "object",
		"required": []any{"sentiment"},
		"properties": map[string]any{
			"sentiment": map[string]any{
				"type": "string",
				"enum": []any{"positive", "negative", "neutral"},
			},
		},
	})
	require.NoError(t, err)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"model":           "claude-sonnet-4-20250514",
		"system_prompt":   "You are a sentiment classifier. Respond ONLY with valid JSON matching the schema.",
		"prompt":          "Classify the sentiment of: 'I absolutely love this product, it changed my life!'",
		"response_schema": schema.AsMap(),
		"temperature":     0.0,
		"max_tokens":      float64(100),
		"timeout":         float64(60),
		"max_retries":     float64(1),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-llm-structured",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: llm_call with structured output",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-llm-structured",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "classifySentiment",
					Kind:       workflowv1.WorkflowTaskKind_llm_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "llm structured output test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	t.Logf("execution created: id=%s", execution.GetMetadata().GetId())

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "classifySentiment",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("execution completed: id=%s, tasks=%d",
		result.GetMetadata().GetId(),
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowLlmCall_SimplePrompt exercises a plain-text llm_call with no
// response_schema. Verifies the workflow completes and produces output.
func TestWorkflowLlmCall_SimplePrompt(t *testing.T) {
	requireLlmPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "llm-simple", suiteLogger)
	defer deployer.Cleanup(ctx)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"model":       "claude-sonnet-4-20250514",
		"prompt":      "Reply with exactly one word: HELLO",
		"max_tokens":  float64(10),
		"timeout":     float64(60),
		"max_retries": float64(1),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-llm-simple",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: llm_call simple prompt",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-llm-simple",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "sayHello",
					Kind:       workflowv1.WorkflowTaskKind_llm_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "llm simple prompt test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "sayHello",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("execution completed: id=%s", result.GetMetadata().GetId())
}

// TestWorkflowLlmCall_OpenAI_StructuredOutput is identical to the Anthropic
// structured-output test but targets gpt-4o-mini. Skipped until OPENAI_API_KEY
// is available (billing resolved).
func TestWorkflowLlmCall_OpenAI_StructuredOutput(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}
	if os.Getenv("OPENAI_API_KEY") == "" {
		t.Skip("OPENAI_API_KEY not set — skipping OpenAI llm_call test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "llm-openai", suiteLogger)
	defer deployer.Cleanup(ctx)

	schema, err := structpb.NewStruct(map[string]any{
		"type":     "object",
		"required": []any{"sentiment"},
		"properties": map[string]any{
			"sentiment": map[string]any{
				"type": "string",
				"enum": []any{"positive", "negative", "neutral"},
			},
		},
	})
	require.NoError(t, err)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"model":           "gpt-4o-mini",
		"system_prompt":   "You are a sentiment classifier. Respond ONLY with valid JSON matching the schema.",
		"prompt":          "Classify the sentiment of: 'I absolutely love this product!'",
		"response_schema": schema.AsMap(),
		"max_tokens":      float64(100),
		"timeout":         float64(60),
		"max_retries":     float64(1),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-llm-openai",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: llm_call OpenAI structured output",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-llm-openai",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "classifySentiment",
					Kind:       workflowv1.WorkflowTaskKind_llm_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "llm openai test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
}

func requireLlmPrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set — skipping llm_call test")
	}
}
