# Design Decision 004: Summarization Middleware — Use DeepAgents JS Built-in

**Date**: 2026-05-19
**Status**: ACCEPTED
**Context**: Phase 4 — Supporting Activities (deferred from Phase 3c)

## Decision

Use the DeepAgents JS built-in `SummarizationMiddleware` as-is. No custom summarization implementation.

## Background

The Phase 3c checkpoint deferred summarization middleware verification to Phase 4. The original gate decision (DD-003) flagged "Summarization policy parity" as a MEDIUM risk, noting that DeepAgents JS has built-in summarization but the Python agent-runner might have custom policies.

Investigation revealed that the Python agent-runner has **zero** summarization code — no summarize, trim, condense, or context-window management anywhere in `agent-runner/` or `graphton/`. Whatever summarization existed in production came entirely from the DeepAgents Python library's built-in behavior. The JS library mirrors and improves on that same implementation.

## How It Works

`createDeepAgent` automatically includes `createSummarizationMiddleware({ backend })` in its default middleware stack (deepagents `index.js` line 8162). The middleware hooks into `wrapModelCall` and executes before every LLM call:

1. **Token counting**: Counts total tokens including system message and tool schemas
2. **Threshold check**: Compares against model-profile-aware thresholds (85% of `maxInputTokens` for profiled models, 170K fixed tokens for unprofiled)
3. **Safe cutoff**: Finds a cutoff point that never splits AI/Tool message pairs
4. **History offload**: Writes old messages to a markdown file in the backend
5. **Summary generation**: Calls the LLM with a summarization prompt (capped at 4K input tokens)
6. **Message replacement**: Replaces old messages with `[summary] + [recent messages]`
7. **Emergency fallback**: If a `ContextOverflowError` occurs even without trigger, summarizes retroactively

### Default Thresholds

For models with a profile (e.g., Claude Sonnet 4, Opus 4 with 200K context):

| Setting | Type | Value | Effective (200K context) |
|---------|------|-------|--------------------------|
| Trigger | fraction | 0.85 | 170,000 tokens |
| Keep | fraction | 0.10 | 20,000 tokens |
| Truncate args trigger | fraction | 0.85 | 170,000 tokens |
| Truncate args keep | fraction | 0.10 | 20,000 tokens |

For models without a profile:

| Setting | Type | Value |
|---------|------|-------|
| Trigger | tokens | 170,000 |
| Keep | messages | 6 |
| Truncate args trigger | messages | 20 |
| Truncate args keep | messages | 20 |

## Token Capture — No Cost Gap

The summarization LLM call uses the same `ChatAnthropic` model instance constructed in `setup.ts` with `baseURL` pointing to the Stigmer proxy. The proxy sits at the HTTP transport level and captures tokens for every LLM call.

Call chain:
1. `setup.ts` → `constructModel()` → `new ChatAnthropic({ clientOptions: { baseURL: proxyEndpoint } })`
2. Model instance flows into `createDeepAgent({ model, ... })`
3. `createSummarizationMiddleware({ backend })` receives no explicit `model` — resolves `request.model` from `wrapModelCall`, which is the proxy-routed instance
4. `createSummary()` → `chatModel.invoke()` → HTTP request → Stigmer proxy → Anthropic API

The middleware-level cost-cap (`wrapModelCall` chain) does not see the summary LLM call because it runs as a side-channel `invoke()`. This is acceptable:
- The proxy captures the real token usage regardless
- The summary call processes at most 4K tokens (~$0.012 at Claude Sonnet rates)
- Not counting it toward the agent-level budget warning is correct — it is infrastructure overhead, not a tool round

## Storage Path

When summarization triggers:
1. Old messages are offloaded to `StateBackend` as a markdown file at `/conversation_history/session_{id}.md`
2. `StateBackend` stores in LangGraph state under the `files` key
3. The `HttpCheckpointSaver` serializes state via `JsonPlusSerializer` and persists to MongoDB through the Java proxy
4. On resume, the checkpointer restores state including the summarization metadata (`_summarizationEvent`, `_summarizationSessionId`)

This means conversation history is durably persisted even after summarization compresses the active context.

## Middleware Ordering

`createDeepAgent` builds the middleware array as:

```
todoMiddleware → skillsMiddleware → filesystemMiddleware →
subAgentMiddleware → summarizationMiddleware → patchToolCallsMiddleware →
asyncSubAgents → customMiddleware (Stigmer's stack) → cacheMiddleware →
memory → humanInTheLoop
```

Stigmer's custom middleware (loop-detection, execution-budget, tool-truncation, graceful-stop, approval-gate, cost-cap, error-hints, otel-spans) is inserted via `customMiddleware`, after summarization. This means:
- Summarization modifies messages **before** cost-cap sees the call
- Cost-cap counts tokens on the summarized message list (what actually gets sent to the model)
- This is the correct behavior

## Rationale

1. **Already active**: The runner's `setup.ts` calls `createDeepAgent` which includes summarization by default. It has been active since Phase 3a.
2. **Model-profile-aware**: Auto-adapts thresholds based on `maxInputTokens` from the model profile. Works correctly across Claude Sonnet 4, Opus 4, and smaller-context models.
3. **Production-grade edge case handling**: Safe cutoff points (never orphans tool results), emergency summarization on `ContextOverflowError`, progressive token estimation calibration, tool result compaction.
4. **No Python parity gap**: The Python agent-runner had no custom summarization — it relied entirely on the DeepAgents Python library's built-in behavior. The JS implementation mirrors and improves on it.
5. **Proxy captures all tokens**: All LLM calls (including summarization) route through the same proxy-routed model instance, so token accounting is complete.

## Alternatives Considered

1. **Build custom summarization middleware**: Rejected. The built-in implementation is ~500 lines of carefully tested logic. Rebuilding it would be significant effort with no benefit — the defaults are already correct for our models.
2. **Exclude built-in and replace with custom**: Rejected. `excludedMiddleware` could remove `SummarizationMiddleware`, but there is no reason to — the built-in behavior is superior to what we could ship in a reasonable timeframe.
3. **Route summary LLM calls through Stigmer's middleware chain**: Rejected. The summary call is a direct `chatModel.invoke()` inside the middleware's `wrapModelCall` — routing it back through the chain would create infinite recursion. The proxy handles token capture at the transport level.

## Verification

15 tests added in `summarization-verification.test.ts`:
- 6 tests for `computeSummarizationDefaults` (profile-aware, fallback, model-specific thresholds)
- 4 tests for checkpoint serialization roundtrip (`_summarizationEvent`, `_summarizationSessionId`, full channel values, null filePath)
- 5 tests for middleware stack ordering (agent creation, custom middleware compatibility, ordering, backend sharing, model resolution)

All 432 tests pass (15 new + 417 existing).
