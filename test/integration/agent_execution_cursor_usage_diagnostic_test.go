//go:build integration

package integration

import (
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAgentExecution_CursorUsage_FullPipeline validates the complete data
// pipeline from Cursor SDK turn-ended callbacks through to the session usage
// report. This test exercises the EXACT same data sources that the frontend
// ContextGauge and UsageWidget consume.
//
// It verifies:
//  1. streaming_usage on execution status (UsageAccumulator → status.streamingUsage)
//  2. context_info on execution status (ContextTracker → status.contextInfo)
//  3. GetExecutionUsageReport (emitBillingRecords → LlmCallUsageRecord → aggregate)
//  4. GetSessionUsageReport (session-level aggregate from billing records)
//  5. Cross-reference: streaming and billing token counts are consistent
//
// If this test fails, the frontend will show incorrect or missing cost/token data.
func TestAgentExecution_CursorUsage_FullPipeline(t *testing.T) {
	require.NotNil(t, grpcConn)
	harness.RequireCursorPrereqs(t, testHarness)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients, "test-cursor-pipeline",
		"You are a helpful assistant. Respond briefly.")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), harness.Harnesses[1].Harness)
	sessionID := session.GetMetadata().GetId()

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID, "Reply with exactly: hello world")
	executionID := exec.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, executionID,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err, "execution should complete")

	// ─── Source 1: streaming_usage (runner-reported, DISPLAY_ONLY) ───────────
	usage := result.GetStatus().GetStreamingUsage()
	require.NotNil(t, usage, "streaming_usage should be populated")

	assert.Greater(t, usage.GetInputTokens(), int64(0), "streaming input_tokens > 0")
	assert.Greater(t, usage.GetOutputTokens(), int64(0), "streaming output_tokens > 0")
	assert.GreaterOrEqual(t, usage.GetTurnCount(), int32(1), "streaming turn_count >= 1")
	assert.Greater(t, usage.GetEstimatedCostUsd(), float64(0), "streaming estimated_cost > 0")
	assert.NotEmpty(t, usage.GetModel(), "streaming model should be set")

	t.Logf("STREAMING_USAGE: input=%d output=%d turns=%d cost=$%.6f model=%s",
		usage.GetInputTokens(), usage.GetOutputTokens(),
		usage.GetTurnCount(), usage.GetEstimatedCostUsd(), usage.GetModel())

	// ─── Source 2: context_info — removed ────────────────────────────────────
	// ContextTracker was removed because Cursor SDK's inputTokens is a billing
	// metric, not a context-window-size metric. contextInfo is no longer emitted.
	assert.Nil(t, result.GetStatus().GetContextInfo(),
		"context_info should NOT be populated (ContextTracker removed)")

	// ─── Source 3: GetExecutionUsageReport (billing records) ─────────────────
	time.Sleep(2 * time.Second)

	execReport, err := clients.AgentExecutionQuery.GetExecutionUsageReport(ctx,
		&agentexecv1.GetExecutionUsageReportInput{ExecutionId: executionID})
	require.NoError(t, err, "GetExecutionUsageReport should succeed")
	require.NotNil(t, execReport, "execution report should not be nil")

	agg := execReport.GetAggregate()
	require.NotNil(t, agg, "execution report aggregate should be populated")

	assert.Greater(t, agg.GetInputTokens(), int64(0), "report input_tokens > 0")
	assert.Greater(t, agg.GetOutputTokens(), int64(0), "report output_tokens > 0")
	assert.Greater(t, agg.GetLlmCallCount(), int32(0), "report llm_call_count > 0")
	assert.Greater(t, agg.GetProviderCostMicros(), int64(0), "report provider_cost > 0")
	assert.Greater(t, agg.GetBillableCostMicros(), int64(0),
		"report billable_cost_micros > 0 (billing policy must be seeded)")

	t.Logf("EXECUTION_REPORT: input=%d output=%d calls=%d provider=%d billable=%d model=%s",
		agg.GetInputTokens(), agg.GetOutputTokens(), agg.GetLlmCallCount(),
		agg.GetProviderCostMicros(), agg.GetBillableCostMicros(), agg.GetPrimaryModel())

	assert.Greater(t, len(execReport.GetModelBreakdown()), 0,
		"model_breakdown should have at least one entry")

	// ─── Source 4: GetSessionUsageReport (session-level aggregate) ───────────
	sessionReport, err := clients.AgentExecutionQuery.GetSessionUsageReport(ctx,
		&agentexecv1.GetSessionUsageReportInput{SessionId: sessionID})
	require.NoError(t, err, "GetSessionUsageReport should succeed")
	require.NotNil(t, sessionReport, "session report should not be nil")

	sessionUsage := sessionReport.GetTotalUsage()
	require.NotNil(t, sessionUsage, "session total_usage should be populated")

	assert.Greater(t, sessionUsage.GetInputTokens(), int64(0),
		"session input_tokens > 0")
	assert.Greater(t, sessionUsage.GetBillableCostMicros(), int64(0),
		"session billable_cost_micros > 0")

	t.Logf("SESSION_REPORT: input=%d output=%d calls=%d billable=%d",
		sessionUsage.GetInputTokens(), sessionUsage.GetOutputTokens(),
		sessionUsage.GetLlmCallCount(), sessionUsage.GetBillableCostMicros())

	// ─── Cross-reference: streaming vs billing tokens should be consistent ───
	streamingTotal := usage.GetInputTokens() + usage.GetOutputTokens()
	billingTotal := agg.GetInputTokens() + agg.GetOutputTokens()

	if streamingTotal > 0 && billingTotal > 0 {
		ratio := float64(billingTotal) / float64(streamingTotal)
		t.Logf("CROSS_REF: streaming_total=%d billing_total=%d ratio=%.2f",
			streamingTotal, billingTotal, ratio)
		assert.InDelta(t, 1.0, ratio, 0.5,
			"billing and streaming token totals should be within 50%% of each other")
	}
}
