//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAgentExecution_Usage_RunnerUsageSummary(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-usage-runner-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(), "Reply with exactly: hello")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")

			usage := result.GetStatus().GetStreamingUsage()
			require.NotNil(t, usage, "streaming_usage should be populated after completion")

			assert.Greater(t, usage.GetInputTokens(), int64(0),
				"input_tokens should be non-zero")
			assert.Greater(t, usage.GetOutputTokens(), int64(0),
				"output_tokens should be non-zero")
			assert.GreaterOrEqual(t, usage.GetTurnCount(), int32(1),
				"turn_count should be at least 1")

			t.Logf("runner usage: input=%d, output=%d, turns=%d, cost=$%.6f, model=%s",
				usage.GetInputTokens(), usage.GetOutputTokens(),
				usage.GetTurnCount(), usage.GetEstimatedCostUsd(),
				usage.GetModel())
		})
	}
}

func TestAgentExecution_Usage_ExecutionReport(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-usage-exec-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(), "Reply with exactly: hello")
			executionID := exec.GetMetadata().GetId()

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err := waiter.WaitForPhase(ctx, executionID,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")

			time.Sleep(2 * time.Second)

			report, err := clients.AgentExecutionQuery.GetExecutionUsageReport(ctx,
				&agentexecv1.GetExecutionUsageReportInput{
					ExecutionId: executionID,
				})
			require.NoError(t, err, "getExecutionUsageReport should succeed")
			require.NotNil(t, report, "report should not be nil")

			agg := report.GetAggregate()
			require.NotNil(t, agg, "aggregate usage should be populated")

			t.Logf("execution usage: input=%d, output=%d, calls=%d, billable=%d, provider=%d",
				agg.GetInputTokens(), agg.GetOutputTokens(),
				agg.GetLlmCallCount(), agg.GetBillableCostMicros(),
				agg.GetProviderCostMicros())

			assert.Greater(t, agg.GetInputTokens(), int64(0),
				"input_tokens should be non-zero (proxy-reported)")
			assert.Greater(t, agg.GetOutputTokens(), int64(0),
				"output_tokens should be non-zero (proxy-reported)")
			assert.Greater(t, agg.GetLlmCallCount(), int32(0),
				"llm_call_count should be non-zero (proxy-reported)")
			assert.Greater(t, agg.GetBillableCostMicros(), int64(0),
				"billable_cost_micros should be non-zero (proxy-reported)")

			t.Logf("model_breakdown count: %d", len(report.GetModelBreakdown()))
		})
	}
}

func TestAgentExecution_Usage_SessionReport(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-usage-session-"+h.Name,
				"You are a helpful assistant. Respond briefly with one sentence.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)
			sessionID := session.GetMetadata().GetId()

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			exec1 := harness.CreateTestAgentExecution(t, ctx, clients,
				sessionID, "Reply with exactly: first")
			_, err := waiter.WaitForPhase(ctx, exec1.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "first execution should complete")

			exec2 := harness.CreateTestAgentExecution(t, ctx, clients,
				sessionID, "Reply with exactly: second")
			_, err = waiter.WaitForPhase(ctx, exec2.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "second execution should complete")

			time.Sleep(2 * time.Second)

			report, err := clients.AgentExecutionQuery.GetSessionUsageReport(ctx,
				&agentexecv1.GetSessionUsageReportInput{
					SessionId: sessionID,
				})
			require.NoError(t, err, "getSessionUsageReport should succeed")
			require.NotNil(t, report, "report should not be nil")

			assert.Equal(t, sessionID, report.GetSessionId())
			assert.GreaterOrEqual(t, report.GetExecutionCount(), int32(2),
				"session should have at least 2 executions")

			executions := report.GetExecutions()
			assert.GreaterOrEqual(t, len(executions), 2,
				"per-execution breakdown should have at least 2 entries")

			totalUsage := report.GetTotalUsage()
			require.NotNil(t, totalUsage, "total_usage should be populated")

			t.Logf("session total: input=%d, output=%d, calls=%d, billable=%d",
				totalUsage.GetInputTokens(), totalUsage.GetOutputTokens(),
				totalUsage.GetLlmCallCount(), totalUsage.GetBillableCostMicros())

			assert.Greater(t, totalUsage.GetInputTokens(), int64(0),
				"session total input_tokens should be non-zero (proxy-reported)")
			assert.Greater(t, totalUsage.GetBillableCostMicros(), int64(0),
				"session total billable_cost_micros should be non-zero (proxy-reported)")
		})
	}
}

func TestAgentExecution_Usage_OrgReport(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-usage-org-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(), "Reply with exactly: hello")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")

			time.Sleep(2 * time.Second)

			today := time.Now().Format("2006-01-02")

			report, err := clients.AgentExecutionQuery.GetOrgUsageReport(ctx,
				&agentexecv1.GetOrgUsageReportInput{
					OrgId:    "test-org",
					FromDate: today,
					ToDate:   today,
				})
			require.NoError(t, err, "getOrgUsageReport should succeed")
			require.NotNil(t, report, "report should not be nil")

			assert.GreaterOrEqual(t, report.GetTotalExecutions(), int32(1),
				"org should have at least 1 execution today")
			assert.Greater(t, report.GetTotalBillableCostMicros(), int64(0),
				"org total billable_cost_micros should be non-zero (proxy-reported)")

			t.Logf("org report: executions=%d, agents=%d, sessions=%d, billable=%d",
				report.GetTotalExecutions(), report.GetTotalAgents(),
				report.GetTotalSessions(), report.GetTotalBillableCostMicros())
		})
	}
}
