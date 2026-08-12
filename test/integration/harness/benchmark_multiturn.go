package harness

// Multi-turn benchmark cells and named-arm comparisons.
//
// The original benchmark grid (benchmark_helpers.go) is cross-HARNESS
// (native vs cursor) and single-shot by design: each cell is a fresh
// agent + session + one execution so no conversation context accumulates.
// That grid answers "which engine is cheaper for the same prompt" — the
// published docs-site comparison — but it cannot answer the two questions
// a chat surface (WhatsApp, Slack) actually poses:
//
//  1. What does a CONVERSATION cost? Per-turn cost grows with history, so
//     a single-shot cell understates chat unit economics. A multi-turn
//     cell runs a scripted conversation in one session and measures it as
//     a unit, from the session's authoritative usage report.
//
//  2. Which MODEL should a chat surface pin, on the SAME harness? Channel
//     turns run a platform-pinned model (stigmer-cloud
//     `stigmer.channels.execution-profile.model-name`), and that pin must
//     come from calibration evidence. Cross-harness BenchmarkComparison
//     is the persisted contract behind the published comparison page, so
//     its Native/Cursor field names stay untouched; same-harness
//     model-vs-model runs get their own named-arm types instead of
//     overloading those fields with something they don't mean.
//
// Cost alone cannot pick a chat model — a cheap model that fumbles tool
// calls is worthless — so every multi-turn result carries its transcript
// (final assistant reply per turn) for a human or judge to grade next to
// the numbers.

import (
	"context"
	"fmt"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"google.golang.org/grpc"
)

// TurnTranscript is one turn of a multi-turn benchmark conversation: what
// was asked, what the agent finally replied, and where to find the full
// execution if the one-line reply needs drilling into.
type TurnTranscript struct {
	// Turn is 1-based, matching how humans read conversations.
	Turn        int    `json:"turn"`
	Prompt      string `json:"prompt"`
	Reply       string `json:"reply"`
	ExecutionID string `json:"execution_id"`
	LatencyMs   int64  `json:"latency_ms"`
}

// sessionUsageReportFetcher is the one-method slice of
// AgentExecutionQueryControllerClient the session settle loop needs — the
// same seam pattern as usageReportFetcher (benchmark_helpers.go), and for
// the same reason: unit-testable without a gRPC server.
type sessionUsageReportFetcher interface {
	GetSessionUsageReport(ctx context.Context, in *agentexecv1.GetSessionUsageReportInput,
		opts ...grpc.CallOption) (*agentexecv1.GetSessionUsageReportOutput, error)
}

// WaitForSettledSessionUsageReport is the session-level twin of
// WaitForSettledUsageReport: billing records land asynchronously after each
// execution completes, so a session report fetched right after the last
// turn can still be missing that turn's records. Settled means at least one
// LLM-call record exists AND the session aggregate is unchanged for
// usageSettleStablePolls consecutive re-reads.
func WaitForSettledSessionUsageReport(ctx context.Context, query sessionUsageReportFetcher,
	sessionID string) (*agentexecv1.GetSessionUsageReportOutput, error) {
	return waitForSettledSessionUsageReport(ctx, query, sessionID,
		usageSettleTimeout, usageSettlePollInterval)
}

