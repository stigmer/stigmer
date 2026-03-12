# Fix `make check` CI Gate — Lint, Type, and Test Errors

**Date**: March 12, 2026

## Summary

Resolved all `make check` failures across the agent-runner backend: 4 ruff lint violations (import sorting, unused imports, variable naming), 5 mypy type errors (unreachable code, incorrect type-ignore codes, protobuf enum typing), and 2 test assertion mismatches caused by recent function signature changes.

## Problem Statement

The `make check` CI gate (tidy → lint → build → test) was failing at two stages:

### Pain Points

- **Ruff lint failures**: Import blocks in new test files (`test_execution_budget`, `test_loop_detection`, `test_approval_resume`, `test_checkpoint_validator`, `test_workspace_prompt_section`) were unsorted. A late module-level import in `execute_graphton.py` with `# noqa: E402` was confusing ruff's I001 import sorter. Local constants `_MIN_TOOL_ROUNDS` / `_MAX_TOOL_ROUNDS` inside a function violated N806. Unused imports (`pytest`, `ApprovalAction`, `AgentMessage`) accumulated during rapid development.
- **Mypy type errors**: `type: ignore[assignment]` on `subagent_transformer.py` suppressed the wrong error code (should be `arg-type`). Protobuf's `SummarizationSource.Value()` returns `int` but the proto constructor expects the enum type. `graph_state = None` sentinel conflicted with `StateSnapshot` typing. Two unreachable code paths — one from mypy's type narrowing on `isinstance(tc, dict)` (always True per `tool_calls` typing), another from `if not matched_tool_call_id:` guard blocking mypy's view of a loop-modified variable.
- **Test assertion mismatches**: `_generate_sub_agent_subject` gained an `existing_subjects` kwarg but one test's `assert_called_once_with` wasn't updated. `_try_enrich_phase1_entry` added a relaxed pass (tool_name-only matching, ignoring `from_sub_agent`) but the test still expected the old strict-only behavior.

## Solution

- Auto-fixed 16 ruff violations with `ruff check --fix` across graphton and agent-runner
- Manually renamed 2 function-local constants to lowercase and moved 1 late import to the top-level import block
- Added targeted `# type: ignore` comments for 4 mypy false positives (unreachable, arg-type, assignment)
- Updated 2 test assertions to match current function contracts

## Implementation Details

### Files Changed (5)

| File | Change |
|------|--------|
| `execute_graphton.py` | `graph_state = None` → `# type: ignore[assignment]`; break in nested loop → `# type: ignore[unreachable]` |
| `checkpoint_validator.py` | `else` branch on `tool_calls` dict check → `# type: ignore[unreachable]` |
| `status_builder.py` | `SummarizationEvent(source=...)` → `# type: ignore[arg-type]` |
| `subagent_transformer.py` | `# type: ignore[assignment]` → `# type: ignore[arg-type]` |
| `test_status_builder.py` | Added `existing_subjects=[]` to mock assertion; updated `test_matches_from_sub_agent_flag` to verify relaxed pass |

## Benefits

- `make check` passes cleanly: 1173 tests pass, zero lint/type errors
- CI gate is unblocked for the current branch (`fix/sub-agent-timer-and-tool-count`)

## Impact

Backend agent-runner only. No functional behavior changes — all fixes are type annotations, lint compliance, and test alignment.

---

**Status**: ✅ Production Ready
