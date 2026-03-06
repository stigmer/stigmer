---
name: Phase 6 Follow-up Prompt
overview: Migrate the follow-up prompt rendering into Bubbletea's View(), eliminating the last `termctl.EraseLines` call site in the inline renderer's Bubbletea path. Follows the same message/model/handler/View pattern established in Phases 2-5.
todos:
  - id: bubbletea-model
    content: Add followUp messages, model state, handlers, and View() branch in run_stream_inline_bubbletea.go
    status: completed
  - id: followup-refactor
    content: Extract formatFollowUpPrompt, readStdinLine, and add Bubbletea/direct branching in run_stream_inline_followup.go
    status: completed
  - id: model-tests
    content: Add follow-up model tests in run_stream_inline_bubbletea_test.go
    status: completed
  - id: verify
    content: Run tests, check lints, verify no regressions
    status: completed
isProject: false
---

# Phase 6: Follow-up Prompt Migration to Bubbletea View()

## Context

The follow-up prompt is the last piece of inline renderer UI that uses `termctl.EraseLines` in the Bubbletea path. It renders between executions (after `renderInline` returns, before the next execution starts), so the Bubbletea program is running but idle -- no spinner, no approval, no streaming. This makes it a clean migration target.

**The single EraseLines call to eliminate**: [run_stream_inline_followup.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_followup.go) line 48.

## Current Flow (what we're changing)

```mermaid
sequenceDiagram
    participant Loop as runInlineFollowUpLoop
    participant Render as renderInline
    participant Stderr as cfg.status (stderr)
    participant Stdin as os.Stdin

    Loop->>Render: renderInline(ctx, cfg)
    Render-->>Loop: phase, exitErr
    Loop->>Stderr: readFollowUpInput writes prompt
    Note over Stderr: separator + hint + "> "
    Loop->>Stdin: bufio.Scanner reads line
    Stdin-->>Loop: user input
    Loop->>Stderr: EraseLines(4)
    Loop->>Stderr: formatHumanMessage(input)
    Loop->>Render: renderInline (next execution)
```



## Target Flow (Bubbletea path)

```mermaid
sequenceDiagram
    participant Loop as runInlineFollowUpLoop
    participant Render as renderInline
    participant BT as tea.Program
    participant Stdin as os.Stdin

    Loop->>Render: renderInline(ctx, cfg)
    Render-->>Loop: phase, exitErr
    Loop->>BT: Send(followUpShowMsg)
    Note over BT: View() renders prompt
    Loop->>Stdin: readStdinLine()
    Stdin-->>Loop: user input
    Loop->>BT: Send(followUpHideMsg with styledMessage)
    Note over BT: View()="" + tea.Println(styledMessage)
    Loop->>Render: renderInline (next execution)
```



## Files to Modify

### 1. [run_stream_inline_bubbletea.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go) (~40 lines added)

- Two new message types:
  - `followUpShowMsg{content string}` -- pre-rendered prompt string (separator + hint + marker)
  - `followUpHideMsg{styledMessage string}` -- clear prompt, optionally commit styled human message
- Two new model fields: `followUpActive bool`, `followUpContent string`
- Two new Update handlers: `handleFollowUpShow`, `handleFollowUpHide`
  - `handleFollowUpHide` returns `tea.Println(styledMessage)` Cmd when non-empty (same pattern as `handleApprovalHide` and `handleStreamingHide`)
- View() priority updated: `approval > streaming > followUp > spinner > empty`
  - When `followUpActive`: return `m.followUpContent`

### 2. [run_stream_inline_followup.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_followup.go) (~30 lines net change)

- Extract `formatFollowUpPrompt() string` -- pure function building the prompt string (separator + hint + `>` ) currently inline in `readFollowUpInput`. Reusable by both paths and by View().
- Extract `readStdinLine() (string, error)` -- just the `bufio.Scanner` stdin-reading portion of `readFollowUpInput`, without the rendering side.
- Rename existing `readFollowUpInput` to `readFollowUpInputDirect` -- preserves the current direct-write behavior for the `program == nil` fallback.
- Restructure `runInlineFollowUpLoop` body: replace the inline prompt/erase/echo sequence with a call to `promptFollowUp(cfg)` which branches:
  - **Bubbletea path** (`cfg.program != nil`): `promptFollowUpViaBubbletea` -- sends `followUpShowMsg`, calls `readStdinLine`, sends `followUpHideMsg`
  - **Direct-write path** (`cfg.program == nil`): `promptFollowUpDirect` -- calls `readFollowUpInputDirect`, runs `EraseLines`, writes styled message

### 3. [run_stream_inline_bubbletea_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea_test.go) (~80 lines added)

New model tests following the established pattern from Phases 2-5:

- `followUpShowMsg` activates state and stores content
- `followUpHideMsg` deactivates and returns nil Cmd when empty
- `followUpHideMsg` with styledMessage returns a Println Cmd
- View() renders prompt content when followUp is active
- View() priority: approval > followUp (defensive)
- View() priority: streaming > followUp (defensive)
- View() priority: followUp > spinner (defensive)
- `followUpHideMsg` clears all follow-up state fields

## Key Design Decisions

- **Branching pattern**: Matches Phase 4 (approval) and Phase 5 (streaming) -- `if program != nil` branches in the orchestration function, with dedicated `*ViaBubbletea` and `*Direct` helpers.
- **No synchronization needed**: `program.Send(followUpHideMsg{...})` enqueues the message. Bubbletea processes it sequentially before any messages from the next `renderInline` call. The `followUpFn` network call between hide and next render provides ample processing time.
- **Direct-write fallback fully preserved**: All existing tests use `cfg.program == nil` and will continue to pass without modification.
- **Known edge case (documented, not a blocker)**: User-typed text echoes via terminal driver, outside Bubbletea's control. Works correctly for typical-length input. Long wrapping input has the same limitation as the current `EraseLines(4)` approach. Fully resolved by the next project (20260305.02) when Bubbletea takes stdin ownership.

## Checkpoint Criteria

- `termctl.EraseLines` on followup.go line 48 is unreachable when `program != nil`
- All existing tests pass (same 2 pre-existing failures)
- New model tests pass
- `go vet ./client-apps/cli/...` clean
- Visual output identical to current behavior (manual smoke test)

