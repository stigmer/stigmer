package harness

import (
	"context"
	"fmt"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"google.golang.org/grpc"
)

// Usage-report settling. Billing records are written asynchronously after an
// execution completes (the proxy dispatches each LLM call's record off the
// stream thread), so a report fetched immediately after EXECUTION_COMPLETED
// can be empty or partial. The benchmarks previously papered over this with a
// fixed 2s sleep, which both under-waits (a slow record lands at 2.1s and the
// run is silently under-counted) and over-waits (most records land well under
// a second). WaitForSettledUsageReport replaces the sleep with a bounded
// quiesce poll.
const (
	usageSettleTimeout      = 30 * time.Second
	usageSettlePollInterval = 500 * time.Millisecond
	// usageSettleStablePolls is how many consecutive unchanged re-reads the
	// aggregate must survive before it counts as settled. Two polls at the
	// production interval gives a ~1s quiet window — records from the same
	// execution arrive within milliseconds of each other, so a full second of
	// silence after the last write is a reliable completion signal.
	usageSettleStablePolls = 2
)

// usageReportFetcher is the one-method slice of AgentExecutionQueryControllerClient
// the settle loop needs, so the loop is unit-testable without a gRPC server.
type usageReportFetcher interface {
	GetExecutionUsageReport(ctx context.Context, in *agentexecv1.GetExecutionUsageReportInput,
		opts ...grpc.CallOption) (*agentexecv1.GetExecutionUsageReportOutput, error)
}

// usageSnapshot captures the aggregate fields whose stability defines "settled".
type usageSnapshot struct {
	llmCallCount   int32
	billableMicros int64
	providerMicros int64
	totalTokens    int64
}

func snapshotAggregate(agg *agentexecv1.UsageReportAggregate) usageSnapshot {
	return usageSnapshot{
		llmCallCount:   agg.GetLlmCallCount(),
		billableMicros: agg.GetBillableCostMicros(),
		providerMicros: agg.GetProviderCostMicros(),
		totalTokens: agg.GetInputTokens() + agg.GetOutputTokens() +
			agg.GetCacheCreationInputTokens() + agg.GetCacheReadInputTokens(),
	}
}

// WaitForSettledUsageReport polls the execution's usage report until billing
// has settled: at least one LLM-call record exists AND the aggregate is
// unchanged for usageSettleStablePolls consecutive re-reads. Returns the
// settled report, or an error when the deadline passes first.
//
// Transient RPC errors during polling are tolerated (retried until the
// deadline); the last one is included in the timeout error for diagnosis.
func WaitForSettledUsageReport(ctx context.Context, query usageReportFetcher,
	executionID string) (*agentexecv1.GetExecutionUsageReportOutput, error) {
	return waitForSettledUsageReport(ctx, query, executionID,
		usageSettleTimeout, usageSettlePollInterval)
}

func waitForSettledUsageReport(ctx context.Context, query usageReportFetcher,
	executionID string, timeout, pollInterval time.Duration,
) (*agentexecv1.GetExecutionUsageReportOutput, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var (
		lastReport *agentexecv1.GetExecutionUsageReportOutput
		lastSnap   usageSnapshot
		stable     int
		lastErr    error
	)

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		report, err := query.GetExecutionUsageReport(ctx,
			&agentexecv1.GetExecutionUsageReportInput{ExecutionId: executionID})
		switch {
		case err != nil:
			lastErr = err
			stable = 0
		case report.GetAggregate().GetLlmCallCount() == 0:
			// No records yet (or a nil aggregate) — keep waiting.
			stable = 0
		default:
			snap := snapshotAggregate(report.GetAggregate())
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
				return nil, fmt.Errorf("usage report for execution %s did not settle within %v (last fetch error: %w)",
					executionID, timeout, lastErr)
			}
			if lastReport == nil {
				return nil, fmt.Errorf("usage report for execution %s has no LLM-call records after %v — billing never landed",
					executionID, timeout)
			}
			return nil, fmt.Errorf("usage report for execution %s was still changing after %v (llm_calls=%d) — records may still be arriving",
				executionID, timeout, lastSnap.llmCallCount)
		case <-ticker.C:
		}
	}
}

