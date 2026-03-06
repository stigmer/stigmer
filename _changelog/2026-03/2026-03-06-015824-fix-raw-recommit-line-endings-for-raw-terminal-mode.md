# Fix Raw Recommit Line Endings for Raw Terminal Mode

**Date**: March 6, 2026

## Summary

Fixed garbled display output after recommit by replacing `\n` with `\r\n` in the `tea.Raw` payload. Bubbletea's raw terminal mode disables output post-processing, so bare line-feeds don't return the cursor to column 0.

## Problem Statement

After switching `buildReCommitCmd` from `tea.Println` (which handles cursor positioning internally) to `tea.Raw` (which writes directly to the output buffer), the entire terminal display became garbled on recommit. Text appeared at wrong horizontal positions — each line offset further right than the last.

### Pain Points

- Every line of the recommitted history rendered at the column where the previous line ended, instead of column 0
- The header panel, session info, and tool output overlapped into an unreadable mess
- The display was immediately broken on any recommit trigger (subject update, recent sessions, Ctrl+O)

## Solution

Replace `\n` with `\r\n` in the rendered content before passing to `tea.Raw`. The explicit `\r` (carriage return) moves the cursor to column 0 before `\n` (line feed) moves it down.

## Implementation Details

Bubbletea puts the terminal in raw mode via `cfmakeraw()`, which disables `OPOST`/`ONLCR` (output post-processing). In this mode, `\n` is a bare line-feed — it moves the cursor down one row but does not return to column 0. Bubbletea's own renderer (`insertAbove`, `transformLine`) avoids this by using explicit ANSI cursor movement sequences (CUD, CR, CUB) rather than relying on `\n`.

The `renderHistoryBatch` output uses `\n` for line breaks (standard Go string formatting). When this content was written via `tea.Raw` (bypassing the renderer), the raw mode terminal interpreted each `\n` as "down one row, same column," causing the progressive rightward drift.

The fix applies `strings.ReplaceAll(rendered, "\n", "\r\n")` in `buildReCommitCmd` before constructing the Raw payload.

## Benefits

- Recommit display renders correctly with all lines starting at column 0
- No changes to the rendering pipeline or history format — the fix is isolated to the Raw output boundary

## Impact

Affects the same recommit paths as the parent fix: subject update, recent sessions, Ctrl+O toggle, and approval-transition recommits. Purely a display-layer correction with no architectural impact.

## Related Work

- Parent fix: `2026-03-06-013928-fix-recommit-scrollback-duplication-via-raw.md`

---

**Status**: ✅ Production Ready
