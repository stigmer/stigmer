# Known Limitation: Ctrl+O During Follow-up Prompt

## Behavior

When the user is at the follow-up prompt (text input active between executions), pressing Ctrl+O does **not** immediately toggle expand/collapse mode. The signal is buffered in `toggleExpandCh` (capacity 1) and processed when the next `renderInline` call starts its event loop.

## Root Cause

The `renderInline` event loop — which processes `toggleExpandCh` via `select` — is not running during `promptFollowUp`. The follow-up prompt blocks on `<-inputCh` (channel-based path) or `readFollowUpInputDirect` (direct path). Neither path monitors `toggleExpandCh`.

## Observed User Experience

- User completes an execution, sees the follow-up prompt
- User presses Ctrl+O — nothing happens visually
- User submits follow-up text, the next execution begins
- The buffered toggle signal is consumed by the next `renderInline`'s event loop
- The mode flips and a re-commit occurs, which now covers the full accumulated history

The toggle is not lost — it is deferred. The delay is perceptible but not destructive.

## Potential Solutions

1. **Integrate prompt into the event loop**: Make `promptFollowUp` non-blocking by running the text input as part of the Bubbletea model's `Update()` cycle, while also monitoring `toggleExpandCh`. This requires the re-commit mechanism (currently on `inlineRenderer`) to be accessible between executions — either by persisting the renderer or moving re-commit to the Bubbletea model.

2. **Move re-commit to Bubbletea model**: The model already handles `streamingHideMsg` and `tea.Println`. If it also owned the committed history and re-commit logic, it could process Ctrl+O toggles at any time. This is a significant refactor of the renderer/model boundary.

Both approaches require substantial restructuring and were deferred to avoid scope creep in Phase 4.

## Decision

Defer to a future phase. The limitation is acceptable because:
- The toggle is buffered, not lost
- The follow-up prompt is a brief transition state
- The behavioral impact is minimal (slight delay, not broken functionality)
