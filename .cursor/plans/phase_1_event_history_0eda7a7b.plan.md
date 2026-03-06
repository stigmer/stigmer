---
name: Phase 1 Event History
overview: "Implement the event history retention layer and subject update mechanism for the Stigmer CLI inline renderer. History records structured data for every committed item so the session can be re-rendered on demand. First use case: session header subject update via clear+re-commit."
todos:
  - id: step-1-types
    content: "Step 1: Create committedItem types and renderCommittedItem/reCommitHistory in run_stream_inline_history.go + tests"
    status: completed
  - id: step-2-recording
    content: "Step 2: Add history field to inlineRenderer; append committedItem in each render method (zero behavioral change)"
    status: completed
  - id: step-3-recommit
    content: "Step 3: Add reCommitMsg type and handler to model (zero behavioral change, no sender yet)"
    status: completed
  - id: step-4-header-thread
    content: "Step 4: Thread sessionHeaderInfo through streamAgentExecution -> streamAgentInline -> config; init history[0] as kindHeader"
    status: completed
  - id: step-5-poll
    content: "Step 5: Implement pollSessionSubject goroutine in run_stream_inline_header_update.go + tests"
    status: completed
  - id: step-6-wire
    content: "Step 6: Wire subject update channel into renderInline select loop; start poll goroutine in streamAgentInline (first behavioral change)"
    status: completed
  - id: step-7-verify
    content: "Step 7: Update BUILD.bazel, run go test + go vet, verify all tests pass"
    status: completed
isProject: false
---

# Phase 1: Event History Retention + Subject Update

## Architecture Decisions

### History lives on `inlineRenderer`, not the Bubbletea model

All rendering state already lives on `inlineRenderer`. Appending to history is synchronous (same goroutine as event processing), eliminating any race between "item appended" and "re-commit reads history." The model stays lean -- it only tracks active `View()` state.

For re-commit, the renderer packages a history snapshot into a `reCommitMsg` and sends it to the model via `program.Send()`. The model returns `tea.Sequence(ClearScreen, Println, Println, ...)` to Bubbletea, which executes them atomically within its render loop.

For Ctrl+O (Phase 4, future), the model receives the keypress and forwards it to the renderer via a shared channel. The renderer triggers re-commit using the same mechanism.

### AI content replayed to stderr during re-commit

Normal operation: AI messages go to stdout (`dataW`) for pipe compatibility. During re-commit: ALL content (including AI messages) replays to stderr via `tea.Println`. This reconstructs the terminal display without adding duplicate data to stdout. Pipe consumers are unaffected.

### Session header stays as pre-Bubbletea direct write

The initial header rendering (`renderSessionHeader(os.Stderr, ...)`) remains in the callers (`run_agent_exec.go`, `run_session.go`). The renderer receives `sessionHeaderInfo` via config, stores it as `history[0]`, and only re-renders it during re-commit. No changes to the command layer's rendering responsibility.

---

## Discoveries (surprises from T01 plan)

### 1. stdout/stderr tension with ClearScreen

`tea.ClearScreen` erases the entire terminal. AI content on stdout vanishes. The T01 plan's `kindText -> text as-is` didn't specify the writer. Resolution: replay everything to stderr during re-commit (decided above).

### 2. `resumeSession` doesn't use Bubbletea

[run_session.go](client-apps/cli/cmd/stigmer/root/run_session.go) line 137: `resumeSession` creates `inlineRenderConfig` without `program`. No Bubbletea for resumed sessions. Subject update is irrelevant here (subject already resolved). For Phase 4 (Ctrl+O), this path will need Bubbletea too -- noted for future.

### 3. `sessionSubject` parameter is dead code

`streamAgentExecution` receives `sessionSubject` (line 36 of [run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)) but never uses it -- leftover from the deleted `pollSessionSubject`. We'll replace it with `sessionHeaderInfo` to carry the full header data.

### 4. BUILD.bazel references non-existent files

`BUILD.bazel` already lists `run_stream_inline_header_update.go` and its test (lines 64, 177) but the files don't exist on disk. These were pre-allocated for this work. We'll create the files to satisfy the reference.

---

## Implementation Steps

### Step 1: Foundation types (`run_stream_inline_history.go`)

New file ~100 lines. Zero behavioral change.

