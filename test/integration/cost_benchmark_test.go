//go:build integration && benchmark

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

// Cost benchmark tests compare execution costs between Native and Cursor
// harnesses for identical prompts. These tests:
//
//   - Do NOT fail on cost differences (warnings only)
//   - Require both ANTHROPIC_API_KEY and CURSOR_API_KEY
//   - Are gated behind the "benchmark" build tag (never run in routine CI)
//   - Persist JSON reports for historical trend tracking
//
// Run via: make benchmark-cost (from test/integration/)

// --- Scenario: Simple Reply (minimal token exchange) ---

func TestCostBenchmark_SimpleReply(t *testing.T) {
	native, cursor := runScenarioBothHarnesses(t,
		"simple-reply",
		"Reply with exactly: hello",
		"", // default model per harness
	)
	harness.CompareBenchmarks(t, "simple-reply", native, cursor)
}

// --- Scenario: Medium Context (substantial input, brief output) ---

func TestCostBenchmark_MediumContext(t *testing.T) {
	prompt := `You are analyzing the following software architecture description. Read it carefully and provide a one-sentence summary.

The system consists of three main services: an API gateway that handles authentication and rate limiting, a core processing engine that executes business logic through a series of pipeline stages, and a persistence layer that manages both relational data in PostgreSQL and document storage in MongoDB. The API gateway uses JWT tokens validated against an identity provider, with token refresh handled transparently by middleware. The processing engine implements a saga pattern for distributed transactions, with compensation logic for each step. The persistence layer abstracts storage behind repository interfaces, allowing the core engine to remain storage-agnostic. Inter-service communication uses gRPC for synchronous calls and Apache Kafka for asynchronous event streaming. Each service exposes health check endpoints consumed by Kubernetes readiness probes. Observability is handled through OpenTelemetry, with traces propagated across service boundaries via W3C Trace Context headers.

Provide your one-sentence summary now.`

	native, cursor := runScenarioBothHarnesses(t,
		"medium-context",
		prompt,
		"", // default model per harness
	)
	harness.CompareBenchmarks(t, "medium-context", native, cursor)
}

// --- Scenario: Model Parity (same model, both harnesses) ---
//
// This is the most scientifically valuable test: it isolates infrastructure
// optimizations (caching, routing, context management) from pricing differences
// by forcing both harnesses to use the same underlying model.

func TestCostBenchmark_ModelParity_Sonnet4(t *testing.T) {
	// "claude-sonnet-4" is available in both native and cursor harness
	// entries in the model registry. This forces apples-to-apples comparison.
	native, cursor := runScenarioBothHarnesses(t,
		"model-parity-sonnet4",
		"Reply with exactly: hello",
		"claude-sonnet-4",
	)
	harness.CompareBenchmarks(t, "model-parity-sonnet4", native, cursor)
}

func TestCostBenchmark_ModelParity_MediumContext(t *testing.T) {
	prompt := `Summarize in one sentence: A distributed system uses event sourcing with CQRS to separate read and write models. Commands are validated, persisted as events, and projected into read-optimized views. The event store uses append-only logs for durability while projections are rebuilt from the event stream on demand.`

	native, cursor := runScenarioBothHarnesses(t,
		"model-parity-medium",
		prompt,
		"claude-sonnet-4",
	)
	harness.CompareBenchmarks(t, "model-parity-medium", native, cursor)
}

// --- Scenario: Multi-Turn (context accumulation cost) ---

func TestCostBenchmark_MultiTurn(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	turns := []string{
		"Remember this fact: the capital of France is Paris.",
		"What is the capital of France?",
		"Now tell me: what was the first thing I told you?",
	}

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			result := runMultiTurnBenchmark(t, ctx, clients, waiter, h, turns, "")
			if result != nil {
				t.Logf("[multi-turn/%s] total: billable=%d micros, tokens=%d, latency=%dms",
					h.Name, result.BillableCostMicros, result.TotalTokens, result.LatencyMs)
			}
		})
	}
}

// --- Aggregate Report Generation ---

