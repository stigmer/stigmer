//go:build integration

package offline

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- MCP Connect Tool Classification: direct-path credential resolution ---
//
// Regression suite for the stigmerBackendEndpoint-as-LLM-proxy bug: the
// ClassifyToolApprovals activity used to coerce the gRPC control-plane
// endpoint into an LLM proxy base URL when no proxy was configured, so in
// unproxied deployments every classification request 404ed and every tool
// fail-closed — the LLM classifier never ran at all.
//
// The connect workflow always dispatches to the GLOBAL runner queue
// ("stigmer_runner"): McpServerConnectHandler resolves the queue with a null
// session id, which bypasses the suite's session routing. So unlike the other
// offline tests (per-test manager runners), these start a per-test STATIC
// runner on that queue — in genuine direct mode, the deployment shape the bug
// broke. Direct provider traffic reaches the mock via ANTHROPIC_BASE_URL,
// which the @anthropic-ai/sdk honors when no explicit baseURL is configured
// (the same seam TestOffline_ModelResolution_LlmCall_DirectMode uses).
//
// The two tests are a deliberate pair:
//   - WithKey: classification reaches the provider and gates selectively —
//     impossible before the fix (the request died at the control plane).
//   - NoCredentials: the runner fails closed WITHOUT attempting an LLM call
//     (Consumed()==0 distinguishes the deliberate skip from the old 404 path,
//     which also ended all-gated but only after a doomed network attempt).

// startClassifyStaticRunner starts a static unified runner on the global
// connect queue in direct mode (no STIGMER_PROXY_ENDPOINT). The mock serves
// only the model registry by default; extraEnv appends last and overrides,
// so tests decide the credential story (keys present or explicitly blank).
func startClassifyStaticRunner(
	t *testing.T,
	ctx context.Context,
	mockLLM *harness.MockLLMProxyServer,
	extraEnv ...string,
) *harness.UnifiedRunnerStatic {
	t.Helper()

	cfg := harness.UnifiedRunnerConfig{
		StigmerServiceAddress: testHarness.Service.GRPCAddress(),
		TemporalAddress:       testHarness.Temporal.Address(),
		LogDir:                testHarness.LogDir(),
		// Direct mode: the harness emits no STIGMER_PROXY_ENDPOINT for an
		// empty ProxyEndpoint, and the explicit blank below neutralizes any
		// ambient value from the developer's shell (env passthrough).
		ProxyEndpoint: "",
		// Registry/pricing fetches still resolve against the mock so the
		// economy model resolves exactly as production (claude-sonnet-4.6 ->
		// economy tier -> claude-haiku-4.5 -> api id claude-haiku-4-5-20251001).
		CloudAPIURL: mockLLM.URL(),
		LogLabel:    t.Name(),
		ExtraEnv: append([]string{
			"STIGMER_CHECKPOINTER_TYPE=memory",
			"STIGMER_PROXY_ENDPOINT=",
			"STIGMER_ANTHROPIC_BACKEND=",
			"STIGMER_OPENAI_BACKEND=",
			// Anthropic primary so classification resolves an Anthropic
			// economy model — the provider the ANTHROPIC_BASE_URL seam mocks.
			"STIGMER_PRIMARY_MODEL=claude-sonnet-4.6",
			// The harness emits artifact-storage env only in proxy mode; pin
			// local storage so the runner boots without a proxy.
			"ARTIFACT_STORAGE_TYPE=local",
			"LOCAL_ARTIFACT_PATH=" + t.TempDir(),
		}, extraEnv...),
	}

	runner, err := harness.StartUnifiedRunnerStatic(ctx, cfg, "stigmer_runner", suiteLogger)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			t.Skipf("unified runner not available: %v", err)
		}
		t.Fatalf("failed to start static classify runner: %v", err)
	}
	t.Cleanup(func() {
		if err := runner.Stop(); err != nil {
			t.Logf("warning: failed to stop static runner: %v", err)
		}
	})

	return runner
}

