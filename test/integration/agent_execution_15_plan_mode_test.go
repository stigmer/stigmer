//go:build integration

package integration

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// planPrompt induces a substantial, multi-step plan so the agent turn produces
// a meaningful token count. A trivial prompt would make the agent turn nearly
// indistinguishable in size from the cheap session-title generation call, which
// would hide the "only the title call is metered" defect this test guards.
const planPrompt = "You are in plan mode. Produce a detailed, numbered, multi-step " +
	"implementation plan (at least five steps) for adding a GET /health endpoint to a " +
	"Node.js Express service that returns service uptime and version. Explain the " +
	"reasoning for each step. Do NOT create, edit, or delete any files."

// TestAgentExecution_PlanMode_CursorUsage reproduces the reported defect where a
// Plan-mode execution on the Cursor harness shows no usage for the actual plan —
// only the separate, cheap session-title generation call (claude-haiku) is
// metered, so the Usage tab understates real cost by orders of magnitude.
//
// It mirrors TestAgentExecution_CursorUsage_FullPipeline but with
// InteractionMode = PLAN. The decisive signal is the cross-reference between
// runner-reported streaming_usage (which reflects the Cursor SDK agent turns)
// and the billing aggregate (LlmCallUsageRecord). Both totals are cache-
// inclusive, so when every agent turn is metered they track closely; if turns
// are dropped (e.g. only the cheap session-title call is metered), the billing
// total collapses while streaming reflects the full plan and the ratio falls
// outside the tolerance band. The per-turn billing-record guard
// (llm_call_count >= turn_count) catches the same defect directly.
func TestAgentExecution_PlanMode_CursorUsage(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	harness.RequireCursorPrereqs(t, testHarness)

	ctx, cancel := harness.TestContext(t, 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients, "test-plan-usage-cursor",
		"You are a helpful software engineer. When in Plan mode, analyze the request "+
			"and produce a detailed plan without making any changes.")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), harness.Harnesses[1].Harness)
	sessionID := session.GetMetadata().GetId()

	exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID, planPrompt,
		harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
			InteractionMode: agentexecv1.InteractionMode_INTERACTION_MODE_PLAN,
		}),
	)
	executionID := exec.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, executionID,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
	require.NoError(t, err, "plan-mode execution should complete")

	// ─── Source 1: streaming_usage (Cursor SDK turn-ended, DISPLAY_ONLY) ─────
	usage := result.GetStatus().GetStreamingUsage()
	require.NotNil(t, usage, "streaming_usage should be populated for the plan turn")
	assert.Greater(t, usage.GetInputTokens(), int64(0), "streaming input_tokens > 0")
	assert.Greater(t, usage.GetOutputTokens(), int64(0), "streaming output_tokens > 0")
	assert.GreaterOrEqual(t, usage.GetTurnCount(), int32(1), "streaming turn_count >= 1")

	t.Logf("PLAN_STREAMING_USAGE: input=%d output=%d turns=%d cost=$%.6f model=%s",
		usage.GetInputTokens(), usage.GetOutputTokens(),
		usage.GetTurnCount(), usage.GetEstimatedCostUsd(), usage.GetModel())

	// ─── Source 2: GetExecutionUsageReport (billing records) ─────────────────
	// The Cursor proxy records per-turn billing asynchronously (each turn's
	// write is dispatched off the stream event loop), so poll until the report
	// has settled — a billing record for every streaming agent turn, with the
	// billable amount stamped — rather than sleeping a fixed interval and racing
	// those writes.
	turnCount := usage.GetTurnCount()
	execReport, err := harness.WaitForExecutionUsageReport(ctx, clients.AgentExecutionQuery,
		executionID, 60*time.Second,
		func(r *agentexecv1.GetExecutionUsageReportOutput) bool {
			a := r.GetAggregate()
			return a.GetLlmCallCount() >= turnCount && a.GetBillableCostMicros() > 0
		})
	require.NoError(t, err,
		"execution usage report should settle with a billing record per agent turn")
	require.NotNil(t, execReport, "execution report should not be nil")

	agg := execReport.GetAggregate()
	require.NotNil(t, agg, "execution report aggregate should be populated")

	t.Logf("PLAN_EXECUTION_REPORT: input=%d output=%d total=%d calls=%d provider=%d billable=%d models=%d",
		agg.GetInputTokens(), agg.GetOutputTokens(), agg.GetTotalTokens(), agg.GetLlmCallCount(),
		agg.GetProviderCostMicros(), agg.GetBillableCostMicros(),
		len(execReport.GetModelBreakdown()))

	assert.Greater(t, agg.GetLlmCallCount(), int32(0), "report llm_call_count > 0")
	assert.Greater(t, agg.GetInputTokens(), int64(0), "report input_tokens > 0")
	assert.Greater(t, agg.GetOutputTokens(), int64(0), "report output_tokens > 0")
	assert.Greater(t, agg.GetBillableCostMicros(), int64(0),
		"report billable_cost_micros > 0 (billing policy must be seeded)")

	// Every Cursor SDK agent turn must produce at least one billing record. The
	// billing side also includes the cheap session-title call, so it is always
	// >= the streaming turn count; fewer billing calls than turns means the
	// proxy dropped a turn — the under-billing defect this test guards.
	assert.GreaterOrEqual(t, agg.GetLlmCallCount(), turnCount,
		"billing must record at least one LLM call per streaming agent turn "+
			"(calls=%d turns=%d)", agg.GetLlmCallCount(), turnCount)

	// ─── Decisive cross-reference (total-to-total) ───────────────────────────
	// Both totals are cache-INCLUSIVE and therefore measure the same throughput:
	// streaming_usage.total_tokens is input+output (the Cursor SDK reports input
	// inclusive of cache), and the billing aggregate's total_tokens sums each
	// call's provider total. They must track closely; a large gap means Cursor
	// agent turns were not metered (only the title call was). Comparing
	// input+output alone would be wrong — the billing aggregate's input_tokens
	// excludes cached tokens (disjoint buckets) while streaming's input includes
	// them, which is the apples-to-oranges mismatch this cross-check avoids.
	streamingTotal := usage.GetTotalTokens()
	billingTotal := agg.GetTotalTokens()
	require.Greater(t, streamingTotal, int64(0), "streaming total must be > 0 to cross-check")
	require.Greater(t, billingTotal, int64(0), "billing total must be > 0 to cross-check")

	ratio := float64(billingTotal) / float64(streamingTotal)
	t.Logf("PLAN_CROSS_REF: streaming_total=%d billing_total=%d ratio=%.2f calls=%d turns=%d",
		streamingTotal, billingTotal, ratio, agg.GetLlmCallCount(), turnCount)
	assert.InDelta(t, 1.0, ratio, 0.2,
		"plan-mode billing and streaming token totals should track within 20%%; "+
			"a large gap means Cursor agent turns were not metered (only the title call was)")

	// ─── Session report parity ───────────────────────────────────────────────
	sessionReport, err := clients.AgentExecutionQuery.GetSessionUsageReport(ctx,
		&agentexecv1.GetSessionUsageReportInput{SessionId: sessionID})
	require.NoError(t, err, "GetSessionUsageReport should succeed")
	require.NotNil(t, sessionReport.GetTotalUsage(), "session total_usage should be populated")
	assert.Greater(t, sessionReport.GetTotalUsage().GetBillableCostMicros(), int64(0),
		"session billable_cost_micros > 0")
}

