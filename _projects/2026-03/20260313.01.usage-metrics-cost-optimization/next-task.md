# Next Task: 20260313.01.usage-metrics-cost-optimization

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260313.01.usage-metrics-cost-optimization

**Description**: Address gaps in agent execution usage metrics tracking (cost/pricing data, cache token differentiation) and implement usage optimization techniques (prompt caching, tool result truncation, model routing) to enable accurate cost reporting and minimize LLM costs.
**Goal**: Enable per-execution cost reporting with accurate pricing, implement prompt caching for cost optimization, and provide CLI-level usage/cost visibility with historical reporting RPCs.
**Tech Stack**: Protobuf/gRPC (API schema), Go (stigmer-server, CLI), Python (agent-runner/LangGraph), Java (Temporal workflows)
**Components**: Proto APIs (agentexecution/v1, session/v1), agent-runner (Python/LangGraph), stigmer-server (Go), CLI (Go)

## Current State
- **Status**: In Progress
- **Last Session**: 2026-03-14 (Session 8) — Fixed all 30 dep-upgrade test failures
- **Active Task**: Dep-upgrade test failures fixed. Next: Phase 5 → Phase 6 → Phase 7
- **Branch**: `feat/usage-metrics-and-cost-optimization`

## Session Progress (2026-03-14, Session 8)

### Fix Dep-Upgrade Test Failures — COMPLETED

Fixed all 30 test failures (originally documented as 14) caused by breaking changes in upgraded dependencies. All fixes are test-only except one production docstring correction. Zero production logic changes.

**Root causes resolved (10 categories):**

1. **`claude-haiku-4` model reference** (10 tests): Replaced with `claude-haiku-4.5`, updated `api_model_id` expectations to `claude-haiku-4-5-20251001`.
2. **`AIMessage(tool_calls=...)` missing `id`** (4 tests): Added `"id": "call_xxx"` to tool_call dicts.
3. **`AIMessage(content=None)` invalid** (2 tests): Used `MagicMock(content=None)` to preserve defensive code path testing.
4. **`SummarizationMiddleware` renamed** (2 tests): Updated imports to `ContextSummarizationMiddleware`.
5. **`RunningSummary.__init__()` signature** (2 tests): Added `last_summarized_message_id=None`.
6. **`summarize_messages` mock path + model creation** (4 tests): Changed mock to `langmem.short_term.summarize_messages` AND added `_create_summarization_model` mock (model creation fails before reaching `summarize_messages` without API keys — a surprise not in the original plan).
7. **Tool wrapper `ainvoke` returns string** (2 tests): Updated assertions to expect string representations.
8. **Reject/unknown action returns string** (2 tests): Updated tests to assert returned error strings instead of `ToolExecutionRejectedError`.
9. **Edit tool returns error string** (1 test): Updated test to assert returned error string contains "not found".
10. **Token counting threshold** (1 test): Used varied content (`"word1 word2 ..."`) instead of repeated `"x"` to reliably exceed threshold.

**Files changed (6 test files, 1 production file):**
- `tests/core/test_model_registry.py` — 8 tests fixed
- `tests/core/test_token_counter.py` — 3 tests fixed
- `tests/core/test_summarization.py` — 8 tests fixed
- `tests/core/test_summarization_middleware.py` — 1 test fixed (+ 8 fixture model names)
- `tests/core/test_tool_wrappers.py` — 5 tests fixed
- `tests/integration/test_summarization_integration.py` — 5 tests fixed
- `src/graphton/core/tool_wrappers.py` — docstring fix only (removed stale `Raises: ToolExecutionRejectedError`)

**Result: 1155 passed, 1 skipped, 0 failed** (full graphton suite).

---

## Session Progress (2026-03-14, Session 7)

### Phase 4B: Automatic Conversation Caching — COMPLETED

Enabled Anthropic's automatic conversation caching by upgrading the `anthropic` SDK to 0.84.0 and adding a single top-level `cache_control: {"type": "ephemeral"}` parameter to the API payload. The system automatically manages cache breakpoints for the growing conversation history — placing the breakpoint on the last cacheable block and advancing it each turn.

