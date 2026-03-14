# Fix Ruff Lint Errors Across Graphton and Agent-Runner

**Date**: March 14, 2026

## Summary

Resolved all 20 ruff lint errors across the `graphton` library and `agent-runner` service that were causing `make check` to fail at the lint stage. The fixes span import sorting, PEP 8 naming conventions, unused import removal, and modern format-string usage.

## Problem Statement

Running `make check` on the stigmer repository failed during the lint phase. The `ruff check` step reported 20 errors across 10 Python files in two packages (`backend/libs/python/graphton` and `backend/services/agent-runner`).

### Pain Points

- CI gate (`make check`) blocked by lint failures
- Import blocks were un-sorted (I001) in 9 files
- Three uppercase local variables inside functions violated PEP 8 naming (N806)
- Unused imports (F401) in 3 test files
- One unused variable assignment (F841) in a test
- One legacy percent-format string (UP031) in production code

## Solution

Applied a two-pass approach: auto-fixed all mechanically correctable issues via `ruff check --fix`, then manually resolved the remaining 4 issues that required human judgment (variable renames and unused variable removal).

## Implementation Details

**Auto-fixed (16 errors)** — `ruff check --fix` handled:
- Import block sorting (I001) across all 9 affected files
- Unused import removal (F401) for `call`, `pytest`, `ScoredSkill`, and `patch`

**Manually fixed (4 errors):**

| File | Rule | Change |
|------|------|--------|
| `graphton/core/agent.py` | N806 | `_TOOL_COUNT_WARNING_THRESHOLD` → `tool_count_warning_threshold` |
| `graphton/core/agent.py` | N806 | `_TOOL_DESC_MAX_CHARS` → `tool_desc_max_chars` |
| `graphton/core/agent.py` | N806 | `_UNLIMITED` → `unlimited` |
| `agent-runner/worker/activities/execute_graphton.py` | N806 | `_UNLIMITED_RECURSION` → `unlimited_recursion` |
| `agent-runner/worker/activities/graphton/status_builder.py` | UP031 | `'%.6f' % value` → `f"{value:.6f}"` |
| `graphton/tests/core/test_subagent_model_routing.py` | F841 | Removed unused `mock_parent =` assignment |

## Benefits

- `make check` lint stage now passes cleanly for both Python packages
- Consistent PEP 8 naming inside function bodies
- Cleaner test files with no dead imports or variables
- Modern f-string formatting in production code

## Impact

- **graphton library**: 6 files updated (2 source, 4 tests)
- **agent-runner service**: 4 files updated (2 source, 2 tests)
- No functional behavior changes — all modifications are stylistic

## Related Work

- Part of ongoing code quality maintenance on the `feat/usage-metrics-and-cost-optimization` branch

---

**Status**: ✅ Production Ready
