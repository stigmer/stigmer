# Dead Code Removal: Agent Runner & Graphton Library

**Date**: March 12, 2026

## Summary

Systematic dead code analysis and removal across the Agent Runner service and Graphton library, eliminating ~1,877 lines of unreachable, unused, or disconnected code. This cleanup covers entire abandoned modules, dead subsystems, orphaned methods with test coverage but no production callers, fragile patterns, and repeated inline imports.

## Problem Statement

After extensive refactoring across 10 sessions (5 PRs + 7 deferred follow-ups) for the agent execution consistency guardrails project, significant dead code had accumulated. The catalyst was discovering that `LoopDetectionMiddleware` was entirely dead — its `aafter_step` hook didn't exist in LangGraph's `AgentMiddleware`. This raised the question: what other dead code is hiding in the codebase?

### Pain Points

- Abandoned architectural approaches (MCP authentication via `authenticated_tool_node.py` + `context.py`) left as full modules
- Docker/local execution subsystem in `SandboxManager` (~330 lines) never called since Daytona became the sole execution backend
- `StatusBuilder` approval methods (`set_tool_waiting_approval`, `set_tool_approval_decision`) were well-designed and had 15+ passing tests, but production code bypassed them entirely via inline proto mutation
- Variable shadowing (`api_key` reused for Daytona in cloud mode) masked by channel reuse but architecturally fragile
- Repeated inline imports of `AgentMessage` and `MessageType` at 7 locations instead of once at module level
- Over-exported API surfaces creating false impressions of public contracts

## Solution

Conducted a Principal Software Architect-level analysis categorizing dead code into:

- **Category A (Purely Useless)**: ~850 lines that can be safely deleted with zero behavior change
- **Category B (Needed but Disconnected)**: ~310 lines of well-designed, tested code that was bypassed in production — the same pattern as the original `LoopDetectionMiddleware` discovery

For Category B, the decision was to **delete now, re-encapsulate later** — mixing a behavioral refactor (reconnecting approval methods) with a purely subtractive cleanup would add risk to an otherwise zero-behavior-change PR.

## Implementation Details

### Files Deleted Entirely (4 modules, ~648 lines)

| File | Lines | Reason |
|------|-------|--------|
| `graphton/core/authenticated_tool_node.py` | 334 | Abandoned MCP auth approach; never imported |
| `graphton/core/context.py` | 116 | Part of abandoned auth; `set_user_token` etc. never called |
| `worker/command_parser.py` | 73 | `format_execute_tool_name()` never called |
| `test_graphton_integration.py` | 125 | Standalone script outside test suite |

### Subsystems Removed (~518 lines)

| File | What | Lines |
|------|------|-------|
| `sandbox_manager.py` | Docker/local execution: `ExecutionResult`, `execute_command()`, `_execute_local()`, `_execute_docker()`, `_ensure_sandbox_image()`, `_get_or_create_container()`, `cleanup_containers()`, `_determine_execution_mode()`, `_auto_detect_mode()` | 406 |
| `tool_wrappers.py` | `create_lazy_tool_wrapper()` | 112 |

### Surgical Removals (~300 lines production, ~411 lines tests)

| File | What Removed |
|------|-------------|
| `status_builder.py` | `namespace_mapping` attr, `get_artifacts()`, `set_tool_waiting_approval()` (95 lines), `set_tool_approval_decision()` (106 lines) |
| `approval_policy.py` | `get_platform_tool_names()` |
| `config_transformer.py` | Duplicate `resolve_placeholders()` shadowing canonical version |
| `update_scheduler.py` | `StreamingUpdateScheduler.reset()` |
| `mcp/__init__.py` | Over-exported symbols (`PlaceholderResolutionResult`, `resolve_placeholders_strict`) |
| `execute_graphton.py` | 2 unreachable None guards, unused `_resolved_metadata`, unused `session_id_from_spec`, 7 inline import duplicates |

### Code Quality Fixes

| File | Fix |
|------|-----|
| `execute_graphton.py` | `api_key` → `daytona_api_key` (eliminated variable shadowing) |
| `execute_graphton.py` | `AgentMessage`, `MessageType` moved from 7 inline imports to module-level |
| `execute_graphton.py` | Backward-compat re-exports consolidated into direct imports |
| `test_workspace_prompt_section.py` | Updated imports to point at canonical `worker.workspace.tree` |
| `test_config_transformer.py` | Updated import to canonical `placeholder_resolver` module |

## Benefits

- **1,877 lines removed** — less code to maintain, review, and reason about
- **Zero behavior change** — purely subtractive; 812 tests pass, 0 regressions
- **Cleaner architecture** — `SandboxManager` is now a focused Daytona lifecycle manager instead of a 3-mode dispatch monster
- **Eliminated fragile patterns** — `api_key` shadowing fixed, inline imports consolidated
- **Accurate API surface** — `mcp/__init__.py` exports only what production actually uses

## Impact

- **Agent Runner service**: 11 production files modified, 4 deleted
- **Graphton library**: 3 files affected (2 deleted, 1 trimmed)
- **Test suite**: 6 test files updated (removed ~411 lines of dead tests, fixed import paths)
- **All pre-existing tests pass** — 812 agent-runner tests green

## Related Work

- Follows from the agent-execution-consistency-guardrails project (Sessions 1–10)
- The `LoopDetectionMiddleware` dead code discovery that initiated this analysis was fixed in PR1 of that project
- The `set_tool_waiting_approval` / `set_tool_approval_decision` encapsulation is a candidate for a future focused refactor

---

**Status**: Production Ready
**Timeline**: Single session (~1 hour analysis + implementation)