// BenchmarkResult captures the cost, token usage, and timing for a single
// agent execution through a specific harness. Used for cross-harness
// cost comparison benchmarks.
type BenchmarkResult struct {
	Harness             string  `json:"harness"`
	CursorMode          string  `json:"cursor_mode,omitempty"`
	Model               string  `json:"model"`
	Provider            string  `json:"provider"`
	InputTokens         int64   `json:"input_tokens"`
	OutputTokens        int64   `json:"output_tokens"`
	CacheCreationTokens int64   `json:"cache_creation_tokens"`
	CacheReadTokens     int64   `json:"cache_read_tokens"`
	TotalTokens         int64   `json:"total_tokens"`
	BillableCostMicros  int64   `json:"billable_cost_micros"`
	ProviderCostMicros  int64   `json:"provider_cost_micros"`
	LLMCallCount        int32   `json:"llm_call_count"`
	TurnCount           int32   `json:"turn_count"`
	LatencyMs           int64   `json:"latency_ms"`
	ExecutionID         string  `json:"execution_id"`
	RunnerEstimatedCost float64 `json:"runner_estimated_cost_usd"`

	// Transcript carries the per-turn prompts and final assistant replies
	// for multi-turn runs (benchmark_multiturn.go), so reply quality can be
	// graded next to the cost numbers. Empty for single-shot cells.
	Transcript []*TurnTranscript `json:"transcript,omitempty"`
}

// EffectiveRate returns cost per token in micro-USD, useful for isolating
// pricing differences from token volume differences.
func (r *BenchmarkResult) EffectiveRate() float64 {
	if r.TotalTokens == 0 {
		return 0
	}
	return float64(r.BillableCostMicros) / float64(r.TotalTokens)
}

// BenchmarkComparison holds the result of comparing the two harnesses on the
// same prompt. Each side is a BenchmarkStat (N warm samples + cold first
// call); the ratio fields are computed from the two Representative samples so
// they reflect steady-state medians, not cold-cache outliers.
type BenchmarkComparison struct {
	Scenario           string         `json:"scenario"`
	Native             *BenchmarkStat `json:"native"`
	Cursor             *BenchmarkStat `json:"cursor"`
	CostRatio          float64        `json:"cost_ratio"`
	TokenVolumeRatio   float64        `json:"token_volume_ratio"`
	EffectiveRateRatio float64        `json:"effective_rate_ratio"`
}

// RunBenchmarkExecution creates an agent, session, and execution with the
// given prompt, waits for completion, and fetches the authoritative usage
// report from the server. Returns a structured BenchmarkResult.
//
// The modelName parameter allows specifying a model for model-parity tests.
// Pass empty string for the harness default.
func RunBenchmarkExecution(
	t *testing.T,
	ctx context.Context,
	clients *Clients,
	waiter *AgentExecutionWaiter,
	harness sessionv1.Harness,
	harnessName string,
	prompt string,
	scenarioName string,
	modelName string,
) *BenchmarkResult {
	t.Helper()

	agentName := fmt.Sprintf("bench-%s-%s", scenarioName, harnessName)
	agent := CreateAgent(t, ctx, clients, agentName,
		"You are a helpful assistant. Respond briefly and directly.")

	session := CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), harness)

	var opts []AgentExecutionOption
	if modelName != "" {
		opts = append(opts, WithExecutionConfig(&agentexecv1.ExecutionConfig{
			ModelName: modelName,
		}))
	}

	start := time.Now()
	exec := CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(), prompt, opts...)

	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	latencyMs := time.Since(start).Milliseconds()

	if err != nil {
		t.Logf("WARNING [%s/%s]: execution did not complete: %v", scenarioName, harnessName, err)
		return nil
	}

	executionID := result.GetMetadata().GetId()

	report, err := WaitForSettledUsageReport(ctx, clients.AgentExecutionQuery, executionID)
	if err != nil {
		t.Logf("WARNING [%s/%s]: usage report did not settle: %v", scenarioName, harnessName, err)
		return nil
	}

	agg := report.GetAggregate()

	// Extract model info from aggregate (authoritative) with fallback to breakdown
	model := agg.GetPrimaryModel()
	provider := agg.GetPrimaryProvider()
	if model == "" {
		if breakdown := report.GetModelBreakdown(); len(breakdown) > 0 {
			model = breakdown[0].GetModel()
			provider = breakdown[0].GetProvider()
		}
	}

	// Runner-reported usage (display-only, for cross-reference)
	var runnerEstimatedCost float64
	var turnCount int32
	if ru := result.GetStatus().GetStreamingUsage(); ru != nil {
		runnerEstimatedCost = ru.GetEstimatedCostUsd()
		turnCount = ru.GetTurnCount()
		if model == "" {
			model = ru.GetModel()
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
		TurnCount:           turnCount,
		LatencyMs:           latencyMs,
		ExecutionID:         executionID,
		RunnerEstimatedCost: runnerEstimatedCost,
	}

	t.Logf("[%s/%s] tokens: in=%d out=%d cache_read=%d cache_write=%d | cost: billable=%d provider=%d micros | model=%s | latency=%dms",
		scenarioName, harnessName,
		br.InputTokens, br.OutputTokens, br.CacheReadTokens, br.CacheCreationTokens,
		br.BillableCostMicros, br.ProviderCostMicros,
		br.Model, br.LatencyMs)

	return br
}

