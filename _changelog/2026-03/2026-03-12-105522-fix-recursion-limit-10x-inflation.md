# Fix Recursion Limit 10x Inflation and Add Graceful Limit Handling

**Date**: March 12, 2026

## Summary

Fixed a critical configuration bug where `execute_graphton.py` overrode graphton's intended recursion limit of 100 with 1000 in two separate locations, giving agents a 10x longer runway than designed. Added a dedicated `GraphRecursionError` handler so agents hitting the corrected limit degrade gracefully with a user-friendly message instead of crashing with a cryptic system error.

## Problem Statement

Production execution `aex-01kkg22yeeez6579b8mcaz5bwt` exhibited an agent self-improvement loop: after completing its task at ~step 30-40, the agent autonomously started a second pass — re-reading its output, identifying gaps, launching 6+ sub-agents. With the recursion limit inflated to 1000, the agent had ~960 wasted cycles before crashing from context overflow at 249K tokens.

### Pain Points

- `execute_graphton.py` passed `recursion_limit=1000` to `create_deep_agent()`, overriding graphton's default of 100
- A second `"recursion_limit": 1000` in the invoke-time config provided "defense-in-depth" at the wrong value
- The config validator's docstring said "The platform standard is 1000" while the actual default field was 100 — a contradiction that would cause (and did cause) re-introduction of this bug
- `GraphRecursionError` was not handled anywhere, meaning the new lower limit would produce cryptic "Internal system error" messages
- Cursor rule files contained example code with `recursion_limit=1000`, propagating the incorrect pattern to future AI-assisted development

## Solution

Restored graphton's authority over the recursion limit by removing both overrides from the orchestrator. Added a specific error handler for when agents legitimately hit the limit. Fixed all stale documentation to prevent drift.

## Implementation Details

### Core Fix: Remove Overrides (execute_graphton.py)

Removed `recursion_limit=1000` from the `create_deep_agent()` call, letting graphton's compiled default of 100 take effect via `with_config()`. Removed the redundant `"recursion_limit": 1000` from the invoke-time config dict — the single source of truth is now graphton's graph compilation, and LangGraph's `merge_configs` preserves it (100 != DEFAULT_RECURSION_LIMIT of 10,000).

Updated both comment blocks to document why the orchestrator intentionally does not override graphton's defaults and why no invoke-time override is needed.

### Error Handler: GraphRecursionError (execute_graphton.py)

Added a dedicated handler following the existing stall-detection pattern:
- Catches `GraphRecursionError` via type-name check (consistent with lazy-import pattern)
- Finalizes active sub-agents as `SUB_AGENT_CANCELLED` (not failed — the parent's limit is a planned boundary, not a sub-agent error)
- Appends a user-friendly message: "The agent reached the tool-call limit for this message. Send another message to continue."
- Sets `EXECUTION_FAILED` phase and persists via gRPC

### Documentation Fixes

- **config.py**: Updated `validate_recursion_limit` docstring from "platform standard is 1000" to "platform default is 100"; narrowed recommended range from "50-2000" to "50-500"
- **agent.py**: Added `logger.info("Graphton agent configured: recursion_limit=%d")` after `with_config()` for production observability
- **Cursor rules**: Removed `recursion_limit=1000` from example code in `learning-log.md` and `implement-agent-runner-features.mdc`; updated guidance to "Use graphton's default — do NOT override it"

### Test Updates

Updated 4 tests and docstrings in `test_recursion_limit.py` from platform value 1000 to 100: validator test, `with_config` test, `merge_configs` test, and class-level docstring.

## Benefits

- **Bounded execution**: Agents now have ~50 model+tool rounds (100 super-steps) per message — 2x Cursor's 25-tool-call limit, within Claude Code's recommended range for complex tasks
- **Graceful degradation**: Hitting the limit produces a clear "send another message to continue" instead of a cryptic system error
- **Single source of truth**: graphton owns the default; the orchestrator doesn't override it
- **Observability**: Production logs now record the effective `recursion_limit` at agent startup
- **Documentation consistency**: No more contradiction between defaults, docstrings, and examples

## Impact

- **Agent behavior**: All agent executions are now bounded at ~50 tool-call rounds per user message (down from ~500). This would have prevented the production self-improvement loop.
- **User experience**: Users hitting the limit see actionable guidance instead of a system error. Sub-agents are cleanly cancelled, not left in `IN_PROGRESS`.
- **Developer experience**: Future developers see consistent documentation. AI assistants using Cursor rules will not re-introduce the 1000 override.

## Related Work

- Part of project `20260312.01.agent-execution-consistency-guardrails` (PR3 of 5)
- Follow-up: Add `max_tool_calls` to `ExecutionConfig` proto for per-execution configurability (deferred to separate PR)
- Depends on: Loop detection middleware fix (PR1) for behavioral loop prevention at lower thresholds (7 consecutive / 20 total)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (analysis + implementation + industry research)
