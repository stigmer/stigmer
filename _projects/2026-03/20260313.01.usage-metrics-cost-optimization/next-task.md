# Next Task: 20260313.01.usage-metrics-cost-optimization

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260313.01.usage-metrics-cost-optimization

**Description**: Address gaps in agent execution usage metrics tracking (cost/pricing data, cache token differentiation) and implement usage optimization techniques (prompt caching, tool result truncation, model routing) to enable accurate cost reporting and minimize LLM costs.
**Goal**: Enable per-execution cost reporting with accurate pricing, implement prompt caching for cost optimization, and provide CLI-level usage/cost visibility with historical reporting RPCs.
**Tech Stack**: Protobuf/gRPC (API schema), Go (stigmer-server, CLI), Python (agent-runner/LangGraph), Java (Temporal workflows)
**Components**: Proto APIs (agentexecution/v1, session/v1), agent-runner (Python/LangGraph), stigmer-server (Go), CLI (Go)

## Current State
- **Status**: Complete (all 9 phases + post-release bug fixes)
- **Last Session**: 2026-03-14 (Session 14) — Fix usage tracking on non-happy paths + read tool output filtering
- **Active Task**: All phases complete. Post-release fixes applied.
- **Branch**: `feat/usage-metrics-and-cost-optimization`

## Session Progress (2026-03-14, Session 14)

### Post-Release Bug Fixes — COMPLETED

Two critical bugs discovered through production observation of a `stigmer draft skill` execution against the Planton monorepo. Both were in the agent-runner Python codebase.

**Bug 1: Usage metrics zero for interrupted executions**

`finalize_usage()` — which stamps accumulated token/cost data from the `UsageTracker` onto the status proto — was only called on the normal completion path. All four non-happy exit paths (pause/cancel, stall timeout, recursion limit, exception) skipped it, producing zero usage data for interrupted executions.

**Fix**: Added `completed_at` stamping + `finalize_usage()` to all four exit paths in `execute_graphton.py`, placed immediately before each `update_status()` gRPC call. Uses the same idempotent two-line pattern as the happy path.

**Bug 2: Read tool results not filtered from execution state**

The `_READ_ONLY_TOOLS` set in `status_builder.py` contained only `{"read_file"}`, but the canonical tool name is `"read"` (set at `tool_wrappers.py:966`). The filter never matched, so all read tool results stored full file contents, inflating the execution state to 22,142 lines.

**Fix**: Added `"read"` to `_READ_ONLY_TOOLS` alongside `"read_file"`.

**Modified files (2 production, 1 test):**
- `execute_graphton.py` — Added `completed_at` + `finalize_usage()` to pause/cancel, stall timeout, recursion limit, and exception handlers
- `status_builder.py` — Added `"read"` to `_READ_ONLY_TOOLS` set
- `test_status_builder.py` — 6 new tests: 3 for read tool output filtering (canonical name, alias, non-read preserved), 3 for `finalize_usage` (stamps usage, graceful without `completed_at`, idempotent)

**Verification:** agent-runner 1243 passed, graphton 1161 passed — zero regressions.

---

## Session Progress (2026-03-14, Session 13)

### Phase 9: Smart Context / Selective Inclusion — COMPLETED

Implemented skill relevance filtering, tool count observability, and system prompt compression after discovering that the original plan's assumptions were fundamentally incorrect.

**Three critical discoveries that changed the plan:**
1. Skills already use progressive disclosure (~50-70 tokens per skill metadata, not full SKILL.md) — the "30% system prompt reduction" target was unreachable via skill filtering
2. MCP tool schemas live in the API tool-calling payload (via `bind_tools()`), not in the system prompt string — pruning removes capabilities, not tokens
3. Phase 8 already added line-range read guidance to the filesystem capability section

**9.1 Skill Relevance Filtering (BM25-based, signal quality)**

New files (1 production, 1 test):
- `skill_relevance.py` — BM25-inspired scorer: tokenizer, per-skill scoring, threshold-based filtering with safety floor (always keeps ≥ half of skills), populates `ResolvedExecutionContext.excluded_skill_names`
- `test_skill_relevance.py` — 26 tests: tokenization, BM25 scoring, filtering thresholds, safety floor, disjoint partitions

Modified files (3 production, 2 test):
- `skill_writer.py` — Added `generate_also_available_section()`: "Also Available" note listing excluded skills with self-activation instructions
- `execute_graphton.py` — Wired relevance filtering between skill fetching and prompt construction (only activates when ≥ 8 skills); passes `excluded_skill_names` to status builder
- `status_builder.py` — Extended `set_resolved_context()` with `excluded_skill_names` parameter (backward-compatible, defaults to `None`)
- `test_skill_writer.py` — 4 new tests for `generate_also_available_section()`
- `test_status_builder.py` — 4 new tests for `excluded_skill_names` handling

**9.2 Tool Count Observability and Guardrails**

Modified files (1 production):
- `agent.py` — Added tool count observability: structured warning when bound tools exceed 25 (configurable), info log with total count, and automatic description truncation at 500 chars for overly verbose MCP tool descriptions

**9.3 System Prompt Compression Audit**

