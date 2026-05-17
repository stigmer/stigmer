# Cursor Local vs Cloud Runtime Benchmark Infrastructure

**Date**: May 17, 2026

## Summary

Added benchmark infrastructure to compare Cursor SDK's local and cloud runtimes for identical prompts, measuring latency, token counts, cache behavior, and resolved model parity. This isolates how much of the Cursor harness's latency gap is cloud VM overhead vs SDK overhead — a key input for the user-facing harness documentation (WI-3).

## Problem Statement

The cost economics research (Cursor-vs-Native deep dive) identified a 2-3x latency gap for the Cursor harness, but couldn't attribute how much was cloud VM provisioning (repo clone, container spin-up) vs SDK-inherent overhead (system prompt loading, tool initialization). Without this breakdown, the harness comparison documentation would present an incomplete picture to users choosing between local and cloud execution modes.

### Pain Points

- No mechanism to run the same prompt through both Cursor runtimes in a controlled benchmark
- Existing benchmark infrastructure only compared Native vs Cursor, not Cursor-local vs Cursor-cloud
- No way to verify both runtimes resolve to the same underlying model
- Session-level `cursor_mode` was auto-detected, not explicitly controllable from tests

## Solution

Leveraged the existing `SessionSpec.cursor_mode` proto field (already present, already honored by the cursor-runner) to create sessions with explicit LOCAL or CLOUD modes. The benchmark creates two cursor sessions per scenario — one local, one cloud — and compares latency, tokens, cost, and model resolution.

Key architectural decision: session-level CursorMode override rather than separate cursor-runner processes. This eliminates confounding variables (process startup, JIT warmup) and adds zero infrastructure complexity.

## Implementation Details

### Harness Config Extension (`harness_config.go`)

Introduced `SessionOption` functional options pattern with `WithCursorMode` and `WithWorkspaceEntries`. Extended `CreateTestSession` to accept variadic options — backward compatible with all ~30 existing callers.

### Benchmark Helpers (`benchmark_helpers.go`)

- Added `CursorMode` field to `BenchmarkResult` (additive, `omitempty` for backward compat)
- New `CursorModeComparison` struct focused on latency ratio, token delta, model match, cost ratio
- `RunCursorModeBenchmark`: creates session with explicit CursorMode, runs prompt, collects usage report
- `CompareCursorModes`: logs structured comparison table with warnings for high latency ratios and model divergence

### Report Infrastructure (`benchmark_report.go`)

- New `CursorModeReport` / `CursorModeSummary` types with avg latency ratio, avg token delta, model match count
- `WriteCursorModeReport` persists to `cursor-mode-results/` (separate from existing `benchmark-results/`)

### Test Scenarios (`cost_benchmark_test.go`)

- `TestCostBenchmark_CursorLocalVsCloud_Simple` — minimal token exchange
- `TestCostBenchmark_CursorLocalVsCloud_MediumContext` — longer prompt to surface cache differences
- `TestCostBenchmark_CursorLocalVsCloud_Report` — aggregate report with JSON persistence

Cloud sessions use git repo workspace entries (stigmer repo, main branch) to trigger cloud mode.

### Makefile Target

New `benchmark-cursor-modes` target requires only `CURSOR_API_KEY` (no Anthropic key needed). Sets `STIGMER_CURSOR_CLOUD_MODE_ENABLED=true` for the test run. Runs only `TestCostBenchmark_CursorLocalVsCloud` tests.

## Benefits

- Quantifies cloud VM overhead vs SDK overhead for the first time
- Verifies model parity across runtimes (detects silent model routing differences)
- Results directly feed into WI-3 harness documentation (latency expectations, when-to-use-which guidance)
- Extends the existing benchmark infrastructure cleanly — no breaking changes to existing reports

## Impact

- **Users**: Will receive data-backed guidance on local vs cloud runtime trade-offs in the harness documentation
- **Platform team**: Can monitor runtime parity over time as Cursor SDK evolves
- **Cost optimization**: Token count differences between runtimes reveal where context overhead lives

## Related Work

- WI-1: Anthropic Prompt Caching (native harness cost optimization)
- WI-2: Billing Architecture — resolved model capture (enables model parity verification)
- WI-4: Cursor Context Trimming (reduces token overhead measured by these benchmarks)
- WI-3: User-Facing Harness Documentation (consumes these benchmark results)

---

**Status**: Production Ready
**Timeline**: 1 session (~30 minutes implementation)
