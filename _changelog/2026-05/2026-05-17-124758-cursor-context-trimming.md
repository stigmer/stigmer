# Cursor Context Trimming — Reduce Per-Execution Token Overhead

**Date**: May 17, 2026

## Summary

Audited and trimmed the Stigmer-controlled token overhead in the cursor-runner's prompts. Made prompt sections conditional (response rules, single-dir workspace context), tightened session memory budgets, lowered the continuation prompt ceiling, and confirmed that the Cursor SDK offers no MCP tool filtering. All 422 cursor-runner tests pass with the new behavior.

## Problem Statement

The cursor-runner injects a Stigmer preamble (instructions, skills, sub-agents, workspace context, response rules, session memory) into every `agent.send()` call. Because the Cursor SDK has no `systemPrompt` parameter, all preamble is delivered as the first user message — consuming input tokens alongside Cursor's own internal system prompt and tool definitions.

### Pain Points

- Response rules (~80 tokens) are always appended, even when the agent already has detailed custom instructions that subsume them
- Single-dir workspace context (~16 tokens) is redundant with the SDK's `local: { cwd }` parameter — the model discovers its workspace through tool use
- Continuation prompts re-include the full agent identity on every subsequent local execution, with generous token budgets that were set as first-pass values
- Session memory budgets (summary, turns, observations) were sized conservatively before any real usage data

## Solution

Three categories of changes, all within `backend/services/cursor-runner/`:

1. **Conditional section inclusion**: Skip response rules when agent has custom instructions; skip workspace context for single-dir setups. Applied to both `buildEnhancedPrompt()` and `buildAgentContextSections()` (continuation prompts).

2. **Tightened session memory budgets**: Reduced all constants in `session-memory.ts` based on analysis of typical continuation prompt composition (~923 tokens with standard content vs. the 8,000-token ceiling).

3. **MCP surface audit**: Investigated the Cursor SDK for tool filtering or lazy MCP loading — confirmed neither exists. Documented as a feature request.

## Implementation Details

### Conditional prompt sections (`prompt-builder.ts`, `continuation-prompt.ts`)

- `formatResponseRules()` now only included when `!options.instructions` — agents with custom instructions get behavioral guidance from their persona, and Cursor has its own built-in rules
- `formatWorkspaceContext()` now requires `safeDirs.length > 1` — single-dir is redundant with the SDK's `cwd`; multi-root workspaces still get the explicit directory list
- Same logic applied to `buildAgentContextSections()` in `continuation-prompt.ts` so continuation prompts also benefit

### Tightened memory budgets (`session-memory.ts`)

| Constant | Before | After |
|---|---|---|
| `MAX_SUMMARY_TOKENS` | 2,000 | 1,000 |
| `MAX_TURNS_TOKENS` | 4,000 | 3,000 |
| `MAX_OBSERVATIONS_TOKENS` | 1,000 | 500 |
| `MAX_TURN_TOKENS` | 1,000 | 800 |
| `MAX_RECENT_TURNS` | 6 | 4 |
| `MAX_OBSERVATIONS` | 10 | 5 |
| `MAX_DECISIONS` | 20 | 15 |
| `MAX_FAILED_ATTEMPTS` | 20 | 10 |
| `MAX_OBSERVATION_SUMMARY_CHARS` | 200 | 150 |
| `MAX_FAILED_ATTEMPT_CHARS` | 200 | 150 |
| `CONTINUATION_TOKEN_CEILING` | 8,000 | 6,000 |

### MCP surface audit

The Cursor SDK `McpServerConfig` type accepts only connection parameters (command/args/env for stdio, url/headers for http). No `enabledTools`, `allowedTools`, or tool filtering parameter exists. MCP servers are connected at `Agent.create()` time. The `tools` field in `SDKSystemMessage` is output-only.

### Prompt-size instrumentation (pre-existing on branch)

Each execution now logs Stigmer preamble size and first-turn attribution:
- `ExecuteCursor prompt built: chars=X, estimatedTokens=Y, resolution=Z, mode=M`
- `ExecuteCursor context attribution (first turn): sdkInputTokens=X, stigmerPreamble=Y, cursorOverhead=Z`

## Benefits

- Reduced per-execution token overhead for the common case (agents with custom instructions in single-dir workspaces)
- Tighter continuation prompts that stay within practical bounds rather than conservative first-pass ceilings
- Clear diagnostic logging for future token optimization work
- MCP limitation documented for future SDK feature requests

## Impact

- **Cursor-runner**: All prompt construction paths (enhanced, continuation, HITL continuation) now produce leaner output
- **End users**: Lower token consumption per execution, especially in multi-turn local-mode sessions where continuation prompts are used on every turn
- **Billing**: Lower input token counts reduce estimated cost per execution
- **No behavioral regression**: 422 tests pass including 19 new prompt-builder tests

## Related Work

- WI-1 (Anthropic Prompt Caching) — validated native harness caching, fixed CostCapMiddleware pricing
- WI-2 (Billing Architecture) — next work item, adds `vendor_billed_cost_micros` for billing accuracy
- WI-3 (Harness Documentation) — will synthesize findings from WI-1, WI-4, and WI-5
- Part of project `20260516.01.harness-cost-economics` (T01_0_plan.md)

---

**Status**: Production Ready
**Timeline**: Single session (~1 hour)
