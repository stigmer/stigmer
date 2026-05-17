# Task T01: Harness Cost Economics — Implementation Plan

**Created**: 2026-05-16
**Status**: Planning
**Research**: `_projects/2026-05/research.cursor-vs-native-cost-optimization/04.report.gpt.md`
**Benchmark Data**: `test/integration/.test-output-benchmark/benchmark-results/`

## Context

Our first cost benchmark comparing Native (Anthropic direct) vs Cursor (Cursor SDK) harnesses revealed:

- **Native**: Lower latency (2-3x faster), benefits heavily from Anthropic prompt caching, but first-call cache-write is expensive ($3.75/M)
- **Cursor**: ~10k token system prompt overhead per call, opaque caching, 2-3x slower, but provides managed agent tooling (repo search, file edits, terminal, MCP)
- **Billing gap**: Cursor's resolved model and token accounting may diverge from direct Anthropic pricing; current billing treats both sources identically

Users choose their harness — we can't enforce routing. But we can: optimize each harness independently, make billing accurate, and give users clear guidance.

## Work Items (prioritized)

### WI-1: Anthropic Prompt Caching in Native Harness
**Impact**: High — 30-80% savings on repeated-prefix cost
**Repo**: stigmer (agent-runner, Python)

The native agent-runner calls Anthropic directly via `langchain_anthropic`. We need to:

1. **Add explicit cache breakpoints** for stable prefixes (tool definitions + system prompt) using `cache_control` with `ephemeral` type
2. **Enable automatic caching** for growing conversation context (Anthropic auto-moves the breakpoint forward as conversation grows)
3. **Pre-warm hot prefixes** with `max_tokens: 0` for latency-sensitive session starts
4. **Stabilize tool schemas**: MCP tools are dynamically resolved — if schemas change between calls, the entire cache invalidates. Investigate caching resolved tool schemas per-session.
5. **Minimum cacheable size**: Ensure static prefix exceeds 1,024 tokens (Sonnet 4.6 minimum)

**Key research finding**: Over 10 uses of a 10.8k-token prefix, caching saves ~78.5% ($0.07 cached vs $0.33 uncached).

### WI-2: Billing Architecture — Two Cost Dimensions
**Impact**: High — billing accuracy for cursor harness
**Repos**: stigmer (cursor-runner), stigmer-cloud (billing handler, proto)

Current state: `RecordLlmCallUsageHandler` computes a single `providerCostMicros` from the model registry. For cursor executions, this is an estimate — not what Cursor actually bills.

Changes needed:

1. **Add `vendor_billed_cost_micros` field** to `LlmCallUsageRecord` proto — stores the actual platform cost (for Cursor: Cursor's invoice; for native: same as provider cost)
2. **Add `resolved_model` logging** in cursor-runner — capture `run.model` / `result.model` from the Cursor SDK and send it in the billing record
3. **Trust tier differentiation** — already partially done (PROXY vs RUNNER_PROVIDER_REPORTED_OSS). Document the trust model: native proxy = billing authority, cursor runner = server-observed estimate.
4. **Reconciliation hook** — design a path for importing Cursor dashboard/admin data to reconcile runner-reported records with actual Cursor billing

### WI-3: User-Facing Harness Documentation
**Impact**: High — helps users make informed choices
**Repo**: stigmer (docs)

Users choose between native and cursor when creating a session. We should publish clear guidance:

1. **Harness comparison page** with trade-offs table:
   - Native: lower cost, lower latency, full cache control, best for chat/multi-turn/simple tasks
   - Cursor: managed agent tooling (code search, file edits, terminal, browser), best for coding tasks and repo-aware work
2. **Cost implications**: Native benefits from Anthropic caching (cheaper over time); Cursor has ~10k token overhead per call + potential Teams surcharge
3. **Latency expectations**: Native 2-3x faster; Cursor overhead is structural (agent startup, indexing, tool infra)
4. **When to use which**: Decision matrix matching task type to recommended harness
5. **Session-level guidance**: Long conversations → native (caching amortizes); complex coding → cursor

This is documentation, not code enforcement. The user retains full choice.

### WI-4: Cursor Context Trimming
**Impact**: Medium — reduces per-call token overhead
**Repo**: stigmer (cursor-runner)

The Cursor SDK loads ~10k tokens of system context (rules, tools, MCP, hooks). We can't change Cursor's internal system prompt, but we can trim what we control:

1. **Audit enabled rules and MCP servers** in the cursor-runner's agent configuration
2. **Use local runtime where possible** — local agents only load inline MCP servers (vs cloud loading all team/project plugins)
3. **Minimize always-on tool definitions** — defer volatile tools instead of including them in every request
4. **Measure before/after** — run the benchmark with trimmed config and compare token counts

### WI-5: Benchmark — Cursor Local vs Cloud
**Impact**: Medium — isolates latency sources
**Repo**: stigmer (test/integration)

The deep research recommends benchmarking Cursor local runtime against cloud to understand how much of the 2-3x latency gap is cloud overhead vs SDK overhead:

1. **Add local-runtime Cursor benchmark scenario** — configure cursor-runner to use `local` runtime instead of `cloud`
2. **Compare**: same prompt, same model, local vs cloud
3. **Log resolved model** (`run.model`) to verify both paths use the same underlying model
4. **Measure**: token counts, latency, cache behavior differences

This is an experiment, not a production change. Results inform whether to recommend local runtime in docs.

## Task Sequencing

```
WI-1 (caching) ──────┐
                      ├──→ WI-3 (docs) — informed by WI-1/2/4/5 results
WI-2 (billing) ──────┤
                      │
WI-4 (trim cursor) ──┤
                      │
WI-5 (benchmark) ────┘
```

WI-1 and WI-2 are independent and highest priority. WI-4 and WI-5 can run in parallel. WI-3 (documentation) should come last because it synthesizes findings from all other work items.

## Success Criteria

1. Native harness uses Anthropic prompt caching with explicit breakpoints — measurable cost reduction on multi-turn benchmark
2. Billing records carry `estimated_provider_cost` and `vendor_billed_cost` separately
3. Published documentation explaining harness trade-offs with a decision matrix
4. Cursor context audit completed with before/after token measurements
5. Local-vs-cloud Cursor benchmark results documented

## Risks

- **Anthropic caching invalidation from dynamic MCP tools**: If tool schemas change per-call, cache benefits evaporate. Mitigation: stabilize schemas per-session.
- **Cursor SDK opacity**: Can't inspect or control Cursor's internal system prompt or caching strategy. Mitigation: optimize what we control, log what we can observe.
- **Billing reconciliation**: Cursor may not expose per-call billing data via API. Mitigation: start with dashboard-level reconciliation; revisit when Cursor Analytics API matures.