// RunBenchmarkStat measures one benchmark cell (scenario × harness) with the
// cold/warm methodology: one warmup execution that pays the prompt-cache
// write (kept as the cell's ColdFirstCall figure), then n warm measured
// repetitions folded into a BenchmarkStat. Each repetition is a fresh
// agent + session + execution so no conversation context accumulates; the
// prompt cache stays warm across repetitions because the provider keys it on
// the (identical) prompt prefix, not the session.
//
// Prefer odd n so the median is a single unambiguous sample. Returns nil
// when every measured repetition failed.
func RunBenchmarkStat(
	t *testing.T,
	ctx context.Context,
	clients *Clients,
	waiter *AgentExecutionWaiter,
	harness sessionv1.Harness,
	harnessName string,
	prompt string,
	scenarioName string,
	modelName string,
	n int,
) *BenchmarkStat {
	t.Helper()

	cold := RunBenchmarkExecution(t, ctx, clients, waiter,
		harness, harnessName, prompt, scenarioName+"-warm", modelName)
	if cold == nil {
		t.Logf("WARNING [%s/%s]: warmup execution failed — continuing without a cold-call figure", scenarioName, harnessName)
	}

	samples := make([]*BenchmarkResult, 0, n)
	for i := 1; i <= n; i++ {
		sample := RunBenchmarkExecution(t, ctx, clients, waiter,
			harness, harnessName, prompt, fmt.Sprintf("%s-r%d", scenarioName, i), modelName)
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

// CompareBenchmarks compares one native run against one cursor run by
// wrapping each into a single-sample BenchmarkStat. This keeps the quick
// single-shot scenarios (simple-reply, medium-context, parity spot checks)
// on the same comparison and report path as the N-repetition report cells.
func CompareBenchmarks(t *testing.T, scenario string, native, cursor *BenchmarkResult) *BenchmarkComparison {
	t.Helper()
	return CompareBenchmarkStats(t, scenario,
		NewBenchmarkStat([]*BenchmarkResult{native}, nil),
		NewBenchmarkStat([]*BenchmarkResult{cursor}, nil))
}

// CompareBenchmarkStats logs a structured comparison between the two
// harnesses' cell statistics and emits warnings when cost ratios exceed
// thresholds or a cell's resolved model drifted. Ratios are computed from
// the Representative (median-billable) samples. Returns the comparison
// struct for inclusion in the report.
func CompareBenchmarkStats(t *testing.T, scenario string, nativeStat, cursorStat *BenchmarkStat) *BenchmarkComparison {
	t.Helper()

	if nativeStat == nil || cursorStat == nil {
		t.Logf("WARNING [%s]: cannot compare — one or both harness results are nil", scenario)
		return nil
	}

	native := nativeStat.Representative
	cursor := cursorStat.Representative

	comp := &BenchmarkComparison{
		Scenario: scenario,
		Native:   nativeStat,
		Cursor:   cursorStat,
	}

	if cursor.BillableCostMicros > 0 {
		comp.CostRatio = float64(native.BillableCostMicros) / float64(cursor.BillableCostMicros)
	}

	if cursor.TotalTokens > 0 {
		comp.TokenVolumeRatio = float64(native.TotalTokens) / float64(cursor.TotalTokens)
	}

	cursorRate := cursor.EffectiveRate()
	nativeRate := native.EffectiveRate()
	if cursorRate > 0 {
		comp.EffectiveRateRatio = nativeRate / cursorRate
	}

	t.Logf("")
	t.Logf("═══ BENCHMARK COMPARISON: %s (median of native n=%d, cursor n=%d) ═══", scenario, nativeStat.N, cursorStat.N)
	t.Logf("┌─────────────────────┬──────────────┬──────────────┐")
	t.Logf("│ Metric              │ Native       │ Cursor       │")
	t.Logf("├─────────────────────┼──────────────┼──────────────┤")
	t.Logf("│ Model               │ %-12s │ %-12s │", truncate(native.Model, 12), truncate(cursor.Model, 12))
	t.Logf("│ Input Tokens        │ %12d │ %12d │", native.InputTokens, cursor.InputTokens)
	t.Logf("│ Output Tokens       │ %12d │ %12d │", native.OutputTokens, cursor.OutputTokens)
	t.Logf("│ Cache Read Tokens   │ %12d │ %12d │", native.CacheReadTokens, cursor.CacheReadTokens)
	t.Logf("│ Cache Write Tokens  │ %12d │ %12d │", native.CacheCreationTokens, cursor.CacheCreationTokens)
	t.Logf("│ Total Tokens        │ %12d │ %12d │", native.TotalTokens, cursor.TotalTokens)
	t.Logf("│ Billable (micros)   │ %12d │ %12d │", native.BillableCostMicros, cursor.BillableCostMicros)
	t.Logf("│ Provider (micros)   │ %12d │ %12d │", native.ProviderCostMicros, cursor.ProviderCostMicros)
	t.Logf("│ LLM Calls           │ %12d │ %12d │", native.LLMCallCount, cursor.LLMCallCount)
	t.Logf("│ Latency (ms)        │ %12d │ %12d │", native.LatencyMs, cursor.LatencyMs)
	t.Logf("└─────────────────────┴──────────────┴──────────────┘")
	t.Logf("")
	t.Logf("  Cost Ratio (native/cursor):     %.2fx", comp.CostRatio)
	t.Logf("  Token Volume Ratio:             %.2fx", comp.TokenVolumeRatio)
	t.Logf("  Effective Rate Ratio:           %.2fx", comp.EffectiveRateRatio)
	logStatContext(t, "native", nativeStat)
	logStatContext(t, "cursor", cursorStat)
	t.Logf("")

	// Emit warnings (not failures) when ratios exceed thresholds
	const (
		costRatioThreshold  = 2.0
		tokenRatioThreshold = 1.5
		rateRatioThreshold  = 2.0
	)

	if comp.CostRatio > costRatioThreshold {
		t.Logf("⚠ WARNING [%s]: cost ratio %.2fx exceeds threshold %.1fx — native is significantly more expensive",
			scenario, comp.CostRatio, costRatioThreshold)
	}
	if comp.TokenVolumeRatio > tokenRatioThreshold {
		t.Logf("⚠ WARNING [%s]: token volume ratio %.2fx exceeds threshold %.1fx — native sends more tokens for the same prompt",
			scenario, comp.TokenVolumeRatio, tokenRatioThreshold)
	}
	if comp.EffectiveRateRatio > rateRatioThreshold {
		t.Logf("⚠ WARNING [%s]: effective rate ratio %.2fx exceeds threshold %.1fx — pricing difference alone is significant",
			scenario, comp.EffectiveRateRatio, rateRatioThreshold)
	}
	if nativeStat.ModelDrift() {
		t.Logf("⚠ WARNING [%s]: native resolved model drifted across the cell (%v) — numbers mix models",
			scenario, nativeStat.Models)
	}
	if cursorStat.ModelDrift() {
		t.Logf("⚠ WARNING [%s]: cursor resolved model drifted across the cell (%v) — numbers mix models",
			scenario, cursorStat.Models)
	}

	return comp
}

// logStatContext prints the per-cell honesty figures that accompany the
// median in any published number: sample count, spread, cache-hit ratio,
// and the cold first-call cost when a warmup was measured.
func logStatContext(t *testing.T, side string, stat *BenchmarkStat) {
	t.Helper()
	line := fmt.Sprintf("  %s: n=%d spread=%d micros cache_hit=%.1f%%",
		side, stat.N, stat.BillableSpreadMicros, stat.CacheHitRatio*100)
	if stat.ColdFirstCall != nil {
		line += fmt.Sprintf(" cold_first_call=%d micros", stat.ColdFirstCall.BillableCostMicros)
	}
	t.Logf("%s", line)
}

// CursorModeComparison holds the result of comparing local vs cloud cursor
// runs on the same prompt. Focuses on latency and token overhead differences
// between Cursor SDK runtimes.
type CursorModeComparison struct {
	Scenario     string           `json:"scenario"`
	Local        *BenchmarkResult `json:"local"`
	Cloud        *BenchmarkResult `json:"cloud"`
	LatencyRatio float64          `json:"latency_ratio"`
	TokenDelta   int64            `json:"token_delta"`
	ModelMatch   bool             `json:"model_match"`
	CostRatio    float64          `json:"cost_ratio"`
}

// RunCursorModeBenchmark creates an agent and session with the specified
// CursorMode, runs the prompt, and collects a BenchmarkResult. The session
// is created with an explicit cursor_mode to override auto-detection.
func RunCursorModeBenchmark(
	t *testing.T,
	ctx context.Context,
	clients *Clients,
	waiter *AgentExecutionWaiter,
	cursorMode sessionv1.CursorMode,
	modeName string,
	prompt string,
	scenarioName string,
	modelName string,
	sessionOpts ...SessionOption,
) *BenchmarkResult {
	t.Helper()

	agentName := fmt.Sprintf("bench-%s-cursor-%s", scenarioName, modeName)
	agent := CreateAgent(t, ctx, clients, agentName,
		"You are a helpful assistant. Respond briefly and directly.")

	allOpts := append([]SessionOption{WithCursorMode(cursorMode)}, sessionOpts...)
	session := CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
		allOpts...)

	var execOpts []AgentExecutionOption
	if modelName != "" {
		execOpts = append(execOpts, WithExecutionConfig(&agentexecv1.ExecutionConfig{
			ModelName: modelName,
		}))
	}

	start := time.Now()
	exec := CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(), prompt, execOpts...)

	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 6*time.Minute)
	latencyMs := time.Since(start).Milliseconds()

	if err != nil {
		t.Logf("WARNING [%s/cursor-%s]: execution did not complete: %v", scenarioName, modeName, err)
		return nil
	}

	executionID := result.GetMetadata().GetId()

	report, err := WaitForSettledUsageReport(ctx, clients.AgentExecutionQuery, executionID)
	if err != nil {
		t.Logf("WARNING [%s/cursor-%s]: usage report did not settle: %v", scenarioName, modeName, err)
		return nil
	}

	agg := report.GetAggregate()

	model := agg.GetPrimaryModel()
	provider := agg.GetPrimaryProvider()
	if model == "" {
		if breakdown := report.GetModelBreakdown(); len(breakdown) > 0 {
			model = breakdown[0].GetModel()
			provider = breakdown[0].GetProvider()
		}
	}

	var runnerEstimatedCost float64
	var turnCount int32
	if ru := result.GetStatus().GetStreamingUsage(); ru != nil {
		runnerEstimatedCost = ru.GetEstimatedCostUsd()
		turnCount = ru.GetTurnCount()
		if model == "" {
			model = ru.GetModel()
		}
	}

	br := &BenchmarkResult{
		Harness:             "cursor",
		CursorMode:          modeName,
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
		TurnCount:           turnCount,
		LatencyMs:           latencyMs,
		ExecutionID:         executionID,
		RunnerEstimatedCost: runnerEstimatedCost,
	}

	t.Logf("[%s/cursor-%s] tokens: in=%d out=%d cache_read=%d cache_write=%d | cost: provider=%d micros | model=%s | latency=%dms",
		scenarioName, modeName,
		br.InputTokens, br.OutputTokens, br.CacheReadTokens, br.CacheCreationTokens,
		br.ProviderCostMicros,
		br.Model, br.LatencyMs)

	return br
}

