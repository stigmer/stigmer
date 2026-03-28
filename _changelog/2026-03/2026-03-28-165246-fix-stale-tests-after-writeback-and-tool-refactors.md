# Fix Stale Tests After Git Write-Back and Tool Refactors

**Date**: March 28, 2026

## Summary

Fixed 17 failing tests across three test files in the agent-runner service. The tests were stale after recent production code refactors that (a) renamed `_maybe_trigger_inline_publish` to `_on_file_modifying_tool_end`, (b) removed the `create_pull_request` agent tool in favor of platform-owned git write-back, and (c) dropped git write-back guidance from the workspace prompt since the platform now handles post-execution branching, commits, and PRs.

## Problem Statement

`make check` on the stigmer repo failed with 17 test failures (1317 passed, 17 failed) while stigmer-cloud passed cleanly.

### Pain Points

- CI would block on the broken tests
- Tests referenced a method name (`_maybe_trigger_inline_publish`) that no longer existed on `StreamExecutor`
- Tests asserted the presence of git write-back prompt sections and the `create_pull_request` tool, both of which were intentionally removed
- Tests expected a "Current working directory" line in the multi-entry workspace preamble, which was also removed

## Solution

Updated all 17 tests to align with the current production implementation. No production code changes — only test expectations were adjusted.

## Implementation Details

### `test_inline_publish.py` (6 tests)

The `StreamExecutor._maybe_trigger_inline_publish` method was renamed to `_on_file_modifying_tool_end` when git write-back support was added (the method now fires both artifact publish and git write-back tasks). Updated all six call sites and the docstrings referencing the old name.

### `test_integration_skill_pipeline.py` (1 test)

`create_platform_tool_wrappers` no longer returns a `create_pull_request` tool (the platform's `writeback.py` module handles git operations post-execution). Removed the assertion and updated the expected tool count from 12 to 11 (8 primary + 3 aliases).

### `test_workspace_prompt_section.py` (10 tests)

`_git_writeback_guidance()` now unconditionally returns `""`. Consolidated seven single-entry write-back tests into one negative assertion. Removed "Current working directory" expectations from two multi-entry preamble tests. Consolidated three multi-entry write-back tests into one, and updated the credential-aware `_format_entry_description` test to assert no write-back guidance.

## Benefits

- `make check` passes cleanly on both stigmer and stigmer-cloud
- Test suite accurately reflects the platform-owned git write-back architecture
- Reduced test surface area for a feature that no longer exists in the prompt layer

## Impact

- **agent-runner test suite**: 17 tests fixed, net reduction of ~80 lines of stale test code
- **CI/CD**: Unblocked — all 1317 tests pass

## Related Work

- Incremental git write-back feature (`2026-03-28-162537-incremental-git-writeback-and-artifact-staleness.md`)
- Lint/type/build error fixes (`2026-03-28-164408-fix-lint-type-and-build-errors.md`)

---

**Status**: ✅ Production Ready
