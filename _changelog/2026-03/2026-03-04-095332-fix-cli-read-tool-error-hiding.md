# Fix CLI Read Tool Error Hiding

**Date**: March 4, 2026

## Summary

Fixed a bug where the CLI's compact read tool renderer silently hid read failures, showing a misleading line count (e.g., "11 lines") instead of the actual error message. The backend embeds tool errors in the result field with `status=COMPLETED`, which the CLI now detects and displays correctly.

## Problem Statement

When the agent's read tool fails (file not found, permission denied, path escaping sandbox), the Python backend catches the exception, wraps it in an enriched error message (`"Error: ..."` with recovery suggestions), and returns it as a normal result string. The proto `ToolCall` status stays `TOOL_CALL_COMPLETED` and the `error` field stays empty.

### Pain Points

- Read failures displayed as `"Read 11 lines"` — the 11 lines being the error message + recovery suggestions
- Users had no indication that a read failed; the agent would silently retry with different paths
- Grouped reads (`● Read 3 files`) didn't count error-in-result entries in the `(N failed)` header
- Debugging workspace file access issues was nearly impossible from the CLI output

## Solution

Added a `toolCallError` helper that checks three error sources in priority order:
1. `tc.Error` (explicit proto error field)
2. `tc.Status == "failed"` (status-only failure)
3. `tc.Result` starts with `"Error: "` (backend's enriched error format)

Applied this unified check to `renderCompactRead`, `renderGroupEntry`, and `RenderReadGroup`'s fail counter.

## Implementation Details

**Files changed (2 production):**
- `client-apps/cli/pkg/toolrender/render_compact.go` — added `toolCallError`, `extractResultError`, and `resultErrorPrefix`; replaced inline error checks in 3 render functions
- `client-apps/cli/pkg/toolrender/render_compact_test.go` — 16 new tests covering error-in-result detection, priority ordering, and false-positive safety

**Key design decisions:**
- Detection uses `strings.HasPrefix(result, "Error: ")` — matches the exact prefix from the backend's `enrich_error_message` function; no regex overhead
- `extractResultError` returns only the first line (the actual error), stripping the "Recovery suggestions" block — keeps the `✗` line clean and scannable
- Explicit `tc.Error` takes priority over result-embedded errors — preserves existing behavior for properly-flagged failures
- Fix scoped to read renderers only — other tools (shell, write, etc.) can adopt `toolCallError` later

## Benefits

- Read failures now show `✗ File not found: 'path' (resolved to '...')` instead of `Read 11 lines`
- Grouped reads correctly count failed entries in the `(N failed)` header
- Users can immediately see which files failed and why, enabling faster debugging of workspace issues

## Impact

Affects all CLI users running multi-workspace sessions or any session where file reads fail. No behavioral change for successful reads. All 100+ existing toolrender tests continue to pass.

## Related Work

- Backend `enrich_error_message` in `graphton/core/error_hints.py` — the source of the `"Error: "` prefix convention
- Backend `status_builder.py` — always sets `TOOL_CALL_COMPLETED` for tool results (root cause; separate fix needed)
- Multi-workspace project `20260304.01` — this bug surfaced during multi-workspace testing where workspace paths couldn't be resolved

---

**Status**: ✅ Production Ready