func waitForSettledSessionUsageReport(ctx context.Context, query sessionUsageReportFetcher,
	sessionID string, timeout, pollInterval time.Duration,
) (*agentexecv1.GetSessionUsageReportOutput, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var (
		lastReport *agentexecv1.GetSessionUsageReportOutput
		lastSnap   usageSnapshot
		stable     int
		lastErr    error
	)

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		report, err := query.GetSessionUsageReport(ctx,
			&agentexecv1.GetSessionUsageReportInput{SessionId: sessionID})
		switch {
		case err != nil:
			lastErr = err
			stable = 0
		case report.GetTotalUsage().GetLlmCallCount() == 0:
			stable = 0
		default:
			snap := snapshotAggregate(report.GetTotalUsage())
			if lastReport != nil && snap == lastSnap {
				stable++
				if stable >= usageSettleStablePolls {
					return report, nil
				}
			} else {
				stable = 0
			}
			lastSnap = snap
			lastReport = report
		}

		select {
		case <-ctx.Done():
			if lastErr != nil {
				return nil, fmt.Errorf("usage report for session %s did not settle within %v (last fetch error: %w)",
					sessionID, timeout, lastErr)
			}
			if lastReport == nil {
				return nil, fmt.Errorf("usage report for session %s has no LLM-call records after %v — billing never landed",
					sessionID, timeout)
			}
			return nil, fmt.Errorf("usage report for session %s was still changing after %v (llm_calls=%d) — records may still be arriving",
				sessionID, timeout, lastSnap.llmCallCount)
		case <-ticker.C:
		}
	}
}

// RunMultiTurnBenchmark runs one scripted conversation — a fresh session on
// the given harness, one execution per turn, the model pinned on EVERY turn
// (model is per-execution; an unpinned follow-up would silently revert to
// the harness default) — and measures the conversation as a unit from the
// session's authoritative usage report.
//
// The agent is caller-supplied (by instance id) rather than created here so
// scenarios can attach the fixtures that shape real context: MCP servers
// (tool schemas re-enter context every turn), skills.
//
// Returns nil when any turn fails — a partial conversation's cost is not
// comparable to a complete one.
func RunMultiTurnBenchmark(
	t *testing.T,
	ctx context.Context,
	clients *Clients,
	waiter *AgentExecutionWaiter,
	agentInstanceID string,
	harness sessionv1.Harness,
	harnessName string,
	scenarioName string,
	turns []string,
	modelName string,
) *BenchmarkResult {
	t.Helper()

	session := CreateTestSession(t, ctx, clients, agentInstanceID, harness)
	sessionID := session.GetMetadata().GetId()

	var totalLatencyMs int64
	transcript := make([]*TurnTranscript, 0, len(turns))

	for i, turn := range turns {
		var opts []AgentExecutionOption
		if modelName != "" {
			opts = append(opts, WithExecutionConfig(&agentexecv1.ExecutionConfig{
				ModelName: modelName,
			}))
		}

		start := time.Now()
		exec := CreateTestAgentExecution(t, ctx, clients, sessionID, turn, opts...)

		result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
			agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
		turnLatencyMs := time.Since(start).Milliseconds()
		totalLatencyMs += turnLatencyMs

		if err != nil {
			t.Logf("WARNING [%s/%s]: turn %d/%d failed: %v",
				scenarioName, harnessName, i+1, len(turns), err)
			return nil
		}

		transcript = append(transcript, &TurnTranscript{
			Turn:        i + 1,
			Prompt:      turn,
			Reply:       finalAssistantMessage(result),
			ExecutionID: result.GetMetadata().GetId(),
			LatencyMs:   turnLatencyMs,
		})
	}

	report, err := WaitForSettledSessionUsageReport(ctx, clients.AgentExecutionQuery, sessionID)
	if err != nil {
		t.Logf("WARNING [%s/%s]: session usage report did not settle: %v", scenarioName, harnessName, err)
		return nil
	}

	agg := report.GetTotalUsage()

	model := agg.GetPrimaryModel()
	provider := agg.GetPrimaryProvider()
	if model == "" {
		if breakdown := report.GetModelBreakdown(); len(breakdown) > 0 {
			model = breakdown[0].GetModel()
			provider = breakdown[0].GetProvider()
		}
	}

	br := &BenchmarkResult{
		Harness:             harnessName,
		Model:               model,
		Provider:            provider,
		InputTokens:         agg.GetInputTokens(),
		OutputTokens:        agg.GetOutputTokens(),
		CacheCreationTokens: agg.GetCacheCreationInputTokens(),
		CacheReadTokens:     agg.GetCacheReadInputTokens(),
		TotalTokens:         agg.GetInputTokens() + agg.GetOutputTokens() + agg.GetCacheCreationInputTokens() + agg.GetCacheReadInputTokens(),
		BillableCostMicros:  agg.GetBillableCostMicros(),
		ProviderCostMicros:  agg.GetProviderCostMicros(),
		LLMCallCount:        agg.GetLlmCallCount(),
		TurnCount:           int32(len(turns)),
		LatencyMs:           totalLatencyMs,
		ExecutionID:         transcript[len(transcript)-1].ExecutionID,
		Transcript:          transcript,
	}

	t.Logf("[%s/%s] conversation of %d turns: tokens: in=%d out=%d cache_read=%d cache_write=%d | cost: billable=%d provider=%d micros | model=%s | latency=%dms",
		scenarioName, harnessName, len(turns),
		br.InputTokens, br.OutputTokens, br.CacheReadTokens, br.CacheCreationTokens,
		br.BillableCostMicros, br.ProviderCostMicros,
		br.Model, br.LatencyMs)

	return br
}

