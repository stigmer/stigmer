//go:build integration && benchmark

package integration

import (
	"context"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

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
		"", "", // default model per harness
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
		"", "", // default model per harness
	)
	harness.CompareBenchmarks(t, "medium-context", native, cursor)
}

// --- Scenario: Model Parity (same underlying model, both harnesses) ---
//
// This is the most scientifically valuable test: it isolates infrastructure
// optimizations (caching, routing, context management) from pricing differences
// by pinning both harnesses to the same underlying model.
//
// The registry intentionally uses different id schemes per harness for the
// same model (native "claude-sonnet-4.6" with a hyphenated apiModelId vs
// cursor "claude-sonnet-4-6"), so parity must pin a per-harness id — a single
// shared string only ever worked for single-token names like the EOL
// "claude-sonnet-4". The native id resolves through the runner's registry
// lookup; the cursor id must match the runner's cursor pricing map (a
// Cursor-wire-style id would silently fall back to "default" there and
// destroy the parity premise).
//
// Cursor auto-routes models server-side, so whether it honors the pin is
// verified empirically from this run's report: the per-harness resolved
// models are printed in every comparison. A divergence means cursor-side
// parity is not achievable and these scenarios should be removed.

const (
	parityModelNative = "claude-sonnet-4.6"
	parityModelCursor = "claude-sonnet-4-6"
)

func TestCostBenchmark_ModelParity_Sonnet46(t *testing.T) {
	native, cursor := runScenarioBothHarnesses(t,
		"model-parity-sonnet46",
		"Reply with exactly: hello",
		parityModelNative, parityModelCursor,
	)
	harness.CompareBenchmarks(t, "model-parity-sonnet46", native, cursor)
}

func TestCostBenchmark_ModelParity_MediumContext(t *testing.T) {
	prompt := `Summarize in one sentence: A distributed system uses event sourcing with CQRS to separate read and write models. Commands are validated, persisted as events, and projected into read-optimized views. The event store uses append-only logs for durability while projections are rebuilt from the event stream on demand.`

	native, cursor := runScenarioBothHarnesses(t,
		"model-parity-medium",
		prompt,
		parityModelNative, parityModelCursor,
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

			agent := harness.CreateAgent(t, ctx, clients, "bench-multiturn-"+h.Name,
				"You are a helpful assistant. Remember what the user tells you.")

			result := harness.RunMultiTurnBenchmark(t, ctx, clients, waiter,
				agent.GetStatus().GetDefaultInstanceId(),
				h.Harness, h.Name, "multi-turn", turns, "")
			if result != nil {
				t.Logf("[multi-turn/%s] total: billable=%d micros, tokens=%d, latency=%dms",
					h.Name, result.BillableCostMicros, result.TotalTokens, result.LatencyMs)
			}
		})
	}
}

// --- Scenario: Chat-surface model calibration (same harness, named arms) ---
//
// Channel conversations (WhatsApp, Slack) run the Cursor harness with a
// platform-pinned model (stigmer-cloud
// `stigmer.channels.execution-profile.model-name`, documented "flipped only
// from calibration evidence") — this cell IS that evidence, rerunnable for
// every future model generation. It compares candidate cursor models on the
// same multi-turn, tool-calling conversation shape a chat surface actually
// serves, and persists per-turn transcripts so reply quality gets graded
// next to cost (a cheap model that fumbles tool calls is not cheap).
//
// Arms come from BENCHMARK_CHAT_MODELS (comma-separated cursor-registry
// ids; the FIRST is the ratio baseline). The default pair is the current
// chat-pin candidates. A pinned id that Cursor re-routes shows up as a
// model-drift warning in the arm comparison — the same silent-fallback
// failure mode the production pin has, caught here first.

const chatCalibrationInstructions = `You are a friendly assistant for a small gym, chatting on WhatsApp.
Keep replies short and warm — one or two sentences, no headings, no
bullet walls. Use your tools for any lookup or arithmetic instead of
answering from memory, and confirm what you did after using one.`

func chatCalibrationModels() []string {
	raw := os.Getenv("BENCHMARK_CHAT_MODELS")
	if raw == "" {
		raw = "composer-2.5,claude-haiku-4-5"
	}
	var models []string
	for _, m := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(m); trimmed != "" {
			models = append(models, trimmed)
		}
	}
	return models
}