func TestCostBenchmark_Report(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	requireBothHarnesses(t)

	type scenario struct {
		name      string
		prompt    string
		modelName string
	}

	scenarios := []scenario{
		{
			name:   "report-simple",
			prompt: "Reply with exactly: hello",
		},
		{
			name:   "report-medium",
			prompt: "Explain in one sentence what a hash table is.",
		},
		{
			name:      "report-parity-simple",
			prompt:    "Reply with exactly: hello",
			modelName: "claude-sonnet-4",
		},
		{
			name:      "report-parity-medium",
			prompt:    "Explain in one sentence what a hash table is.",
			modelName: "claude-sonnet-4",
		},
	}

	var comparisons []*harness.BenchmarkComparison
	for _, s := range scenarios {
		native := harness.RunBenchmarkExecution(t, ctx, clients, waiter,
			sessionv1.Harness_HARNESS_NATIVE, "native", s.prompt, s.name, s.modelName)
		cursor := harness.RunBenchmarkExecution(t, ctx, clients, waiter,
			sessionv1.Harness_HARNESS_CURSOR, "cursor", s.prompt, s.name, s.modelName)

		comp := harness.CompareBenchmarks(t, s.name, native, cursor)
		if comp != nil {
			comparisons = append(comparisons, comp)
		}
	}

	if len(comparisons) == 0 {
		t.Log("WARNING: no benchmark comparisons completed — skipping report generation")
		return
	}

	gitSHA := harness.GetGitSHA()
	report := harness.NewBenchmarkReport(comparisons, gitSHA)

	outputDir := testHarness.LogDir()
	if outputDir == "" {
		outputDir = ".test-output"
	}
	// Write to the parent of logs/ so reports sit alongside logs
	reportOutputDir := outputDir + "/.."

	previous, err := harness.LoadPreviousReport(reportOutputDir)
	if err != nil {
		t.Logf("WARNING: failed to load previous report: %v", err)
	}

	trend := harness.ComputeTrend(report, previous)
	harness.LogTrend(t, trend)

	reportPath, err := harness.WriteBenchmarkReport(reportOutputDir, report)
	if err != nil {
		t.Logf("WARNING: failed to write benchmark report: %v", err)
	} else {
		t.Logf("Benchmark report written: %s", reportPath)
	}

	// Log final summary
	t.Logf("")
	t.Logf("═══ BENCHMARK SUMMARY ═══")
	t.Logf("  Scenarios:          %d", report.Summary.ScenarioCount)
	t.Logf("  Total Native Cost:  %d micros ($%.4f)",
		report.Summary.TotalNativeCostMicros, float64(report.Summary.TotalNativeCostMicros)/1_000_000)
	t.Logf("  Total Cursor Cost:  %d micros ($%.4f)",
		report.Summary.TotalCursorCostMicros, float64(report.Summary.TotalCursorCostMicros)/1_000_000)
	t.Logf("  Overall Cost Ratio: %.2fx", report.Summary.OverallCostRatio)
	t.Logf("")
}

// --- Helpers ---

func runScenarioBothHarnesses(t *testing.T, scenario, prompt, modelName string) (native, cursor *harness.BenchmarkResult) {
	t.Helper()
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			result := harness.RunBenchmarkExecution(t, ctx, clients, waiter,
				h.Harness, h.Name, prompt, scenario, modelName)

			switch h.Name {
			case "native":
				native = result
			case "cursor":
				cursor = result
			}
		})
	}

	return native, cursor
}