// RunMultiTurnBenchmarkStat measures one multi-turn cell with the same
// cold/warm methodology as RunBenchmarkStat: one discarded warmup
// conversation that pays the prompt-cache write, then n measured
// conversations folded into a BenchmarkStat. Each repetition is a fresh
// session so history never leaks between conversations; the provider's
// prompt cache stays warm across repetitions because it keys on the
// (identical) prompt prefix, not the session.
func RunMultiTurnBenchmarkStat(
	t *testing.T,
	ctx context.Context,
	clients *Clients,
	waiter *AgentExecutionWaiter,
	agentInstanceID string,
	harness sessionv1.Harness,
	harnessName string,
	scenarioName string,
	turns []string,
	modelName string,
	n int,
) *BenchmarkStat {
	t.Helper()

	cold := RunMultiTurnBenchmark(t, ctx, clients, waiter, agentInstanceID,
		harness, harnessName, scenarioName+"-warm", turns, modelName)
	if cold == nil {
		t.Logf("WARNING [%s/%s]: warmup conversation failed — continuing without a cold-call figure", scenarioName, harnessName)
	}

	samples := make([]*BenchmarkResult, 0, n)
	for i := 1; i <= n; i++ {
		sample := RunMultiTurnBenchmark(t, ctx, clients, waiter, agentInstanceID,
			harness, harnessName, fmt.Sprintf("%s-r%d", scenarioName, i), turns, modelName)
		if sample == nil {
			t.Logf("WARNING [%s/%s]: repetition %d/%d failed — excluded from statistics", scenarioName, harnessName, i, n)
			continue
		}
		samples = append(samples, sample)
	}

	stat := NewBenchmarkStat(samples, cold)
	if stat == nil {
		t.Logf("WARNING [%s/%s]: all %d measured repetitions failed", scenarioName, harnessName, n)
		return nil
	}
	if stat.N < n {
		t.Logf("WARNING [%s/%s]: only %d/%d repetitions succeeded — spread/median are less robust", scenarioName, harnessName, stat.N, n)
	}
	return stat
}

// finalAssistantMessage returns the content of the last MESSAGE_AI entry in
// the execution's transcript — the reply the end user would actually see.
// Empty when the execution produced no assistant message (which channel
// delivery treats as a failure, so a benchmark should surface it too, as an
// empty transcript line rather than a silently dropped turn).
func finalAssistantMessage(exec *agentexecv1.AgentExecution) string {
	var reply string
	for _, m := range exec.GetStatus().GetMessages() {
		if m.GetType() == agentexecv1.MessageType_MESSAGE_AI && m.GetContent() != "" {
			reply = m.GetContent()
		}
	}
	return reply
}

// BenchmarkArm is one named side of a same-harness comparison: a model (or
// any other single-variable variant) and its measured cell.
type BenchmarkArm struct {
	Name string         `json:"name"`
	Stat *BenchmarkStat `json:"stat"`
}