func TestCostBenchmark_ChatModelCalibration(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	harness.RequireCursorPrereqs(t, testHarness)
	if mcpTestServerBinary == "" {
		t.Skip("test MCP server unavailable — cannot measure tool-schema context overhead")
	}

	models := chatCalibrationModels()
	require.GreaterOrEqual(t, len(models), 2, "BENCHMARK_CHAT_MODELS needs at least two arms to compare")

	reps := benchmarkReps(t)
	t.Logf("Chat model calibration: arms=%v, %d warm repetitions per arm + 1 discarded warmup", models, reps)

	// The MCP fixture is what makes this cell chat-shaped: tool schemas
	// re-enter the model context on every turn of a cursor conversation,
	// so an agent without tools would understate every arm equally in
	// absolute terms but hide how each model behaves when calling them.
	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "bench-chat-calibration",
		chatCalibrationInstructions,
		harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()))

	// A WhatsApp-shaped script: greeting (no tool), two tool-calling turns,
	// then a recall turn that only works if conversation history held.
	turns := []string{
		"Hi! What can you help me with?",
		"Use the add tool to total a 1200 and an 800 rupee fee and tell me the amount.",
		"Now use the echo tool to send back exactly: payment recorded",
		"Thanks — in one short sentence, what did we just do?",
	}

	arms := make([]*harness.BenchmarkArm, 0, len(models))
	for _, model := range models {
		stat := harness.RunMultiTurnBenchmarkStat(t, ctx, clients, waiter,
			agent.GetStatus().GetDefaultInstanceId(),
			sessionv1.Harness_HARNESS_CURSOR, "cursor",
			"chat-calibration-"+model, turns, model, reps)
		arms = append(arms, &harness.BenchmarkArm{Name: model, Stat: stat})
	}

	comp := harness.CompareArms(t, "chat-calibration", arms)
	if comp == nil {
		t.Log("WARNING: no arm comparison completed — skipping report generation")
		return
	}

	outputDir := testHarness.LogDir()
	if outputDir == "" {
		outputDir = ".test-output"
	}

	report := harness.NewArmReport([]*harness.ArmComparison{comp}, harness.GetGitSHA())
	reportPath, err := harness.WriteArmReport(outputDir+"/..", report)
	if err != nil {
		t.Logf("WARNING: failed to write arm report: %v", err)
	} else {
		t.Logf("Chat model calibration report written: %s", reportPath)
	}
}

// --- Aggregate Report Generation ---

// benchmarkReps returns the number of warm measured repetitions per report
// cell. Each cell additionally runs one discarded warmup execution (the
// cold-call figure), so total spend per cell is reps+1 executions. Odd
// values keep the median a single observed sample (see BenchmarkStat).
// Override via BENCHMARK_REPS for cheap smoke runs (e.g. BENCHMARK_REPS=1).
func benchmarkReps(t *testing.T) int {
	t.Helper()
	const defaultReps = 5
	raw := os.Getenv("BENCHMARK_REPS")
	if raw == "" {
		return defaultReps
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		t.Logf("WARNING: invalid BENCHMARK_REPS=%q — using default %d", raw, defaultReps)
		return defaultReps
	}
	if n%2 == 0 {
		t.Logf("WARNING: BENCHMARK_REPS=%d is even — the median falls between two samples and the upper-middle run is taken; prefer odd", n)
	}
	return n
}

// codegenPrompt is the code-generation report category: single-shot,
// output-heavy (the inverse token shape of the context-heavy categories).
const codegenPrompt = `Write a Go function that parses a duration string like "1h30m" and returns total minutes as an int, with proper error handling. Reply with only the code, no explanation.`

func TestCostBenchmark_Report(t *testing.T) {
	require.NotNil(t, grpcConn)

	// Budget generously: each cell is (1 warmup + reps) executions per
	// harness, and executions can take minutes on a cold local stack.
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	requireBothHarnesses(t)

	reps := benchmarkReps(t)
	t.Logf("Report methodology: %d warm repetitions per cell + 1 discarded warmup (cold-call figure)", reps)

	type scenario struct {
		name        string
		prompt      string
		nativeModel string
		cursorModel string
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
			name:   "report-codegen",
			prompt: codegenPrompt,
		},
		{
			name:        "report-parity-simple",
			prompt:      "Reply with exactly: hello",
			nativeModel: parityModelNative,
			cursorModel: parityModelCursor,
		},
		{
			name:        "report-parity-medium",
			prompt:      "Explain in one sentence what a hash table is.",
			nativeModel: parityModelNative,
			cursorModel: parityModelCursor,
		},
		{
			name:        "report-parity-codegen",
			prompt:      codegenPrompt,
			nativeModel: parityModelNative,
			cursorModel: parityModelCursor,
		},
	}

	var comparisons []*harness.BenchmarkComparison
	for _, s := range scenarios {
		native := harness.RunBenchmarkStat(t, ctx, clients, waiter,
			sessionv1.Harness_HARNESS_NATIVE, "native", s.prompt, s.name, s.nativeModel, reps)
		cursor := harness.RunBenchmarkStat(t, ctx, clients, waiter,
			sessionv1.Harness_HARNESS_CURSOR, "cursor", s.prompt, s.name, s.cursorModel, reps)

		comp := harness.CompareBenchmarkStats(t, s.name, native, cursor)
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

// runScenarioBothHarnesses runs one prompt through both harnesses. Models are
// pinned per harness because the registry ids for the same underlying model
// differ between harness sections (see the Model Parity scenario comment).
// Pass "" for both to use each harness's default model.
func runScenarioBothHarnesses(t *testing.T, scenario, prompt, nativeModel, cursorModel string) (native, cursor *harness.BenchmarkResult) {
	t.Helper()
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	modelFor := map[string]string{
		"native": nativeModel,
		"cursor": cursorModel,
	}

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			result := harness.RunBenchmarkExecution(t, ctx, clients, waiter,
				h.Harness, h.Name, prompt, scenario, modelFor[h.Name])

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
