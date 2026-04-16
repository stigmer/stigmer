# Fix Ink Bare "0" Render Crash on Session Resume

**Date**: April 16, 2026

## Summary

Fixed a fatal `Text string "0" must be rendered inside <Text> component` error in `@stigmer/ink` that crashed `stigmer resume` when the session had no active execution phase.

## Problem Statement

Running `stigmer resume <session-id>` on a completed session crashed with a React reconciler error from Ink. The error appeared twice (React re-render cycle), making the session completely unusable.

### Pain Points

- `stigmer resume` crashed on any completed session (no active execution)
- The error was a React internals stack trace with no clear user-facing guidance
- Both the initial render and re-render produced the same fatal error

## Solution

Changed the JSX guard in `SessionView.tsx` from a truthy check to an explicit null/zero check for the protobuf numeric enum value.

## Implementation Details

In `SessionView.tsx`, line 112:

```tsx
// Before (broken): 0 is falsy, && short-circuits to bare 0
{conv.activePhase && <ExecutionProgress phase={conv.activePhase} />}

// After (fixed): explicit check prevents bare number rendering
{conv.activePhase != null && conv.activePhase !== 0 && (
  <ExecutionProgress phase={conv.activePhase} />
)}
```

`conv.activePhase` is an `ExecutionPhase` protobuf enum (numeric). When no execution is active, it's `EXECUTION_PHASE_UNSPECIFIED = 0`. The expression `{0 && <Component />}` evaluates to `0` (not `false`), which React renders as the text node `"0"`. In Ink, bare text outside `<Text>` components is a fatal error.

## Benefits

- `stigmer resume` works correctly on completed sessions
- No regression on active sessions (non-zero phases still render `ExecutionProgress`)

## Impact

- **CLI users**: `stigmer resume` no longer crashes when resuming completed sessions

## Related Work

- [Fix Ink workspace detection](2026-04-16-141126-fix-ink-workspace-detection-resume-crash.md) -- previous fix in the same resume flow
- [CLI Ink Integration](2026-04-16-112010-cli-ink-integration-tui-replacement.md) -- introduced SessionView

---

**Status**: Production Ready
