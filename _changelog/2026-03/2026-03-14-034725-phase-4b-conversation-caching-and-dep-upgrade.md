# Phase 4B: Automatic Conversation Caching + Full Dependency Upgrade

**Date**: March 14, 2026

## Summary

Completed incremental conversation caching for Anthropic models and upgraded all AI/LLM dependencies to latest versions. The conversation caching adds a third layer to the existing prompt caching architecture — Anthropic's automatic `cache_control` parameter tells the API to cache and advance the conversation prefix each turn, saving up to 90% on repeated input tokens. The dependency upgrade brings graphton and agent-runner to the latest langchain ecosystem, deepagents 0.4.10, and anthropic SDK 0.84.0.

## Problem Statement

Phase 4A (Session 6) cached the system prompt and tool definitions — the static prefix that repeats identically on every LLM call. But the conversation history (user messages, assistant responses, tool results) grows each turn and was being sent at full price every time. In a 10-turn execution with 40K tokens of accumulated conversation, that's 360K redundant input tokens paid at full rate.

### Pain Points

- Conversation prefix paid at full price on every LLM call despite being identical to the previous call
- The original plan called for `AnthropicPromptCachingMiddleware` from langchain-anthropic — a separate middleware in a different layer with a known model-fallback bug
- Dependencies were stale: anthropic SDK 0.79.0 (5 minor versions behind), deepagents 0.4.0 (10 patch versions behind), langchain-ollama 0.3.10 (major version behind)

## Solution

Two changes shipped together because the SDK upgrade was a prerequisite for the caching feature:

1. **Automatic conversation caching**: One line in `_inject_cache_control()` sets the top-level `cache_control={"type": "ephemeral"}` on the Anthropic API payload. The system automatically places a cache breakpoint on the last cacheable block and advances it as the conversation grows.

2. **Full dependency upgrade**: Widened two pyproject.toml constraints, ran `poetry update` in both graphton and agent-runner. All AI/LLM packages now at latest stable versions.

## Implementation Details

### Three-Layer Caching Architecture

```
Layer 1 (explicit):  system prompt          → stable, independent cache entry
Layer 2 (explicit):  last tool definition   → stable, independent cache entry
Layer 3 (automatic): conversation history   → Anthropic manages breakpoint, advances each turn
```

All three layers live in `_inject_cache_control()` in `graphton/core/models.py`. Explicit layers use `cache_control` on individual content blocks. Automatic layer uses the top-level request parameter. Uses 3 of 4 Anthropic breakpoint slots.

### Why NOT the langchain middleware

The original plan called for `AnthropicPromptCachingMiddleware`. Three reasons it was rejected:
1. We already have `_inject_cache_control()` — adding a second caching mechanism in a different layer violates single-responsibility
2. The middleware has a known open bug (langchain-ai/langchain#33709) that breaks model fallback
3. The top-level `cache_control` parameter (new in SDK 0.83.0) is simpler and lets the API manage placement

### Why NOT OpenAI-specific code

OpenAI already does prompt caching automatically with zero code changes — prefix matching, 50% discount, no opt-in. Nothing to implement.

### Dependency Versions

| Package | Before | After |
|---------|--------|-------|
| anthropic | 0.79.0 | 0.84.0 |
| deepagents | 0.4.0 | 0.4.10 |
| langchain | 1.2.10 | 1.2.12 |
| langchain-core | 1.2.4 | 1.2.19 |
| langchain-anthropic | 1.3.3 | 1.3.4 |
| langchain-openai | 1.1.6 | 1.1.11 |
| langchain-ollama | 0.3.10 | 1.0.1 |
| langchain-mcp-adapters | 0.1.14 | 0.2.1 |
| langgraph | 1.0.5 | 1.1.2 |

## Benefits

- **~90% savings on conversation input tokens** for multi-turn Anthropic executions (on top of Phase 4A's system/tool savings)
- **All dependencies at latest** — security patches, bug fixes, new features available
- **Minimal code footprint** — 2 lines of production code for the caching feature
- **Clean architecture** — three caching layers in one function, single responsibility preserved

## Impact

- **Agent-runner**: 1198/1198 tests pass. Fully green.
- **Graphton prompt caching**: 30/30 tests pass (24 existing + 6 new).
- **Graphton other tests**: 14 failures from dependency breaking changes (langchain-core tool_call id requirement, langmem API changes, deepagents tool result format). To be fixed in a follow-up session.

## Related Work

- Phase 4A: `_changelog/2026-03/2026-03-13-125452-phase-4a-prompt-caching.md` — system prompt + tool caching
- Phase 3B: Tool result truncation + cost cap middleware
- T01 master plan: `_projects/2026-03/20260313.01.usage-metrics-cost-optimization/tasks/T01_0_plan.md`

---

**Status**: Production Ready (caching feature) / Follow-up Needed (14 dep-upgrade test fixes)
**Timeline**: 1 session