// CompareCursorModes logs a structured comparison between cursor-local and
// cursor-cloud benchmark results. The comparison focuses on latency (the
// primary signal for runtime overhead) and token counts (which reveal
// different system prompt loading between runtimes).
func CompareCursorModes(t *testing.T, scenario string, local, cloud *BenchmarkResult) *CursorModeComparison {
	t.Helper()

	if local == nil || cloud == nil {
		t.Logf("WARNING [%s]: cannot compare cursor modes — one or both results are nil", scenario)
		return nil
	}

	comp := &CursorModeComparison{
		Scenario:   scenario,
		Local:      local,
		Cloud:      cloud,
		TokenDelta: cloud.TotalTokens - local.TotalTokens,
		ModelMatch: local.Model == cloud.Model,
	}

	if local.LatencyMs > 0 {
		comp.LatencyRatio = float64(cloud.LatencyMs) / float64(local.LatencyMs)
	}

	if local.ProviderCostMicros > 0 {
		comp.CostRatio = float64(cloud.ProviderCostMicros) / float64(local.ProviderCostMicros)
	}

	t.Logf("")
	t.Logf("═══ CURSOR MODE COMPARISON: %s ═══", scenario)
	t.Logf("┌─────────────────────┬──────────────┬──────────────┐")
	t.Logf("│ Metric              │ Local        │ Cloud        │")
	t.Logf("├─────────────────────┼──────────────┼──────────────┤")
	t.Logf("│ Model               │ %-12s │ %-12s │", truncate(local.Model, 12), truncate(cloud.Model, 12))
	t.Logf("│ Input Tokens        │ %12d │ %12d │", local.InputTokens, cloud.InputTokens)
	t.Logf("│ Output Tokens       │ %12d │ %12d │", local.OutputTokens, cloud.OutputTokens)
	t.Logf("│ Cache Read Tokens   │ %12d │ %12d │", local.CacheReadTokens, cloud.CacheReadTokens)
	t.Logf("│ Cache Write Tokens  │ %12d │ %12d │", local.CacheCreationTokens, cloud.CacheCreationTokens)
	t.Logf("│ Total Tokens        │ %12d │ %12d │", local.TotalTokens, cloud.TotalTokens)
	t.Logf("│ Provider (micros)   │ %12d │ %12d │", local.ProviderCostMicros, cloud.ProviderCostMicros)
	t.Logf("│ LLM Calls           │ %12d │ %12d │", local.LLMCallCount, cloud.LLMCallCount)
	t.Logf("│ Latency (ms)        │ %12d │ %12d │", local.LatencyMs, cloud.LatencyMs)
	t.Logf("└─────────────────────┴──────────────┴──────────────┘")
	t.Logf("")
	t.Logf("  Latency Ratio (cloud/local):    %.2fx", comp.LatencyRatio)
	t.Logf("  Token Delta (cloud - local):    %+d", comp.TokenDelta)
	t.Logf("  Cost Ratio (cloud/local):       %.2fx", comp.CostRatio)
	t.Logf("  Model Match:                    %v", comp.ModelMatch)
	t.Logf("")

	if !comp.ModelMatch {
		t.Logf("WARNING [%s]: models diverged — local=%q, cloud=%q — comparison may not be apples-to-apples",
			scenario, local.Model, cloud.Model)
	}

	if comp.LatencyRatio > 3.0 {
		t.Logf("WARNING [%s]: cloud latency %.2fx local — VM provisioning may dominate",
			scenario, comp.LatencyRatio)
	}

	return comp
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-1] + "…"
}
