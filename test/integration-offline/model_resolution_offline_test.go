//go:build integration

package offline

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// --- Model-ID Resolution Regression Tests ---
//
// These guard the bug that produced `404 not_found_error model: claude-haiku-4.5`:
// a Stigmer registry id (dot-notation) was handed to the provider instead of its
// api id. The fix centralised resolution in buildChatModel (registry id ->
// apiModelId) so no LLM construction site can bypass it.
//
// The assertion target is what the provider actually received: the mock proxy
// captures each request body, and the runner resolves ids against the mock's
// served /v1/proxy/model-registry (wired via CloudAPIURL in startOfflineRunner).
// If resolution silently degrades to identity, the provider sees the registry id
// and these tests fail — which is exactly the regression we want to catch.

const (
	// regression input: a registry id in dot-notation.
	resolutionRegistryID = "claude-haiku-4.5"
	// expected output: the provider api id from the mock registry. Mirrors
	// stigmer-cloud's model-registry.json (see defaultMockModelRegistry).
	resolutionAPIModelID = "claude-haiku-4-5-20251001"
)

// TestOffline_ModelResolution_DeepAgent_ResolvesRegistryId is the faithful
// reproduction of the reported incident: a native deep-agent execution whose
// configured model is the registry id `claude-haiku-4.5`. The provider must
// receive the resolved api id, never the registry id. Guards setup.ts.
func TestOffline_ModelResolution_DeepAgent_ResolvesRegistryId(t *testing.T) {
	requireEvalPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			"Done.",
			120, 8,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-model-resolution-"+t.Name(),
		"You are a helpful assistant.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Reply with exactly one word: Done.",
		harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
			ModelName: resolutionRegistryID,
		}),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "deep-agent execution should complete")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	assertProviderReceivedResolvedModel(t, mockLLM)
}

// TestOffline_ModelResolution_LlmCall_ResolvesRegistryId covers the workflow
// `llm_call` path (callLlmAction) with the same registry id, so both LLM
// construction sites stay protected. Guards call-llm.ts.
func TestOffline_ModelResolution_LlmCall_ResolvesRegistryId(t *testing.T) {
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
	deployer := harness.NewFixtureDeployer(clients, "offline-model-resolution-llm", suiteLogger)
	defer deployer.Cleanup(ctx)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"model":       resolutionRegistryID,
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
			Name: "offline-model-resolution-llm",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Offline test: llm_call resolves a registry id to the provider api id",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "offline-model-resolution-llm",
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "model resolution llm_call offline")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	_, err = mgr.AddWorkflowExecution(ctx, execution.GetMetadata().GetId())
	require.NoError(t, err, "AddWorkflowExecution should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	assertProviderReceivedResolvedModel(t, mockLLM)
}

// assertProviderReceivedResolvedModel verifies every request the runner sent to
// the provider carried the resolved api id and never the raw registry id.
func assertProviderReceivedResolvedModel(t *testing.T, mockLLM *harness.MockLLMProxyServer) {
	t.Helper()

	models := mockLLM.RequestModels()
	require.NotEmpty(t, models, "expected at least one captured provider request")
	for _, m := range models {
		assert.Equal(t, resolutionAPIModelID, m,
			"provider must receive the resolved api id, not the registry id")
		assert.NotEqual(t, resolutionRegistryID, m,
			"registry id must never reach the provider (the 404 not_found regression)")
	}

	t.Logf("model resolution verified: %q -> %q (requests=%d)",
		resolutionRegistryID, resolutionAPIModelID, len(models))
}