// TestAgentExecution_PlanMode_Streaming reproduces the reported defect where a
// Plan-mode execution shows no live progress — the whole plan appears only in
// the final snapshot. It subscribes to the execution and asserts that the AI
// plan message is observed mid-flight (is_streaming=true with non-empty content)
// on at least one non-terminal snapshot, proving the plan streamed incrementally
// rather than arriving all at once at completion.
//
// Runs for both harnesses: native is the reference that already streams; cursor
// is the one under investigation.
func TestAgentExecution_PlanMode_Streaming(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 6*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-plan-stream-"+h.Name,
				"You are a helpful software engineer. When in Plan mode, produce a "+
					"detailed plan without making any changes.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(), planPrompt,
				harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
					InteractionMode: agentexecv1.InteractionMode_INTERACTION_MODE_PLAN,
				}),
			)
			executionID := exec.GetMetadata().GetId()

			streamCtx, streamCancel := context.WithTimeout(ctx, 5*time.Minute)
			defer streamCancel()

			stream, err := clients.AgentExecutionQuery.Subscribe(streamCtx,
				&agentexecv1.AgentExecutionId{Value: executionID})
			require.NoError(t, err, "subscribe should succeed for execution %s", executionID)

			type streamResult struct {
				// sawStreamingPlanText is true if any NON-terminal snapshot carried
				// an AI message that was actively streaming with non-empty content.
				sawStreamingPlanText bool
				// maxMidFlightLen is the longest AI content seen before terminal —
				// proves partial content was delivered, not just the final blob.
				maxMidFlightLen int
				snapshotCount   int
				err             error
			}

			resultCh := make(chan streamResult, 1)
			go func() {
				var res streamResult
				for {
					snap, recvErr := stream.Recv()
					if recvErr != nil {
						if !errors.Is(recvErr, io.EOF) && streamCtx.Err() == nil {
							res.err = recvErr
						}
						resultCh <- res
						return
					}

					res.snapshotCount++
					phase := snap.GetStatus().GetPhase()
					terminal := isTerminalPhase(phase)

					if !terminal {
						for _, msg := range snap.GetStatus().GetMessages() {
							if msg.GetType() != agentexecv1.MessageType_MESSAGE_AI {
								continue
							}
							content := strings.TrimSpace(msg.GetContent())
							if len(content) > res.maxMidFlightLen {
								res.maxMidFlightLen = len(content)
							}
							if msg.GetIsStreaming() && len(content) > 0 {
								res.sawStreamingPlanText = true
							}
						}
					}

					if terminal {
						resultCh <- res
						return
					}
				}
			}()

			res := <-resultCh
			streamCancel()

			if res.err != nil {
				harness.LogExecutionMessages(t, ctx, clients, executionID)
				require.NoError(t, res.err, "stream should not error for execution %s", executionID)
			}

			t.Logf("plan streaming: harness=%s execution=%s snapshots=%d sawStreamingText=%t maxMidFlightLen=%d",
				h.Name, executionID, res.snapshotCount, res.sawStreamingPlanText, res.maxMidFlightLen)

			assert.True(t, res.sawStreamingPlanText,
				"expected to observe the plan streaming live (an AI message with "+
					"is_streaming=true and non-empty content on a non-terminal snapshot); "+
					"if false, the plan only appeared at completion (no live processing) for %s",
				executionID)
		})
	}
}

