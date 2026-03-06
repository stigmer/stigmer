---
name: Phase 3 Header Simplification
overview: Delete the in-place subject update mechanism (lineCountingWriter, subjectUpdater, ANSI cursor math) and render the session header without the Subject field when it's unknown. The Subject field appears naturally on session resume when it's already resolved. This eliminates the root cause of terminal wrapping bugs in the header path.
todos:
  - id: modify-run-agent-exec
    content: "Modify run_agent_exec.go: remove Subject placeholder, delete setupSubjectUpdater call, delete pollSessionSubject goroutine, pass raw writers to streamAgentExecution"
    status: completed
  - id: delete-header-update
    content: Delete run_stream_inline_header_update.go entirely (lineCountingWriter, subjectUpdater, all ANSI cursor math)
    status: completed
  - id: delete-header-update-tests
    content: Delete run_stream_inline_header_update_test.go entirely
    status: completed
  - id: cleanup-imports
    content: Clean up any unused imports in run_agent_exec.go after deletions
    status: completed
  - id: verify-build-and-tests
    content: Run go build, go test, go vet to verify zero regressions. Grep for orphaned references to deleted symbols.
    status: completed
isProject: false
---

# Phase 3: Header Simplification -- Delete lineCountingWriter and Subject Update Mechanism

## Architectural Discovery (Plan Divergence from T01)

The T01 plan's Phase 3 description ("Move session header into View()") is **not viable** because Bubbletea's `View()` renders at the bottom of output, while `Println()` commits content above it. Putting the header in `View()` would invert the display order. The header is committed top-of-session content -- it should stay that way.

**Revised approach:** Keep the header as committed content rendered before Bubbletea starts. Omit the Subject field when unknown (new sessions). Show it when available (session resume). Delete all ANSI cursor math.

## Decision: Subject Field Handling

- **New sessions** (`run_agent_exec.go`): Header renders WITHOUT Subject line. No placeholder dash. No in-place update.
- **Session resume** (`run_session.go`): Header renders WITH Subject (already resolved from backend). No change needed.
- **Future option**: The `lineCountingWriter` approach can be reintroduced later as a small contained hack if in-place subject update is desired.

## What Gets Deleted

All of these exist solely to support the in-place subject update:

- `lineCountingWriter` struct + `Write()` + `Unwrap()`
- `subjectUpdater` struct + `UpdateSubject()`
- `setupSubjectUpdater()` function
- `renderSubjectPanelRow()` function
- `subjectLineOffset()` function
- `pollSessionSubject()` function
- Constants: `subjectPollInterval`, `subjectPollMaxTries`, `subjectPlaceholder`, `maxCursorBackLines`
- All ANSI escape sequences: `\033[s`, `\033[u`, `\033[%dA`, `\033[2K`

## What Gets Kept

- `renderSessionHeader()` in [run_stream_inline_header.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_header.go) -- unchanged, already handles empty Subject gracefully (skips the line)
- `formatSessionHeaderContent()`, `formatHeaderRow()`, `workspaceNames()` -- reused as-is
- `sessionHeaderInfo` struct -- unchanged

## Files Changed

### 1. [run_agent_exec.go](client-apps/cli/cmd/stigmer/root/run_agent_exec.go) (lines 267-294)

**Current flow (lines 267-294):**

```go
headerInfo := sessionHeaderInfo{
    AgentName:  input.Agent.GetMetadata().GetName(),
    SessionID:  sessionID,
    Subject:    subjectPlaceholder,  // ← remove this
    Model:      input.Model,
    Workspaces: workspaceNames(input.WorkspaceEntries),
}
renderSessionHeader(os.Stderr, headerInfo)

dataW, statusW, updater := setupSubjectUpdater(os.Stdout, os.Stderr, headerInfo)  // ← delete
if sessionID != "" && updater != nil {                                              // ← delete
    pollCtx, pollCancel := context.WithCancel(context.Background())                 // ← delete
    defer pollCancel()                                                              // ← delete
    go pollSessionSubject(pollCtx, input.Conn, sessionID, updater)                  // ← delete
}                                                                                   // ← delete

// ... streamAgentExecution(..., dataW, statusW)  →  streamAgentExecution(..., os.Stdout, os.Stderr)
```

**After:**

```go
headerInfo := sessionHeaderInfo{
    AgentName:  input.Agent.GetMetadata().GetName(),
    SessionID:  sessionID,
    Model:      input.Model,
    Workspaces: workspaceNames(input.WorkspaceEntries),
}
renderSessionHeader(os.Stderr, headerInfo)

// ... streamAgentExecution(..., os.Stdout, os.Stderr)
```

Changes:

- Remove `Subject: subjectPlaceholder` from headerInfo
- Delete `setupSubjectUpdater` call and writer wrapping
- Delete `pollSessionSubject` goroutine and its context
- Pass raw `os.Stdout, os.Stderr` to `streamAgentExecution`

### 2. [run_stream_inline_header_update.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_header_update.go) -- DELETE ENTIRE FILE

The entire file (subjectUpdater, lineCountingWriter, setupSubjectUpdater, pollSessionSubject, renderSubjectPanelRow, subjectLineOffset, all constants) exists solely for the in-place subject update. Delete it.

### 3. [run_stream_inline_header_update_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_header_update_test.go) -- DELETE ENTIRE FILE

All 11 tests in this file test deleted code (subjectLineOffset, lineCountingWriter, renderSubjectPanelRow, setupSubjectUpdater, subjectUpdater). Delete it.

### 4. [run_session.go](client-apps/cli/cmd/stigmer/root/run_session.go) -- NO CHANGES

Already passes a resolved subject and raw `os.Stdout, os.Stderr`. No subject updater. No writer wrapping. Untouched.

### 5. [run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go) -- NO CHANGES

`streamAgentInline` already receives `dataW, statusW` as parameters. It doesn't care whether they're wrapped or raw. No change needed.

### 6. Unused import cleanup in `run_agent_exec.go`

After removing `setupSubjectUpdater` and `pollSessionSubject`, check for and remove any now-unused imports (likely `context` if no other usage, `sync/atomic` transitively through deleted file).

## Verification

- Run `go build ./...` to confirm compilation
- Run `go test ./client-apps/cli/cmd/stigmer/root/...` to confirm all remaining tests pass
- Run `go vet ./...` for static analysis
- Verify `run_session.go` path (session resume with resolved subject) is completely unaffected
- Grep for any remaining references to deleted symbols: `lineCountingWriter`, `subjectUpdater`, `setupSubjectUpdater`, `pollSessionSubject`, `subjectPlaceholder`, `subjectLineOffset`, `renderSubjectPanelRow`

## Risk Assessment

- **Blast radius: Very small.** Only `run_agent_exec.go` has a logic change (6 lines removed, 1 field removed from struct literal). Everything else is pure deletion.
- **UX change: Minimal.** The "Subject: --" placeholder disappears from new session headers. Subject appears on session resume as before.
- **No Bubbletea model changes.** The `inlineBubbleModel`, `View()`, spinner -- all untouched.
- **No event loop changes.** `renderInline`, `handleEvent`, `statusf` -- all untouched.

