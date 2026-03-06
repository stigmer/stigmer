# Fix Duplicate User Message and Spacing Regression

**Date**: March 6, 2026

## Summary

Fixed two rendering defects in the CLI inline renderer: a duplicate user message caused by redundant emission from two independent event sources, and a spacing regression where `TrimRight` stripped intentional blank-line gaps added by `statusf` callers.

## Problem Statement

After the Bubbletea v2 migration, two visual issues appeared in the CLI output:

### Pain Points

- The user's input message appeared **twice** in the terminal — once from `execution.Spec.Message` (the canonical source) and again from `MESSAGE_HUMAN` entries in the conversation log. The `humanMessageEmitted` flag only guarded the first source; the messages-array path had no dedup awareness.
- Blank-line gaps between human messages, system messages, phase changes, and sub-agent completions disappeared. The `statusf` helper used `strings.TrimRight(msg, "\n")` which stripped **all** trailing newlines, then `Println` re-added only one — destroying the intentional `\n\n` spacing that callers relied on.
- The `renderHistoryBatch` re-commit path also lacked the gap logic, so even when initial rendering was correct, toggling expand mode would lose the spacing.

## Solution

**Duplicate message**: Skip `MESSAGE_HUMAN` entries in both the streaming event bridge (`emitMessageEvents`) and the snapshot replay path (`emitSnapshotEvents`). Since every execution has exactly one user message carried in `Spec.Message`, the `MESSAGE_HUMAN` entries in `Status.Messages` are always redundant.

**Spacing**: Replace `TrimRight` with `TrimSuffix` in `statusf` so exactly one trailing `\n` is removed (the one `Println` will re-add), preserving any intentional blank-line gap. Additionally, add trailing `\n` gaps in `renderHistoryBatch` for item kinds that produce them during initial rendering, keeping both paths consistent.

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `run_stream_events.go` | Added `MESSAGE_HUMAN` skip in `emitMessageEvents` Phase 2 loop |
| `run_stream_snapshot.go` | Added `case MESSAGE_HUMAN:` no-op in snapshot message switch |
| `run_stream_inline_render.go` | `TrimRight` → `TrimSuffix` in `statusf` |
| `run_stream_inline_history.go` | Added `needsGap` logic for `kindHumanMessage`, `kindSystemMessage`, `kindSubAgentComplete`, `kindPhaseChange` |
| `run_stream_snapshot_test.go` | Added `Spec.Message` to 4 test fixtures relying on human message emission |
| `run_stream_inline_history_test.go` | Updated golden test to include gap logic in expected-output builder |

### Key Decision: TrimSuffix vs TrimRight

`TrimRight(s, "\n")` treats the second argument as a **character set** and strips all trailing characters in that set — so `"text\n\n"` becomes `"text"`. `TrimSuffix(s, "\n")` treats it as a literal **suffix** and removes exactly one occurrence — so `"text\n\n"` becomes `"text\n"`. After `Println` re-adds one `\n`, the net result is `"text\n\n"` (blank line preserved).

## Benefits

- **No more duplicate messages**: The user's input appears exactly once, regardless of whether the CLI is streaming live or replaying a snapshot.
- **Restored visual rhythm**: Blank-line gaps between logical sections (human input, system notices, phase transitions, sub-agent summaries) are preserved in both initial rendering and re-commit.
- **Consistent rendering paths**: Both `statusf` (initial) and `renderHistoryBatch` (re-commit) now produce identical spacing.

## Impact

- **CLI users**: Cleaner terminal output with correct spacing and no duplicate messages.
- **Snapshot/resume path**: Users reconnecting to sessions see the same output as live streaming.
- **Test coverage**: All 4 snapshot tests and the history batch golden test updated to validate the new behavior.

---

**Status**: ✅ Production Ready