// ArmComparison compares N named arms of the same scenario on the same
// harness. The FIRST arm is the baseline every ratio is computed against —
// order the arms so the incumbent (or cheapest candidate) comes first.
type ArmComparison struct {
	Scenario string          `json:"scenario"`
	Arms     []*BenchmarkArm `json:"arms"`
	// CostRatioVsFirst maps arm name → representative billable cost divided
	// by the first arm's. The baseline is always 1.0; 2.0 means "twice the
	// baseline's cost".
	CostRatioVsFirst map[string]float64 `json:"cost_ratio_vs_first"`
}

// CompareArms logs a structured comparison across named arms and returns
// the comparison for report inclusion. Arms whose stat is nil (every
// repetition failed) are logged and dropped. Returns nil when fewer than
// two arms survive — a single arm has nothing to compare against.
func CompareArms(t *testing.T, scenario string, arms []*BenchmarkArm) *ArmComparison {
	t.Helper()

	valid := make([]*BenchmarkArm, 0, len(arms))
	for _, arm := range arms {
		if arm == nil || arm.Stat == nil {
			name := "?"
			if arm != nil {
				name = arm.Name
			}
			t.Logf("WARNING [%s]: arm %q produced no statistics — dropped from comparison", scenario, name)
			continue
		}
		valid = append(valid, arm)
	}
	if len(valid) < 2 {
		t.Logf("WARNING [%s]: fewer than two arms survived — nothing to compare", scenario)
		return nil
	}

	baseline := valid[0].Stat.Representative
	comp := &ArmComparison{
		Scenario:         scenario,
		Arms:             valid,
		CostRatioVsFirst: make(map[string]float64, len(valid)),
	}

	t.Logf("")
	t.Logf("═══ ARM COMPARISON: %s (baseline: %s) ═══", scenario, valid[0].Name)
	for _, arm := range valid {
		rep := arm.Stat.Representative

		ratio := 0.0
		if baseline.BillableCostMicros > 0 {
			ratio = float64(rep.BillableCostMicros) / float64(baseline.BillableCostMicros)
		}
		comp.CostRatioVsFirst[arm.Name] = ratio

		t.Logf("  %-28s billable=%-8d micros (%.2fx) tokens=%-8d cache_hit=%.1f%% latency=%-6dms model=%s",
			arm.Name, rep.BillableCostMicros, ratio, rep.TotalTokens,
			arm.Stat.CacheHitRatio*100, rep.LatencyMs, rep.Model)
		logStatContext(t, arm.Name, arm.Stat)

		if arm.Stat.ModelDrift() {
			t.Logf("⚠ WARNING [%s]: arm %q resolved more than one model (%v) — the pin did not hold and the numbers mix models",
				scenario, arm.Name, arm.Stat.Models)
		}
	}
	t.Logf("")

	return comp
}

// ArmReport is the persisted output of a named-arm calibration run. It is a
// separate artifact from BenchmarkReport on purpose: that type's summary
// fields (TotalNativeCostMicros / TotalCursorCostMicros) are the data
// contract of the published cross-harness comparison and mean nothing for
// same-harness arms. No trend machinery yet — add it when a second consumer
// needs it, not before.
type ArmReport struct {
	Timestamp   string           `json:"timestamp"`
	GitSHA      string           `json:"git_sha,omitempty"`
	Comparisons []*ArmComparison `json:"comparisons"`
}

const armReportDir = "model-calibration-results"

// NewArmReport assembles a timestamped report from arm comparisons.
func NewArmReport(comparisons []*ArmComparison, gitSHA string) *ArmReport {
	return &ArmReport{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		GitSHA:      gitSHA,
		Comparisons: comparisons,
	}
}

// WriteArmReport persists the report as timestamped JSON under
// outputDir/model-calibration-results, mirroring WriteBenchmarkReport.
func WriteArmReport(outputDir string, report *ArmReport) (string, error) {
	return writeTimestampedJSON(outputDir, armReportDir, report)
}