Modified files (1 production):
- `prompt_enhancement.py` — Compressed all sections: RESILIENCE_PREAMBLE condensed from verbose explanations to crisp directives; removed "Edit Conflicts / Merge Issues" and "Large File Issues" from FILE_RECOVERY_STRATEGIES (covered elsewhere); tightened all recovery strategy sections from numbered multi-step lists to concise bullet points. **Before: 1,530 words → After: 1,107 words (28% reduction, all 35 tests pass)**

**Items explicitly deferred:**
- Dynamic tool schema pruning — requires restructuring LangGraph graph topology (high complexity, high risk)
- Context budget / token allocation — overlaps with existing summarization mechanism, needs own design phase
- Embedding-based skill relevance — over-engineering for current skill counts

**Verification:** All graphton tests pass (35/35 prompt enhancement tests). All agent-runner tests pass (26/26 skill relevance, 34/34 skill writer, 17/17 resolved context).

---

## Session Progress (2026-03-14, Session 12)

### Phase 8: Diff-Based Output Optimization — COMPLETED

Added editing efficiency guidance to system prompts and tool descriptions to steer LLMs toward using the `edit` tool (search-and-replace) instead of full-file `write` rewrites, reducing output token costs.

**Codebase audit finding**: The sandbox tools already had all required capabilities — `edit` supports search-and-replace, `read` supports line-range reads, tool result truncation is fully wired. The gap was that nothing steered the LLM toward choosing `edit` over `write`.

**Modified files (2 production):**
- `prompt_enhancement.py` — Added "Editing Efficiency" sub-section to `FILESYSTEM_CAPABILITY` constant (~65 words): prefer `edit` over `write` for modifications, use multiple `edit` calls, reserve `write` for new files
- `tool_wrappers.py` — Enhanced `write` tool docstring to signal full-file overwrite and redirect to `edit`; enhanced `edit` tool docstring to position it as the preferred modification tool with guidance on minimal `old_text` context

**Modified files (1 test):**
- `test_prompt_enhancement.py` — 2 new tests (`test_filesystem_capability_includes_editing_efficiency`, `test_filesystem_capability_prefers_edit_over_write`); bumped `test_prompt_size_reasonable` upper bound from 1500 to 1600 words to accommodate addition

**Key design decisions:**
- Tool descriptions are the highest-signal lever for LLM tool selection — enhanced docstrings are the primary optimization, system prompt guidance is secondary reinforcement
- Added to existing `FILESYSTEM_CAPABILITY` section (not a new section) to avoid prompt bloat
- ~65 words of system prompt addition = ~0.3% of context window — negligible cost for high signal
- Fast-apply pipeline (two-model architecture) explicitly deferred to P2 — needs its own design phase

**Verification:** All graphton tests pass (1161 passed, 1 skipped, 0 failed).

---

## Session Progress (2026-03-14, Session 11)

### Phase 7: Sub-Agent Model Routing — COMPLETED

Wired `SubAgent.model_override` (proto field 6, already defined in Phase 1) through the agent-runner transformer and graphton's HITL sub-agent compilation path so each sub-agent can run on a different (typically cheaper) LLM model than the parent agent.

**Modified files (2 production):**
- `subagent_transformer.py` — Reads `model_override` from proto, validates against `ModelRegistry` (platform ID or API model ID), adds `"model"` key to sub-agent dict when valid, returns `None` (skip) on invalid model (fail-fast)
- `agent.py` — In HITL compilation loop, resolves per-sub-agent `"model"` via `parse_model_string()` for strings, uses instances directly, or falls back to parent model

**New files (1 test):**
- `test_subagent_model_routing.py` — 4 HITL path tests: string resolution, instance passthrough, parent fallback, mixed list

**Modified files (1 test):**
- `test_subagent_transformer.py` — 5 new model_override tests + `model_override=""` added to all existing mock fixtures

**Key design decisions:**
- Fail-fast on invalid model_override: sub-agent is skipped entirely rather than silently falling back to parent model — forces operators to fix their agent config
- Validation uses two-step lookup: `ModelRegistry.is_registered()` then `ModelRegistry.get_by_api_model_id()` — accepts both platform IDs and API model IDs
- Model resolution uses `parse_model_string()` which applies Anthropic thinking config, cache control, and provider inference — same path as parent model
- No usage tracking changes needed — `UsageTracker._resolve_metadata()` already resolves pricing from actual model reported in `on_chat_model_end`
- Cost cap middleware conservatively overestimates when sub-agents use cheaper models (safe direction)

**Verification:** All graphton tests pass (1159 passed, 1 skipped, 0 failed). All agent-runner key tests pass (291 passed, 0 failed).

---

## Session Progress (2026-03-14, Session 10)

### Phase 6: CLI Usage Display & Commands — COMPLETED

Implemented per-execution usage enhancement and the `stigmer usage` command with three subcommands (`session`, `agent`, `org`) consuming the RPCs from Phase 5.

