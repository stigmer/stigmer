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

func TestOffline_LlmCall_StructuredOutput(t *testing.T) {
	requireEvalPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			`{"sentiment": "positive"}`,
			150, 20,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "offline-llm-struct", suiteLogger)
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
		"prompt":          "Classify the sentiment of: 'I absolutely love this product!'",
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
			Name: "offline-llm-structured",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Offline test: llm_call with structured output",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "offline-llm-structured",
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "llm structured output offline")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	_, err = mgr.AddWorkflowExecution(ctx, execution.GetMetadata().GetId())
	require.NoError(t, err, "AddWorkflowExecution should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "classifySentiment",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	assert.Equal(t, 0, mockLLM.Remaining())

	t.Logf("offline llm_call structured output completed: id=%s", result.GetMetadata().GetId())
}

func TestOffline_LlmCall_SimplePrompt(t *testing.T) {
	requireEvalPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			"HELLO",
			100, 5,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "offline-llm-simple", suiteLogger)
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
			Name: "offline-llm-simple",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Offline test: llm_call simple prompt",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "offline-llm-simple",
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "llm simple prompt offline")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	_, err = mgr.AddWorkflowExecution(ctx, execution.GetMetadata().GetId())
	require.NoError(t, err, "AddWorkflowExecution should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "sayHello",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	assert.Equal(t, 0, mockLLM.Remaining())

	t.Logf("offline llm_call simple prompt completed: id=%s", result.GetMetadata().GetId())
}

func TestOffline_LlmCall_OpenAI_StructuredOutput(t *testing.T) {
	requireEvalPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.OpenAITextResponse(
			`{"sentiment": "positive"}`,
			100, 15,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "offline-llm-openai", suiteLogger)
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
			Name: "offline-llm-openai",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Offline test: llm_call OpenAI structured output",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "offline-llm-openai",
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "llm openai offline")
	require.NoError(t, err)

	_, err = mgr.AddWorkflowExecution(ctx, execution.GetMetadata().GetId())
	require.NoError(t, err, "AddWorkflowExecution should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	assert.Equal(t, 0, mockLLM.Remaining())

	t.Logf("offline llm_call OpenAI structured output completed: id=%s", result.GetMetadata().GetId())
}
