//go:build integration

package offline

import (
	"context"
	"strings"
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

	mockLLM, mgr := startOfflineRunner(t, ctx, llmCallResolutionEntries())

	runLlmCallResolutionWorkflow(t, ctx, mgr, "offline-model-resolution-llm")

	assertProviderReceivedResolvedModel(t, mockLLM)
}

// TestOffline_ModelResolution_LlmCall_RegistryFromProxyOrigin drops the
// explicit STIGMER_CLOUD_API_URL override. Without it the runner must fall
// back to fetching the model registry from its proxy origin — the same origin
// that serves /v1/proxy/llm (tier 2 in registry-endpoint.ts). This is the
// path production cloud runners take, so a regression here would silently
// degrade resolution to identity for every proxy-mode runner.
func TestOffline_ModelResolution_LlmCall_RegistryFromProxyOrigin(t *testing.T) {
	requireEvalPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	mockLLM, mgr := startResolutionRunner(t, ctx, llmCallResolutionEntries(),
		func(cfg *harness.UnifiedRunnerConfig, _ string) {
			cfg.CloudAPIURL = ""
			// Clear any ambient override so the fallback chain is genuinely
			// exercised regardless of the developer's shell environment.
			// registry-endpoint.ts treats the empty string as unset.
			cfg.ExtraEnv = append(cfg.ExtraEnv, "STIGMER_CLOUD_API_URL=")
		})

	runLlmCallResolutionWorkflow(t, ctx, mgr, "offline-model-res-proxy-origin")

	assertProviderReceivedResolvedModel(t, mockLLM)
}

// TestOffline_ModelResolution_LlmCall_DirectMode is the offline reproduction
// of stigmer/stigmer#240: an llm_call task in tokenless direct mode (no
// STIGMER_PROXY_ENDPOINT, no minted runner token, the user's own provider
// key). Provider traffic is routed to the mock via ANTHROPIC_BASE_URL, which
// the @anthropic-ai/sdk honors whenever no explicit baseURL is configured —
// exactly the direct-mode construction path in model-client.ts. The canonical
// id must still be resolved to the provider api id before the provider sees
// it; before the fix, direct mode degraded to identity and Anthropic answered
// 404 LLM_MODEL_NOT_FOUND.
//
// The registry source stays the explicit override: this suite's control plane
// is the cloud Java service, whose gRPC port cannot serve the REST registry.
// The local Go server's side of tier 3 (serving /v1/proxy/model-registry from
// the embed) is covered by the registry package's unit tests, and the
// runner's tier selection by registry-endpoint.test.ts.
func TestOffline_ModelResolution_LlmCall_DirectMode(t *testing.T) {
	requireEvalPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	mockLLM, mgr := startResolutionRunner(t, ctx, llmCallResolutionEntries(),
		func(cfg *harness.UnifiedRunnerConfig, mockURL string) {
			cfg.ProxyEndpoint = ""
			cfg.ExtraEnv = append(cfg.ExtraEnv,
				// Direct mode requires a provider key (call-llm.ts throws
				// LLM_MISSING_API_KEY without one); the mock never checks it.
				"ANTHROPIC_API_KEY=offline-test-key",
				// Route direct provider traffic to the mock.
				"ANTHROPIC_BASE_URL="+mockURL,
				// Clear any ambient proxy config so the runner is genuinely
				// tokenless-direct regardless of the developer's shell.
				"STIGMER_PROXY_ENDPOINT=",
				// Without ProxyEndpoint the harness emits no artifact-storage
				// env (that block is proxy-scoped); pin local storage.
				"ARTIFACT_STORAGE_TYPE=local",
				"LOCAL_ARTIFACT_PATH="+t.TempDir(),
			)
		})

	runLlmCallResolutionWorkflow(t, ctx, mgr, "offline-model-res-direct")

	assertProviderReceivedResolvedModel(t, mockLLM)
}

// llmCallResolutionEntries returns the single recorded provider response the
// llm_call resolution tests consume.
func llmCallResolutionEntries() []harness.RecordedLLMEntry {
	return []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			"HELLO",
			100, 5,
		)),
	}
}

// startResolutionRunner starts a runner against a fresh MockLLMProxyServer,
// letting the test reshape the runner config (registry source, proxy vs
// direct mode) before launch. The base config mirrors startOfflineRunner
// (offline_test.go): proxy mode with the registry override pinned to the
// mock. reshape receives the mock's URL for wiring env overrides.
func startResolutionRunner(
	t *testing.T,
	ctx context.Context,
	entries []harness.RecordedLLMEntry,
	reshape func(cfg *harness.UnifiedRunnerConfig, mockURL string),
) (*harness.MockLLMProxyServer, *harness.UnifiedRunnerManager) {
	t.Helper()

	mockLLM := harness.NewMockLLMProxyServerFromEntries(entries)
	t.Cleanup(func() { mockLLM.Close() })

	cfg := harness.UnifiedRunnerConfig{
		StigmerServiceAddress: testHarness.Service.GRPCAddress(),
		TemporalAddress:       testHarness.Temporal.Address(),
		LogDir:                testHarness.LogDir(),
		ProxyEndpoint:         mockLLM.URL(),
		CloudAPIURL:           mockLLM.URL(),
		LocalArtifactDir:      t.TempDir(),
		LogLabel:              t.Name(),
		ExtraEnv:              []string{"STIGMER_CHECKPOINTER_TYPE=memory"},
	}
	if reshape != nil {
		reshape(&cfg, mockLLM.URL())
	}

	mgr, err := harness.StartUnifiedRunnerManager(ctx, cfg, suiteLogger)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			t.Skipf("unified runner not available: %v", err)
		}
		t.Fatalf("failed to start resolution runner manager: %v", err)
	}
	t.Cleanup(func() {
		if err := mgr.Stop(); err != nil {
			t.Logf("warning: failed to stop runner manager: %v", err)
		}
	})

	return mockLLM, mgr
}

// runLlmCallResolutionWorkflow deploys a one-task llm_call workflow that
// references resolutionRegistryID, executes it through the given runner, and
// waits for completion. Callers assert on what the mock provider received.
// slug names the fixture and workflow, so it must be unique per test.
func runLlmCallResolutionWorkflow(
	t *testing.T,
	ctx context.Context,
	mgr *harness.UnifiedRunnerManager,
	slug string,
) {
	t.Helper()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, slug, suiteLogger)
	t.Cleanup(func() { deployer.Cleanup(context.Background()) })

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
			Name: slug,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Offline test: llm_call resolves a registry id to the provider api id",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      slug,
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