- `committedKind` int type with constants: `kindHeader`, `kindToolCompact`, `kindReadGroup`, `kindApproval`, `kindAIMessage`, `kindHumanMessage`, `kindSystemMessage`, `kindSubAgentStart`, `kindSubAgentComplete`, `kindTodoUpdate`, `kindPhaseChange`, `kindText`
- `committedItem` struct: `kind`, `text string`, `subAgentID string`, `toolCalls []toolrender.ToolCallInfo`, `header *sessionHeaderInfo`, `action string`
- `renderCommittedItem(item committedItem, opts toolrender.CompactOptions) string` -- pure function that re-renders any item to its display string. Must satisfy the invariant: `renderCommittedItem(item) == originalOutput` for every kind.
- `reCommitHistory(items []committedItem, opts toolrender.CompactOptions) tea.Cmd` -- returns `tea.Sequence(tea.ClearScreen, tea.Println(item0), tea.Println(item1), ...)`

Key code reference -- the pure rendering function dispatches on kind:

```go
func renderCommittedItem(item committedItem, opts toolrender.CompactOptions) string {
    switch item.kind {
    case kindHeader:
        content := formatSessionHeaderContent(*item.header)
        if content == "" {
            return ""
        }
        return panel.Render(content, panel.Options{Title: "Stigmer", Style: panel.StyleDefault})
    case kindToolCompact:
        line := toolrender.RenderCompact(item.toolCalls[0], opts)
        if item.subAgentID != "" {
            line = toolrender.GutterWrap(line)
        }
        return line
    // ... other kinds
    }
}
```

### Step 2: History recording on renderer

Modify [run_stream_inline_types.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_types.go) and [run_stream_inline_render.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_render.go). Zero behavioral change.

- Add `history []committedItem` field to `inlineRenderer`
- Each render method appends to `r.history` after its `statusf()` call
- For AI content: record at `renderAIStreamEnd` and `renderAIMessage` (complete messages only, not deltas)
- For read groups: record at `flushPendingReads` (either as `kindReadGroup` or individual `kindToolCompact`)
- For approval results: record at `printCollapsedResult` (in `run_stream_inline_approval_display.go`)

Example change in `renderToolCompleted`:

```go
func (r *inlineRenderer) renderToolCompleted(e executiontui.ToolCompletedEvent) {
    line := toolrender.RenderCompact(e.ToolCall, r.compactOpts)
    if e.SubAgentID != "" {
        line = toolrender.GutterWrap(line)
    }
    r.statusf("%s\n", line)
    if strings.Contains(line, "\n") {
        r.statusf("\n")
    }
    r.history = append(r.history, committedItem{
        kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{e.ToolCall}, subAgentID: e.SubAgentID,
    })
}
```

### Step 3: Re-commit plumbing in the model

Modify [run_stream_inline_messages.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_messages.go) and [run_stream_inline_bubbletea.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go). Zero behavioral change (no one sends the message yet).

- New `reCommitMsg` type carrying `items []committedItem` and `compactOpts toolrender.CompactOptions`
- New `handleReCommit` on model that returns `reCommitHistory(msg.items, msg.compactOpts)`
- Wire in `Update()` switch

### Step 4: Thread header info to the renderer

Modify [run_stream_inline_types.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_types.go), [run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go), [run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go), [run_agent_exec.go](client-apps/cli/cmd/stigmer/root/run_agent_exec.go), [run_session.go](client-apps/cli/cmd/stigmer/root/run_session.go).

- Add `headerInfo sessionHeaderInfo` and `subjectUpdate <-chan string` to `inlineRenderConfig`
- Replace `sessionSubject string` parameter on `streamAgentExecution` with `headerInfo sessionHeaderInfo`
- Pass through to `streamAgentInline` and onto the config
- In callers, pass the already-constructed `sessionHeaderInfo` (currently used only for `renderSessionHeader`)
- In `renderInline`: prepend `history[0] = committedItem{kind: kindHeader, header: &cfg.headerInfo}` before entering the event loop

### Step 5: Subject polling (`run_stream_inline_header_update.go`)

New file ~70 lines. This is where the BUILD.bazel phantom entry gets satisfied.

- `pollSessionSubject(ctx context.Context, conn grpc.ClientConnInterface, sessionID string, ch chan<- string)` goroutine
- Polls `session.GetFromBackend(conn, sessionID)` every 3 seconds
- Checks `session.ResolvedSubject(subject)` -- if non-empty, sends on `ch` and returns
- Respects context cancellation
- Max ~10 attempts (30 seconds) then gives up silently