**New files (5 source + 4 test):**
- `usage_format.go` — 12 pure formatting helpers (formatCost, formatCacheHitRate, formatModelLabel, formatDurationBreakdown, formatCostLine, formatDate, formatDateRange, formatShare, formatMillis, formatTokensCompact, writeReportJSON, writeReportYAML)
- `usage_format_test.go` — 30 unit tests covering all helpers with edge cases
- `usage.go` — Parent `stigmer usage` command registered under Core Commands
- `usage_session.go` — `stigmer usage session <session-id>` with model breakdown + per-execution detail tables
- `usage_session_test.go` — Tests for basic, empty, single-model rendering
- `usage_agent.go` — `stigmer usage agent <agent-id> [--from/--to]` with summary stats + session table
- `usage_agent_test.go` — Tests for report rendering + date range formatting
- `usage_org.go` — `stigmer usage org --from --to [--org]` with model breakdown + top agents + daily trend
- `usage_org_test.go` — Tests for full, empty, and fallback scenarios

**Modified files (4):**
- `run_display_summary.go` — Added Model and Cost lines to EXECUTION COMPLETE panel; enhanced session exit line with inline cost (`Completed (30s · $0.074)`)
- `run_display_summary_test.go` — 3 new tests for panel enhancement (cost with cache, no cost, no cache)
- `root.go` — Registered `usage` under Core Commands group
- `BUILD.bazel` — Added all new source/test files + `fatih/color` library dep

**Key design decisions:**
- All formatting is pure-functional with zero I/O — fully testable
- Report commands follow the established `search.go` pipeline: args → config → daemon → connect → RPC → render
- `--output table|json|yaml` for all subcommands; JSON/YAML marshal proto directly
- No new packages — everything co-located in `root` package
- Graceful degradation — all display guards on data presence (zero visual regression for old executions)
- Renamed `renderJSON`/`renderYAML` to `writeReportJSON`/`writeReportYAML` to avoid collision with existing `renderJSON` in `run_stream_json.go`

**Verification:** `go build` clean, full test suite passes (including all new + existing tests)

---

## Session Progress (2026-03-14, Session 9)

### Phase 5: Server Usage Report RPCs — COMPLETED

Implemented all three Usage Report RPCs (`GetSessionUsageReport`, `GetAgentUsageReport`, `GetOrgUsageReport`) in both Go (stigmer OSS) and Java (stigmer-cloud production).

**Go (stigmer)** — 5 new files + BUILD.bazel update:
- `usage_aggregation.go` — 20+ shared aggregation helpers (pure functions)
- `usage_aggregation_test.go` — 15 unit tests (all passing)
- `get_session_usage_report.go` — 3-step pipeline handler
- `get_agent_usage_report.go` — 3-step pipeline handler with agent name resolution
- `get_org_usage_report.go` — 3-step pipeline handler with top-10 agents + daily trend

**Java (stigmer-cloud)** — 4 new files + 1 modified:
- `UsageAggregationService.java` — Shared aggregation Spring service
- `AgentExecutionGetSessionUsageReportHandler.java` — Pipeline handler with FGA auth
- `AgentExecutionGetAgentUsageReportHandler.java` — Pipeline handler with FGA auth + agent name resolution
- `AgentExecutionGetOrgUsageReportHandler.java` — Pipeline handler with FGA auth + top-10 agents + daily trend
- `AgentExecutionRepo.java` — Added `findAllBySessionId`, `findByAgentIdAndDateRange`, `findByOrgAndDateRange` query methods

**Key design decisions:**
- Go uses in-memory aggregation (matches existing OSS pattern)
- Java uses targeted MongoDB queries with date range criteria on `status.startedAt`
- Both use same aggregation algorithm (sub-agent cost inclusion, model breakdown merge by (model, provider), cost-descending sort)
- Java handlers intersect FGA-authorized IDs with query results for production authorization

---

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

## Project Complete

All 9 phases delivered:
1. **Phase 1**: Usage metrics schema foundation (proto definitions)
2. **Phase 2**: Model pricing registry and cache-aware pricing
3. **Phase 3**: Usage metrics population pipeline (field population, tool truncation, cost cap)
4. **Phase 4**: Prompt caching (4A: system/tool caching, 4B: automatic conversation caching + dep upgrade)
5. **Phase 5**: Server usage report RPCs (Go + Java)
6. **Phase 6**: CLI usage display and commands
7. **Phase 7**: Sub-agent model routing
8. **Phase 8**: Diff-based output optimization
9. **Phase 9**: Smart context / selective inclusion (skill relevance filtering, tool observability, prompt compression)

## Context for Reference

- **Phase 9 plan file**: `.cursor/plans/phase_9_smart_context_07d00830.plan.md`
- **Phase 6 plan file**: `.cursor/plans/cli_usage_phase_6_9fc7721f.plan.md`
- **Phase 5 plan file**: `.cursor/plans/phase_5_usage_report_rpcs_781e9b31.plan.md`
- **CLI usage commands**: `stigmer usage session|agent|org` — all three subcommands consume gRPC RPCs, support `--output table|json|yaml`
- **Three-layer caching** (Phase 4B): `_inject_cache_control()` in `graphton/core/models.py`
- **Key dep versions**: anthropic 0.84.0, deepagents 0.4.10, langchain-core 1.2.19, langgraph 1.1.2
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