**Key insight**: The original plan called for `AnthropicPromptCachingMiddleware` from langchain-anthropic (manual breakpoints on individual message content blocks). Investigation revealed three reasons not to use it: (1) we already have `_inject_cache_control()` — adding a second caching mechanism in a different layer violates single-responsibility, (2) the middleware has a known open bug (langchain#33709) that breaks model fallback, (3) Anthropic's top-level `cache_control` parameter (new in SDK 0.83.0) is simpler and lets the API manage breakpoint placement automatically.

**Also discovered**: OpenAI already does prompt caching automatically on every API call with zero code changes (prefix matching, 50% discount, no opt-in). Phase 4B is correctly Anthropic-only because Anthropic is the only provider requiring explicit client-side action.

**Three-layer caching architecture:**
- Layer 1 (explicit): system prompt — stable, independent cache entry
- Layer 2 (explicit): last tool definition — stable, independent cache entry
- Layer 3 (automatic): conversation history — Anthropic manages breakpoint placement, advances each turn

Uses 3 of 4 Anthropic breakpoint slots (2 explicit + 1 automatic).

**What was done (2 modified files, ~40 lines modified/new production, ~70 lines new tests):**

1. **`_inject_cache_control()`** (`graphton/core/models.py`): Added Layer 3 — one line: `payload["cache_control"] = _CACHE_CONTROL_EPHEMERAL`. Idempotent (won't overwrite existing). Updated docstring to document three-layer architecture.

2. **`_EagerToolStreamingChatAnthropic`** (`graphton/core/models.py`): Updated class docstring to mention conversation caching alongside the existing system/tool caching.

3. **Unit tests** (`test_prompt_caching.py`): Added 6 new tests (Layer 3 automatic caching, idempotency, message non-modification, opt-out integration). Updated existing combined tests to verify top-level `cache_control`. Total: 30 tests, all pass.

### Full Dependency Upgrade

Upgraded all AI/LLM dependencies in graphton and agent-runner to latest versions:

- **anthropic**: 0.79.0 → 0.84.0 (enables top-level cache_control)
- **deepagents**: 0.4.0 → 0.4.10
- **langchain**: 1.2.10 → 1.2.12
- **langchain-core**: 1.2.4 → 1.2.19
- **langchain-anthropic**: 1.3.3 → 1.3.4
- **langchain-openai**: 1.1.6 → 1.1.11
- **langchain-ollama**: 0.3.10 → 1.0.1 (major version bump, constraint widened)
- **langchain-mcp-adapters**: 0.1.14 → 0.2.1 (constraint widened)
- **langgraph**: 1.0.5 → 1.1.2

Constraint changes in `graphton/pyproject.toml`:
- `langchain-ollama`: `>=0.2.0,<1.0.0` → `>=1.0.0,<2.0.0`
- `langchain-mcp-adapters`: `>=0.1.9,<0.2.0` → `>=0.2.0,<0.3.0`

### Dep-Upgrade Test Failures (14 tests, to be fixed separately)

The dependency upgrades introduced 14 test failures in graphton (agent-runner is fully green at 1198 tests). These are all from breaking changes in the upgraded dependencies, NOT from Phase 4B code:

1. **`claude-haiku-4` references** (2 tests): Tests reference a model name that doesn't exist in the registry. Pre-existing issue now surfacing because summarization config returns `claude-haiku-4.5`.
2. **`AIMessage(tool_calls=...)` requires `id`** (2 tests): `langchain-core` 1.2.19 made `id` mandatory in tool_call dicts.
3. **`AIMessage(content=None)` invalid** (1 test): langchain-core now requires content to be str or list, not None.
4. **`summarize_messages` moved in langmem** (4 tests): The mock patch target no longer exists at the expected path.
5. **Tool wrappers return string** (3 tests): deepagents 0.4.10 changed tool result format from dict to string.
6. **Token counting threshold** (1 test): Approximate counting result changed slightly.
7. **Edit tool error** (1 test): Error handling behavior changed.

### Design Decisions Made

1. **Top-level automatic caching over manual message breakpoints**: Anthropic's top-level `cache_control` parameter is simpler (1 line vs 15 lines), lets the API manage breakpoint placement, and avoids navigating nested message content block structures.
2. **NOT using langchain middleware**: `AnthropicPromptCachingMiddleware` would create two caching mechanisms in two different layers. Our `_inject_cache_control()` approach keeps all caching logic in one function, at one layer.
3. **Hybrid explicit + automatic**: Explicit breakpoints (Layers 1-2) for stable system/tools content, automatic (Layer 3) for dynamic conversation. Recommended by Anthropic docs.
4. **OpenAI needs nothing**: OpenAI's automatic prefix caching (50% discount, no opt-in) is already active with zero code changes.

### Files Changed

**Modified**:
- `backend/libs/python/graphton/pyproject.toml` (constraint widening)
- `backend/libs/python/graphton/poetry.lock` (full dependency resolution)
- `backend/libs/python/graphton/src/graphton/core/models.py` (Layer 3 + docstrings)
- `backend/libs/python/graphton/tests/core/test_prompt_caching.py` (new Layer 3 tests)
- `backend/services/agent-runner/poetry.lock` (full dependency resolution)

---

## Next Steps

Pick up in this order:

### Immediate: Phase 5 — Server Usage Report RPCs
Implement `GetSessionUsageReport`, `GetAgentUsageReport`, `GetOrgUsageReport` RPCs. Aggregate usage across executions/sessions/agents with time range filtering and pagination.

### Then: Remaining T01 Phases
1. **Phase 6: CLI — Usage Display & Commands** — Add `stigmer usage` commands, per-execution usage summary
2. **Phase 7: Sub-Agent Model Routing** — Wire `model_override` on `SubAgentDefinition`

## Context for Resume

- **Three-layer caching**: `_inject_cache_control()` in `graphton/core/models.py` now has three layers: (1) explicit breakpoint on system prompt, (2) explicit breakpoint on last tool, (3) top-level `cache_control` for automatic conversation caching. All three are idempotent. Opt-out via `model._prompt_caching = False`.
- **Automatic caching** (Layer 3) uses Anthropic's top-level `cache_control={"type": "ephemeral"}` parameter (requires `anthropic>=0.83.0`). The API automatically places a breakpoint on the last cacheable block and advances it each turn.
- **OpenAI caching is automatic**: No code needed. 50% discount on cached tokens, prefix matching, no opt-in.
- **All graphton tests green**: 1155 passed, 1 skipped, 0 failed. Dep-upgrade test failures all resolved.
- **Key dep versions now**: anthropic 0.84.0, deepagents 0.4.10, langchain-core 1.2.19, langgraph 1.1.2, langchain-ollama 1.0.1, langchain-mcp-adapters 0.2.1.
- 30/30 prompt caching tests pass (Layers 1-3 + integration + opt-out).
- 1198/1198 agent-runner tests pass.
- Phase 4B plan: `.cursor/plans/phase_4b_conversation_caching_1581cc1e.plan.md`
- T01 master plan: `tasks/T01_0_plan.md`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/dont-dos/
```

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260313.01.usage-metrics-cost-optimization/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