func runMultiTurnBenchmark(
	t *testing.T,
	ctx context.Context,
	clients *harness.Clients,
	waiter *harness.AgentExecutionWaiter,
	h harness.HarnessConfig,
	turns []string,
	modelName string,
) *harness.BenchmarkResult {
	t.Helper()

	agentName := "bench-multiturn-" + h.Name
	agent := harness.CreateAgent(t, ctx, clients, agentName,
		"You are a helpful assistant. Remember what the user tells you.")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), h.Harness)
	sessionID := session.GetMetadata().GetId()

	var totalLatency int64
	var lastExecID string

	for i, turn := range turns {
		var opts []harness.AgentExecutionOption
		if modelName != "" {
			opts = append(opts, harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
				ModelName: modelName,
			}))
		}

		start := time.Now()
		exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID, turn, opts...)

		_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
			agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
		totalLatency += time.Since(start).Milliseconds()

		if err != nil {
			t.Logf("WARNING [multi-turn/%s]: turn %d failed: %v", h.Name, i+1, err)
			return nil
		}
		lastExecID = exec.GetMetadata().GetId()
	}

	// Aggregate usage from the last execution's report (session-level would be ideal,
	// but per-execution is sufficient for relative comparison)
	time.Sleep(2 * time.Second)

	report, err := clients.AgentExecutionQuery.GetExecutionUsageReport(ctx,
		&agentexecv1.GetExecutionUsageReportInput{
			ExecutionId: lastExecID,
		})
	if err != nil {
		t.Logf("WARNING [multi-turn/%s]: failed to get usage report: %v", h.Name, err)
		return nil
	}

	agg := report.GetAggregate()
	if agg == nil {
		return nil
	}

	var model string
	if breakdown := report.GetModelBreakdown(); len(breakdown) > 0 {
		model = breakdown[0].GetModel()
	}

	return &harness.BenchmarkResult{
		Harness:             h.Name,
		Model:               model,
		InputTokens:         agg.GetInputTokens(),
		OutputTokens:        agg.GetOutputTokens(),
		CacheCreationTokens: agg.GetCacheCreationInputTokens(),
		CacheReadTokens:     agg.GetCacheReadInputTokens(),
		TotalTokens:         agg.GetInputTokens() + agg.GetOutputTokens() + agg.GetCacheCreationInputTokens() + agg.GetCacheReadInputTokens(),
		BillableCostMicros:  agg.GetBillableCostMicros(),
		ProviderCostMicros:  agg.GetProviderCostMicros(),
		LLMCallCount:        agg.GetLlmCallCount(),
		LatencyMs:           totalLatency,
		ExecutionID:         lastExecID,
	}
}

// requireBothHarnesses gates the aggregate report on the canonical
// per-harness prerequisites: the unified runner plus each harness's upstream
// API key. Delegating keeps this in lockstep with harness_config.go — the
// legacy testHarness.AgentRunner / CursorRunner stub fields this used to
// check are never assigned by the suite, so gating on them made this test
// always skip.
func requireBothHarnesses(t *testing.T) {
	t.Helper()
	harness.RequireNativePrereqs(t, testHarness)
	harness.RequireCursorPrereqs(t, testHarness)
}

// ═══════════════════════════════════════════════════════════════════
// Cursor Local vs Cloud Runtime Benchmarks (WI-5)
//
// These tests compare the Cursor SDK's local and cloud runtimes for
// the same prompt, isolating how much of the latency gap is cloud VM
// overhead vs SDK overhead.
//
// Local runtime: Agent.create({ local: { cwd } }) — runs inline in Node
// Cloud runtime: Agent.create({ cloud: { repos } }) — runs in Cursor-hosted VM
//
// Requirements:
//   - CURSOR_API_KEY (Anthropic key not required)
//   - cursor-runner started with STIGMER_CURSOR_CLOUD_MODE_ENABLED=true
//   - Cloud sessions need a git repo workspace entry for Cursor to clone
// ═══════════════════════════════════════════════════════════════════

const cursorModeGitRepoURL = "https://github.com/stigmer/stigmer"

func cursorModeCloudSessionOpts() []harness.SessionOption {
	return []harness.SessionOption{
		harness.WithWorkspaceEntries([]*sessionv1.WorkspaceEntry{
			{
				Name: "stigmer",
				Source: &sessionv1.WorkspaceSource{
					Source: &sessionv1.WorkspaceSource_GitRepo{
						GitRepo: &sessionv1.GitRepoSource{
							Url:    cursorModeGitRepoURL,
							Branch: "main",
						},
					},
				},
			},
		}),
	}
}

func TestCostBenchmark_CursorLocalVsCloud_Simple(t *testing.T) {
	local, cloud := runCursorModeComparison(t,
		"cursor-mode-simple",
		"Reply with exactly: hello",
		"",
	)
	harness.CompareCursorModes(t, "cursor-mode-simple", local, cloud)
}

