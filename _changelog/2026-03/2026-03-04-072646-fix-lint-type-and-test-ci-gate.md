# Fix Lint, Type, and Test Failures to Pass CI Gate

**Date**: March 4, 2026

## Summary

Resolved all lint, type-check, and test failures surfaced by `make check` after the Phase 5 dead-code cleanup. Fixes span Python (ruff E741/I001, mypy) and Go (gofmt formatting, stale inline renderer test assertions).

## Problem Statement

After the TUI removal and dead-code cleanup (Phase 5), `make check` failed at three stages: ruff lint, mypy type checking, and Go test execution.

### Pain Points

- Python linter flagged ambiguous single-letter variable `l` in list comprehensions (E741) across two test files
- Import blocks were unsorted in `provisioner.py` and `test_multi_workspace_integration.py` (I001)
- mypy reported incompatible type assignments in `status_builder.py` where a handler variable inferred its type from an async method, then was assigned sync methods
- Three inline renderer tests asserted against stale output formats that no longer matched the current compact rendering pipeline (read tool suppression, bullet-style output, sub-agent Task headers)
- `gofmt -s -w` reformatted whitespace alignment across ~46 backend and CLI files

## Solution

Applied targeted fixes for each category:

1. **E741**: Renamed `l` → `line` in list comprehensions
2. **I001**: Sorted `from` imports alphabetically within stdlib groups
3. **mypy**: Added explicit `Callable | Coroutine | None` union type annotation to the event handler dispatch variable
4. **Go tests**: Updated three test cases to use tool names and assertions matching the current rendering behavior (non-read tools for running/completed tests, `Task` label for sub-agent header)
5. **gofmt**: Auto-applied by `make check`'s `gofmt -s -w .` step

## Implementation Details

### Python Fixes

- `tests/test_workspace_prompt_section.py`: `l` → `line` in one comprehension
- `tests/workspace/test_multi_workspace_integration.py`: `l` → `line` in four comprehensions; import block reordered
- `worker/workspace/provisioner.py`: `from collections.abc import Sequence` moved before `from dataclasses`
- `worker/activities/graphton/status_builder.py`: Added `Callable` and `Coroutine` imports; typed `handler` as `Callable[[dict[str, Any], str], None | Coroutine[Any, Any, None]] | None`

### Go Test Fixes

- `TestInlineRenderer_ToolRunning_GoesToStderr`: Changed from `read_file` (suppressed by read grouping) to `bash` (known shell tool with compact running output)
- `TestInlineRenderer_ToolCompleted_ShowsBadge`: Changed from `read_file` (buffered/grouped) to `custom_mcp_tool` (unknown tool that routes through `RenderWithBadge` with `✓`)
- `TestInlineRenderer_SubAgentLifecycle`: Updated assertion from `"Sub-agent started: find docs"` to `"Task"` + `"find docs"` matching `renderSubAgentStarted` output

## Benefits

- `make check` passes cleanly (exit code 0) — CI gate is green
- All 1071 Python tests pass
- All Go tests pass across backend, CLI, and e2e packages

## Impact

- Unblocks CI for the `feat/cli-tui-ux-hardening` branch
- No behavioral changes — all fixes are cosmetic (lint/format) or test-alignment

## Related Work

- Follows [Dead Code Cleanup and TUI Removal](2026-03-04-071750-dead-code-cleanup-and-tui-removal.md) which introduced the test drift
- Continues the inline-first CLI initiative documented in the Phase 5 session notes

---

**Status**: ✅ Production Ready
