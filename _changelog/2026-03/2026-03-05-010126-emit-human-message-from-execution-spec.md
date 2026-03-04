# Emit Human Message from Execution Spec in Stream and Snapshot Paths

**Date**: March 5, 2026

## Summary

The CLI's rendering pipeline for styled user messages was fully built but never received data. The subscribe stream delivers the full `AgentExecution` proto on every update, but `streamToEvents` only read `execution.Status.*` and completely ignored `execution.Spec.Message`. Two small reads -- one in the streaming path, one in the snapshot/replay path -- close the gap and light up the entire pipeline.

## Problem Statement

User messages were invisible in the CLI terminal output. Despite having a complete rendering pipeline (`humanMsgStyle`, `formatHumanMessage`, `renderHumanMessage`, `HumanMessageEvent`), the user's input message never appeared with highlighted styling. The conversation looked one-sided: AI responses and tool calls rendered, but the user's own prompt was absent.

### Pain Points

- **Initial message invisible**: After the session header, the CLI jumped directly to the AI's streaming response. The user's prompt was never shown.
- **Re-attach blind**: When re-opening a session via `stigmer run ses-xxx`, the conversation history replayed AI messages and tool calls but not the human prompts that triggered them.
- **JSON output incomplete**: The `--output json` mode never emitted `human_message` events, making the conversation log one-sided for downstream consumers.

## Solution

Read `execution.Spec.Message` (which already exists in every stream update and stored execution) and emit a `HumanMessageEvent` through the existing rendering pipeline. No backend changes, no local echo hacks, no new parameters to thread through function signatures.

## Implementation Details

### Streaming path (`run_stream_events.go`)

Added a `humanMessageEmitted bool` flag to the `streamToEvents` loop state. On the first `stream.Recv()` that carries a non-empty `execution.GetSpec().GetMessage()`, a `HumanMessageEvent` is emitted before processing status messages. The flag ensures it fires only once per execution. The `"execute"` default placeholder (set when the user provides no message) is suppressed.

### Snapshot/replay path (`run_stream_snapshot.go`)

In `emitSnapshotEvents`, added a spec message read before the message-walking loop. Each execution in the snapshot sequence emits its human message first, then its status messages -- preserving the natural conversation flow during session replay.

### Deduplication

The existing `suppressHumanEcho` mechanism in the follow-up loop already handles deduplication: follow-up messages are locally echoed immediately (for instant feedback), and the flag prevents the `HumanMessageEvent` from rendering the same message twice when the stream catches up.

### Tests

Five new tests added to `run_stream_snapshot_test.go`:

- `TestEmitSnapshotEvents_EmitsHumanMessageFromSpec` -- verifies the human message appears first from spec
- `TestEmitSnapshotEvents_SuppressesExecutePlaceholder` -- verifies `"execute"` is suppressed
- `TestEmitSnapshotEvents_SkipsEmptySpecMessage` -- verifies empty messages are skipped
- `TestEmitSnapshotEvents_SpecMessageBeforeAIContent` -- verifies ordering: human, AI, done
- `TestSnapshotToEvents_MultiExecution_SpecMessages` -- verifies multi-execution replay shows all human messages in order

All 19 existing snapshot tests continue to pass (existing `makeExecution` helper creates executions without Spec, so the guard safely skips them).

## Benefits

- **Visual clarity**: User messages now render with the dark-gray background + bright-white foreground styling already defined in `humanMsgStyle`, matching the Claude Code-inspired visual hierarchy
- **Complete conversation history**: Session re-attach shows the full back-and-forth, not just the AI side
- **Zero new dependencies**: Uses only the existing `HumanMessageEvent` type and lipgloss styles -- no new concepts introduced
- **Zero backend changes**: The data was always there in the execution proto; the CLI just wasn't reading it

## Impact

- **End users**: Every interactive session now shows user messages with highlighted styling before the AI response
- **Session replay**: `stigmer run ses-xxx` replays the complete conversation with proper visual hierarchy
- **JSON consumers**: `--output json` mode now includes `human_message` events in the NDJSON stream
- **Existing tests**: All 19 snapshot tests and full root package test suite pass unchanged

## Related Work

- Builds on the styled user message pipeline from changelog `2026-03-04-123306-styled-user-messages-and-input-prompt.md`, which implemented the styles and rendering handlers
- The follow-up local echo in `run_stream_inline_followup.go` and `suppressHumanEcho` deduplication mechanism remain unchanged and handle the follow-up message path correctly

---

**Status**: Production Ready
**Timeline**: Single session