func TestCostBenchmark_CursorLocalVsCloud_MediumContext(t *testing.T) {
	prompt := `Summarize in one sentence: A distributed system uses event sourcing with CQRS to separate read and write models. Commands are validated, persisted as events, and projected into read-optimized views. The event store uses append-only logs for durability while projections are rebuilt from the event stream on demand.`

	local, cloud := runCursorModeComparison(t,
		"cursor-mode-medium",
		prompt,
		"",
	)
	harness.CompareCursorModes(t, "cursor-mode-medium", local, cloud)
}

func TestCostBenchmark_CursorLocalVsCloud_Report(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	requireCursorRunner(t)

	type scenario struct {
		name      string
		prompt    string
		modelName string
	}

	scenarios := []scenario{
		{
			name:   "cm-report-simple",
			prompt: "Reply with exactly: hello",
		},
		{
			name:   "cm-report-medium",
			prompt: "Explain in one sentence what a hash table is.",
		},
	}

	cloudOpts := cursorModeCloudSessionOpts()

	var comparisons []*harness.CursorModeComparison
	for _, s := range scenarios {
		local := harness.RunCursorModeBenchmark(t, ctx, clients, waiter,
			sessionv1.CursorMode_CURSOR_MODE_LOCAL, "local",
			s.prompt, s.name, s.modelName)

		cloud := harness.RunCursorModeBenchmark(t, ctx, clients, waiter,
			sessionv1.CursorMode_CURSOR_MODE_CLOUD, "cloud",
			s.prompt, s.name, s.modelName,
			cloudOpts...)

		comp := harness.CompareCursorModes(t, s.name, local, cloud)
		if comp != nil {
			comparisons = append(comparisons, comp)
		}
	}

	if len(comparisons) == 0 {
		t.Log("WARNING: no cursor mode comparisons completed — skipping report generation")
		return
	}

	gitSHA := harness.GetGitSHA()
	report := harness.NewCursorModeReport(comparisons, gitSHA)

	outputDir := testHarness.LogDir()
	if outputDir == "" {
		outputDir = ".test-output"
	}
	reportOutputDir := outputDir + "/.."

	reportPath, err := harness.WriteCursorModeReport(reportOutputDir, report)
	if err != nil {
		t.Logf("WARNING: failed to write cursor mode report: %v", err)
	} else {
		t.Logf("Cursor mode report written: %s", reportPath)
	}

	t.Logf("")
	t.Logf("═══ CURSOR MODE BENCHMARK SUMMARY ═══")
	t.Logf("  Scenarios:            %d", report.Summary.ScenarioCount)
	t.Logf("  Avg Latency Ratio:    %.2fx (cloud/local)", report.Summary.AvgLatencyRatio)
	t.Logf("  Avg Token Delta:      %+d (cloud - local)", report.Summary.AvgTokenDelta)
	t.Logf("  Model Parity:         %d/%d matched", report.Summary.ModelMatchCount, report.Summary.ScenarioCount)
	t.Logf("")
}

func runCursorModeComparison(t *testing.T, scenario, prompt, modelName string) (local, cloud *harness.BenchmarkResult) {
	t.Helper()
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	requireCursorRunner(t)

	cloudOpts := cursorModeCloudSessionOpts()

	t.Run("local", func(t *testing.T) {
		local = harness.RunCursorModeBenchmark(t, ctx, clients, waiter,
			sessionv1.CursorMode_CURSOR_MODE_LOCAL, "local",
			prompt, scenario, modelName)
	})

	t.Run("cloud", func(t *testing.T) {
		cloud = harness.RunCursorModeBenchmark(t, ctx, clients, waiter,
			sessionv1.CursorMode_CURSOR_MODE_CLOUD, "cloud",
			prompt, scenario, modelName,
			cloudOpts...)
	})

	return local, cloud
}

func requireCursorRunner(t *testing.T) {
	t.Helper()
	// The suite runs cursor work through the unified runner (single task
	// queue), not the legacy stub CursorRunner field. Gate on the unified
	// runner + Cursor API key, matching requireCursorCallProviderPrereqs.
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available — cannot run cursor mode benchmark")
	}
	if os.Getenv("CURSOR_API_KEY") == "" {
		t.Skip("CURSOR_API_KEY not set — cannot run cursor mode benchmark")
	}
}
