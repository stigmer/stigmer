# Fix Approval Flow Collapse Broken by Writer Wrapper

**Date**: March 4, 2026

## Summary

Fixed a critical bug where the approval flow's post-decision collapse was completely broken in production. After a user approved, skipped, or rejected a tool call, the expanded content (streamed file preview, approval question, menu) was never erased — it stayed on screen with the collapsed summary appended below. The root cause was a `lineCountingWriter` wrapper around `os.Stderr` that broke terminal detection in `termctl.IsSupported()`. A secondary fix corrects sub-agent row-count underestimation caused by gutter-wrap prefixes not being accounted for in `DisplayRows` calculations.

## Problem Statement

The inline CLI approval flow is designed to:
1. Stream file content as the AI generates it (pre-approval typewriter effect)
2. Show an approval question and interactive menu
3. After the user decides, erase all of the above and replace it with a compact summary

This collapse mechanism relies on ANSI cursor-up sequences (`EraseLines`) gated by `termctl.IsSupported()`, which checks whether the status writer is a real terminal.

### Pain Points

- After approving a Write tool, the full streamed YAML content, approval question, and menu all remained visible on screen — the collapsed summary was simply appended below
- The "Do you want to create ...?" question persisted after the user had already answered it
- The experience was confusing: users saw both the expanded approval UI and the collapsed result simultaneously
- For sub-agent tools, even when erasure worked, the row count was underestimated due to gutter-wrap prefixes, leading to partial erasure

## Solution

Two bugs were identified and fixed:

**Bug 1 (Primary):** The `setupSubjectUpdater` function wraps `os.Stderr` in a `lineCountingWriter` to track newlines for session header in-place updates. This wrapper was passed as `r.cfg.status` to the inline renderer. Both `termctl.IsSupported()` and `termctl.Width()` used direct `w.(*os.File)` type assertions, which fail on `*lineCountingWriter`, causing `canCollapse = false` and completely disabling all erasure.

**Bug 2 (Secondary):** In `renderToolStreamDelta`, the `streamLineCount` was computed from raw content via `DisplayRows(content, width)`, but the actual displayed output for sub-agent tools was gutter-wrapped (each line prefixed with `"  │ "`). The prefix makes lines wider, potentially causing more terminal wrapping, leading to row-count underestimation and partial erasure.

## Implementation Details

### Writer unwrap mechanism (`termctl.go`)

Added `unwrapFile()` — a private helper that follows an `Unwrap() io.Writer` interface chain to find the underlying `*os.File`:

```go
func unwrapFile(w io.Writer) *os.File {
    for {
        if f, ok := w.(*os.File); ok {
            return f
        }
        u, ok := w.(interface{ Unwrap() io.Writer })
        if !ok {
            return nil
        }
        w = u.Unwrap()
    }
}
```

Updated `IsSupported()` and `Width()` to use `unwrapFile()` instead of direct type assertions. This pattern mirrors Go's `errors.Unwrap` convention.

### `lineCountingWriter.Unwrap()` (`run_stream_inline_header_update.go`)

Added a one-line `Unwrap() io.Writer` method to `lineCountingWriter` so `termctl` can discover the real `*os.File` through the wrapper chain.

### Gutter-wrap row count fix (`run_stream_inline_streaming.go`)

In `renderToolStreamDelta`, when `r.streamSubAgentID != ""`, the content is now gutter-wrapped before computing `DisplayRows`, matching what was actually printed to the terminal.

### Tests (`termctl_test.go`)

Added 10 new tests covering:
- `unwrapFile` with direct `*os.File`, single-wrapped, double-wrapped, opaque (no `Unwrap`), and `bytes.Buffer` inputs
- `IsSupported` through wrapped and opaque writers
- `Width` through wrapped and opaque writers

## Benefits

- Approval collapse now works correctly in all production scenarios — the expanded approval UI is fully erased and replaced with a compact summary
- Terminal width detection is accurate even through middleware wrappers, improving `DisplayRows` calculations
- Sub-agent tool approval erasure is now pixel-accurate thanks to gutter-aware row counting
- The `Unwrap()` convention is future-proof: any new writer wrappers only need to implement a one-line method

## Impact

- **Users**: The approval flow now behaves as designed — approving a tool cleanly collapses to a compact summary instead of leaving ghost content on screen
- **CLI rendering**: All `termctl` functions correctly detect the terminal through any number of writer wrappers
- **Sub-agent tools**: Gutter-wrapped content row counts are now accurate, preventing partial erasure artifacts

## Files Changed

| File | Change |
|------|--------|
| `client-apps/cli/pkg/termctl/termctl.go` | Added `unwrapFile` helper; updated `IsSupported` and `Width` |
| `client-apps/cli/pkg/termctl/termctl_test.go` | Added 10 tests for unwrap functionality |
| `client-apps/cli/cmd/stigmer/root/run_stream_inline_header_update.go` | Added `Unwrap()` to `lineCountingWriter` |
| `client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming.go` | Fixed sub-agent gutter-wrap row count |

## Related Work

- Phase 3.3 (`handleApproval`) introduced the approval collapse mechanism
- Phase 3.0 (`termctl` primitives) established `IsSupported`, `EraseLines`, `DisplayRows`
- The `lineCountingWriter` was added as part of the session header subject update feature (`4c1392b6`)

---

**Status**: Production Ready
**Timeline**: ~1 hour (diagnosis + implementation + tests)