func TestOffline_McpConnect_Classification_DirectModeWithKey(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	// One recorded classification turn. withStructuredOutput binds a forced
	// tool named "extract" (@langchain/anthropic default), and the classifier
	// schema is {approvals: [{tool_name, requires_approval, message}]}.
	// The mock-test-server exposes exactly five tools; the entry classifies
	// all five so reconciliation has nothing to fail closed.
	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_classify_01", "extract",
			map[string]any{
				"approvals": []map[string]any{
					{"tool_name": "echo", "requires_approval": false, "message": ""},
					{"tool_name": "add", "requires_approval": false, "message": ""},
					{"tool_name": "fail", "requires_approval": true, "message": "Fail with {{args.message}}"},
					{"tool_name": "slow", "requires_approval": false, "message": ""},
					{"tool_name": "crash", "requires_approval": true, "message": "Crash the server"},
				},
			},
			500, 120,
		)),
	}

	mockLLM := harness.NewMockLLMProxyServerFromEntries(entries)
	t.Cleanup(func() { mockLLM.Close() })

	startClassifyStaticRunner(t, ctx, mockLLM,
		"ANTHROPIC_API_KEY=offline-test-key",
		"ANTHROPIC_BASE_URL="+mockLLM.URL(),
	)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
	connected := harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

	require.Len(t, connected.GetStatus().GetDiscoveredCapabilities().GetTools(), 5,
		"discovery should surface all five mock-test-server tools")

	gated := map[string]string{}
	for _, approval := range connected.GetStatus().GetToolApprovals() {
		gated[approval.GetToolName()] = approval.GetMessage()
	}

	// The classifier's selective decisions survived to the persisted policy —
	// before the fix this was unreachable (all five failed closed via 404).
	assert.Contains(t, gated, "fail", "classifier gated 'fail'")
	assert.Contains(t, gated, "crash", "classifier gated 'crash'")
	assert.NotContains(t, gated, "echo", "classifier cleared 'echo'")
	assert.NotContains(t, gated, "add", "classifier cleared 'add'")
	assert.NotContains(t, gated, "slow", "classifier cleared 'slow'")
	assert.Equal(t, "Fail with {{args.message}}", gated["fail"],
		"classifier-authored approval message must persist verbatim")

	// The provider mock — not the control plane — served the classification,
	// and it received the resolved economy-model api id.
	assert.Equal(t, 0, mockLLM.Remaining(), "the classification entry should be consumed")
	models := mockLLM.RequestModels()
	require.NotEmpty(t, models, "the classification request must reach the provider")
	assert.Equal(t, "claude-haiku-4-5-20251001", models[0],
		"classification must use the resolved anthropic economy model")
}

func TestOffline_McpConnect_Classification_DirectModeNoCredentials(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	// No recorded entries: any LLM attempt would 500 loudly. The point is
	// stronger — with no credential path the runner must not attempt one.
	mockLLM := harness.NewMockLLMProxyServerFromEntries(nil)
	t.Cleanup(func() { mockLLM.Close() })

	startClassifyStaticRunner(t, ctx, mockLLM,
		"ANTHROPIC_API_KEY=",
		"OPENAI_API_KEY=",
	)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
	connected := harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

	require.Len(t, connected.GetStatus().GetDiscoveredCapabilities().GetTools(), 5,
		"discovery is credential-free and must still surface all five tools")

	gated := map[string]bool{}
	for _, approval := range connected.GetStatus().GetToolApprovals() {
		gated[approval.GetToolName()] = true
	}
	for _, tool := range []string{"echo", "add", "fail", "slow", "crash"} {
		assert.True(t, gated[tool],
			"tool %q must fail closed (requires_approval) when no credential path exists", tool)
	}

	assert.Equal(t, 0, mockLLM.Consumed(),
		"no LLM request may be attempted without a credential path — the skip is deliberate, not a failed call")
}