### Step 6: Wire subject update into the render loop

Modify [run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go) and [run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go). **First behavioral change.**

- In `streamAgentInline`: if `sessionID != ""` and `headerInfo.Subject == ""` (new session, subject pending), start `pollSessionSubject` goroutine with a `chan string` and pass it as `cfg.subjectUpdate`
- In `renderInline`'s select loop, add a case for `r.cfg.subjectUpdate`:

```go
case subject, ok := <-r.cfg.subjectUpdate:
    if ok && subject != "" {
        r.history[0].header.Subject = subject
        r.cfg.program.Send(reCommitMsg{
            items:       slices.Clone(r.history),
            compactOpts: r.compactOpts,
        })
    }
```

- The `gRPC ClientConn` needs to reach `streamAgentInline` -- it's already a parameter there (used for `execution.Cancel`). Use it for the poll goroutine.

Wait -- checking: `streamAgentInline` receives `conn *grpc.ClientConn` (line 77 of run_stream.go). Yes, it's available.

### Step 7: BUILD.bazel + verification

- Add `run_stream_inline_history.go` to `srcs`
- Verify `run_stream_inline_header_update.go` is already listed
- Add `run_stream_inline_history_test.go` to test `srcs`
- Verify `run_stream_inline_header_update_test.go` is already listed
- Run `go test ./client-apps/cli/cmd/stigmer/root/...` + `go vet`

---

## Files Inventory

### New

- `run_stream_inline_history.go` (~100 lines) -- committedItem types, renderCommittedItem, reCommitHistory
- `run_stream_inline_header_update.go` (~70 lines) -- pollSessionSubject goroutine
- `run_stream_inline_history_test.go` -- renderCommittedItem tests for each kind, reCommitHistory tests
- `run_stream_inline_header_update_test.go` -- pollSessionSubject tests

### Modified

- `run_stream_inline_types.go` -- headerInfo + subjectUpdate on config, history on renderer
- `run_stream_inline_render.go` -- history append in each render method
- `run_stream_inline_approval_display.go` -- history append in printCollapsedResult
- `run_stream_inline.go` -- history[0] init, subjectUpdate select case
- `run_stream_inline_bubbletea.go` -- reCommitMsg handler
- `run_stream_inline_messages.go` -- reCommitMsg type
- `run_stream.go` -- headerInfo param, subjectUpdate channel, poll goroutine start
- `run_agent_exec.go` -- pass headerInfo to streamAgentExecution
- `run_session.go` -- pass headerInfo to streamAgentExecution / resumeSession
- `BUILD.bazel` -- add new source + test files

### Unchanged

- `run_stream_inline_header.go` -- sessionHeaderInfo + formatSessionHeaderContent reused as-is
- `run_stream_inline_followup.go` -- follow-up history recording deferred to Phase 4
- `run_stream_inline_streaming.go` -- streaming state unchanged
- `run_stream_inline_spinner.go` -- spinner unchanged

---

## Test Strategy

- `**run_stream_inline_history_test.go**`: Table-driven tests for `renderCommittedItem` covering every `committedKind`. Golden string comparisons. Test `reCommitHistory` produces `tea.Cmd` sequence of correct length.
- `**run_stream_inline_header_update_test.go**`: Test poll goroutine sends resolved subject on channel. Test it doesn't send when subject is still pending. Test context cancellation stops polling. Test max-retry exit.
- `**run_stream_inline_test.go**`: Extend existing event processing tests to verify `r.history` length grows correctly as events are processed. Verify `history[0]` is always `kindHeader`.
- `**run_stream_inline_bubbletea_test.go**`: Test `handleReCommit` returns a non-nil Cmd (verifying the Sequence is constructed).

---

## Risks and Mitigations

- **Race between renderer append and model re-commit**: Near-impossible (poll fires seconds apart; append+send are back-to-back from same goroutine). Acceptable for Phase 1. Phase 4 can tighten if needed.
- **ClearScreen flash during re-commit**: Imperceptible for subject update (2-10s into session, ~3-5 history items). Profile in Phase 5 for long sessions.
- **Follow-up messages not in history**: Deferred to Phase 4. Subject resolves well before any follow-up prompt, so no impact on Phase 1.