// TestAgentExecution_PlanMode_PublishesPlanArtifact verifies the Phase 4
// contract: a completed Plan-mode execution publishes its plan as a first-class
// `plan.md` FILE artifact on status.artifacts, for BOTH harnesses (the Cursor
// harness gains an artifact path it did not previously have). This is the data
// the web console's Plan card renders and that an Implement follow-up
// references.
func TestAgentExecution_PlanMode_PublishesPlanArtifact(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 6*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-plan-artifact-"+h.Name,
				"You are a helpful software engineer. When in Plan mode, produce a "+
					"detailed plan without making any changes.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(), planPrompt,
				harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
					InteractionMode: agentexecv1.InteractionMode_INTERACTION_MODE_PLAN,
				}),
			)
			executionID := exec.GetMetadata().GetId()

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, executionID,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
			require.NoError(t, err, "plan-mode execution should complete")

			// The plan artifact is named from the plan's title (`<slug>.plan.md`),
			// falling back to the legacy `plan.md` when the plan has no title, so
			// detection keys on the filename convention, not an exact name.
			artifacts := result.GetStatus().GetArtifacts()
			var plan *agentexecv1.ExecutionArtifact
			for _, a := range artifacts {
				name := a.GetName()
				if name == "plan.md" || strings.HasSuffix(name, ".plan.md") {
					plan = a
					break
				}
			}

			require.NotNil(t, plan,
				"plan-mode execution should publish a plan artifact (*.plan.md, got %d artifacts) for %s",
				len(artifacts), executionID)

			assert.Equal(t,
				agentexecv1.ExecutionArtifactKind_EXECUTION_ARTIFACT_KIND_FILE, plan.GetKind(),
				"the plan should be a FILE artifact")
			assert.NotEmpty(t, plan.GetStorageKey(), "the plan should have a storage_key")
			assert.Contains(t, plan.GetStorageKey(), executionID,
				"the plan storage_key should be scoped to the execution")
			assert.Greater(t, plan.GetSizeBytes(), int64(0), "the plan should be non-empty")

			t.Logf("plan artifact: harness=%s execution=%s name=%s size=%d storage_key=%s",
				h.Name, executionID, plan.GetName(), plan.GetSizeBytes(), plan.GetStorageKey())
		})
	}
}
