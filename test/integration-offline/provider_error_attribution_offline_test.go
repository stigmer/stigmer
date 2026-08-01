//go:build integration

package offline

import (
	"context"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Provider Error Attribution (stigmer/stigmer#330) ---
//
// When the platform's own provider account is rejected upstream, the customer
// must see a platform-attributed failure — never the provider's raw billing
// prose pointing at consoles they don't own, and never the misleading
// "[MiddlewareError]" wrapper tag. Two arms:
//
//  1. The cloud proxy's rewritten 503 (the production contract): the runner
//     recognizes the STIGMER_PLATFORM_MODEL_CAPACITY sentinel.
//  2. A raw provider billing 400 relayed verbatim (version-skewed proxy):
//     the runner's own billing-prose detection still attributes it to the
//     platform, because in proxy mode the exhausted account is never the
//     customer's.
//
// Both run the runner in proxy mode (startOfflineRunner points
// STIGMER_PROXY_ENDPOINT at the mock). Direct-mode attribution ("your
// provider account is out of credits") is covered by the runner's unit
// tests (shared/__tests__/model-error.test.ts).

// runFailingExecution deploys a plain-chat agent whose single LLM call
// receives the given mock entry, waits for the terminal state, and returns
// the failed execution's status.
func runFailingExecution(
	t *testing.T,
	ctx context.Context,
	entry harness.RecordedLLMEntry,
	agentSlugPrefix string,
) *agentexecv1.AgentExecutionStatus {
	t.Helper()

	_, mgr := startOfflineRunner(t, ctx, []harness.RecordedLLMEntry{entry})

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients,
		agentSlugPrefix+"-"+t.Name(),
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
		"Hello!",
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	terminal, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 3*time.Minute)
	require.NoError(t, err, "execution should reach a terminal state")

	require.Equal(t, agentexecv1.ExecutionPhase_EXECUTION_FAILED,
		terminal.GetStatus().GetPhase(),
		"a billing-rejected model call must fail the execution; error=%q",
		terminal.GetStatus().GetError())

	return terminal.GetStatus()
}

// assertPlatformAttributed asserts the full attribution contract on a failed
// status: platform-fault code and wording present, provider billing prose
// and the MiddlewareError wrapper tag absent — on the error field AND every
// message in the transcript.
func assertPlatformAttributed(t *testing.T, status *agentexecv1.AgentExecutionStatus) {
	t.Helper()

	errText := status.GetError()
	assert.Contains(t, errText, "LLM_PLATFORM_CAPACITY",
		"error must carry the stable platform-capacity code")
	assert.Contains(t, errText, "platform-side issue",
		"error must attribute the failure to the platform")
	assert.Contains(t, errText, "credits were not charged",
		"error must reassure the customer their credits are intact")

	assert.NotContains(t, errText, "MiddlewareError",
		"the LangChain wrapper class must never label the user-visible error")
	assert.NotContains(t, errText, "Plans & Billing",
		"Anthropic's billing-console prose must never reach the customer")

	for _, msg := range status.GetMessages() {
		assert.NotContains(t, msg.GetContent(), "Plans & Billing",
			"provider billing prose must not leak into the transcript")
		assert.NotContains(t, msg.GetContent(), "MiddlewareError",
			"wrapper tag must not leak into the transcript")
	}
}

func TestOffline_PlatformCapacityRewrite_AttributedToPlatform(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, grpcConn, "gRPC connection required")

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	// The exact response the cloud proxy authors for a platform provider
	// fault: 503, provider-native envelope with the sentinel, and the
	// no-retry hint both SDKs honor (so the single mock entry suffices).
	entry := harness.BuildLLMErrorEntry(0, 503,
		map[string]string{"x-should-retry": "false"},
		harness.PlatformCapacityErrorBody("anthropic"),
	)

	status := runFailingExecution(t, ctx, entry, "offline-platform-capacity")
	assertPlatformAttributed(t, status)

	t.Logf("platform capacity rewrite attributed correctly: error=%q", status.GetError())
}

func TestOffline_RawProviderBillingError_NotMisattributedToCustomer(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, grpcConn, "gRPC connection required")

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	// A version-skewed proxy relays Anthropic's raw billing 400 verbatim
	// (the exact #330 incident shape). The runner-side classifier is the
	// defense-in-depth layer: in proxy mode this must still be attributed
	// to the platform, not to the customer.
	entry := harness.BuildLLMErrorEntry(0, 400, nil,
		harness.AnthropicBillingErrorBody(),
	)

	status := runFailingExecution(t, ctx, entry, "offline-raw-billing")
	assertPlatformAttributed(t, status)

	// The incident's tell-tale: the raw message told customers to visit
	// Anthropic's console. Double-check the strongest phrase is gone.
	assert.False(t, strings.Contains(status.GetError(), "credit balance is too low"),
		"raw Anthropic billing prose leaked: %q", status.GetError())

	t.Logf("raw billing error attributed correctly: error=%q", status.GetError())
}
