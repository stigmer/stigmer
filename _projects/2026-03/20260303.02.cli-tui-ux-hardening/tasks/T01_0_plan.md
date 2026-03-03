# Task T01: CLI/TUI UX Hardening — Full Gap Fix Plan

**Created**: 2026-03-03
**Status**: PENDING REVIEW

## Context

A thorough audit of the CLI/TUI codebase identified 17 gaps across error handling,
approval flows, stream resilience, terminal degradation, and UX polish. This plan
organizes them into 5 implementation phases, ordered by severity and dependency chain.

### Files in Scope

| Package | Key Files |
|---------|-----------|
| `cmd/stigmer/root/` | `run_stream_events.go`, `run_stream_snapshot.go`, `run_session.go`, `run_stream.go`, `run_stream_approval.go`, `run_resolve.go`, `run_display.go`, `run_display_stream.go`, `run_agent_exec.go`, `draft_handler.go`, `discover.go` |
| `pkg/executiontui/` | `model.go`, `update.go`, `handle_events.go`, `events.go`, `view.go`, `approval.go`, `blocks.go`, `input.go`, `followup.go` |
| `internal/cli/clierr/` | `clierr.go` |
| `pkg/approval/` | `types.go`, `prompter.go`, `interactive.go` |

---

## Phase 1: Critical — Approval & Concurrency Fixes

These are show-stoppers that leave users stuck or frozen.

### 1.1 Approval Not Surfaced on Resume (Gap #1)

**Problem**: `snapshotToEvents()` emits `ToolWaitingApprovalEvent` (badge only)
but never `ApprovalNeededEvent` (interactive prompt). When a user re-attaches to
an execution that's still `WAITING_FOR_APPROVAL` via the snapshot path, they see
⏸ but cannot respond.

**Fix**:
- In `run_stream_snapshot.go` → `emitSnapshotEvents()`: after emitting all
  content events, check `exec.Status.GetPendingApprovals()`. If non-empty AND
  the execution is in a live phase, emit `ApprovalNeededEvent` for each entry.
- Guard: only for `emitDone == true` (final execution in the sequence) to avoid
  prompting for historical executions.

**Files**: `run_stream_snapshot.go`
**Tests**: `run_stream_snapshot_test.go` — add test case for snapshot with pending approvals.

### 1.2 Approval Channel Deadlock Potential (Gap #2)

**Problem**: `streamToEvents` sends `ApprovalNeededEvent` to a buffered(16) events
channel, then blocks on `approvalResponses`. If the events channel is full (rapid
tool call bursts), the goroutine blocks on the send and never reaches the approval
receive — deadlock.

**Fix**:
- Increase the events channel buffer from 16 to 64 (reduces probability).
- Use a `select` with `ctx.Done()` when sending the `ApprovalNeededEvent` in
  `emitAndWaitApproval` so the goroutine is cancellable even when blocked.
- Add a timeout (30s) on the `approvalResponses` receive to prevent permanent
  hangs. On timeout, emit a `StreamErrorEvent` explaining the approval timed out.

**Files**: `run_stream.go` (channel creation), `run_stream_events.go` (emitAndWaitApproval)
**Tests**: `run_stream_events_test.go` — add test with full channel.

### 1.3 Dead Stream Connection Detection (Gap #3)

**Problem**: `stream.Recv()` blocks with `context.Background()` — no timeout,
no keepalive. Silent backend death causes the TUI to hang forever.

**Fix**:
- Add a gRPC keepalive configuration on the client connection:
  `keepalive.ClientParameters{Time: 10s, Timeout: 5s, PermitWithoutStream: true}`.
- In `streamToEvents`, wrap `stream.Recv()` with a context deadline per
  iteration: 60-second inactivity timeout. On timeout, emit a `StreamErrorEvent`
  with actionable message: "Lost connection to server. Re-attach with:
  `stigmer run ses-XXX`".
- In the TUI `handleActivityTick`: after 30 seconds of idle during `in_progress`
  (3x the normal idle threshold), show a warning in the footer:
  "⚠ No updates for 30s — connection may be stale".

**Files**: `run_stream_events.go`, `run_stream.go`, `pkg/executiontui/update.go`, backend connection setup
**Tests**: `run_stream_events_test.go` — test timeout behavior.

---

## Phase 2: High — Error Handling & Progress

These cause confusion and make the CLI feel unpolished.

### 2.1 Comprehensive Error Handler (Gap #4)

**Problem**: `clierr.Handle()` only covers 4 gRPC codes. All other errors dump
raw messages. Exit code is always 1.

**Fix**:
- Add handlers for: `PermissionDenied` (→ "check permissions or re-login"),
  `DeadlineExceeded` (→ "operation timed out, retry or check server"),
  `ResourceExhausted` (→ "rate limit hit, try again later"),
  `FailedPrecondition` (→ show message + suggest checking prereqs),
  `AlreadyExists` (→ "resource already exists"),
  `Internal` (→ "internal error, check server logs"),
  `Aborted` (→ "operation was aborted, retry").
- Introduce exit code constants: 1=general, 2=usage, 3=connection, 4=auth, 5=not-found.
- Add a `--debug` global flag that shows the full error chain when set.

**Files**: `internal/cli/clierr/clierr.go` (new: `clierr/codes.go`)
**Tests**: `clierr_test.go`

### 2.2 Terminal Capability Detection (Gap #5)

**Problem**: TUI always launches in alt-screen mode. Piped or dumb terminals
get garbled output.

**Fix**:
- Before launching `tea.NewProgram`, check `display.IsTerminal()` and `TERM`
  env var. If non-interactive or `TERM=dumb`:
  - Skip alt-screen TUI.
  - Fall back to the existing non-TUI `messageStreamRenderer` for streaming
    (it already exists in `run_display_stream.go`).
  - Disable colors via `lipgloss.SetHasDarkBackground(false)` or equivalent.
- Ensure the fallback path handles approvals via the existing
  `InteractivePrompter` (which already has non-interactive mode).

**Files**: `run_stream.go`, `run_session.go`
**Tests**: Integration test with `TERM=dumb`.

### 2.3 Retry on Approval Submission Failure (Gap #6)

**Problem**: Single-attempt approval submission. On failure, the user's decision
is lost and the execution stays stuck.

**Fix**:
- In `emitAndWaitApproval`: wrap `submitAgentApproval` in a retry loop
  (max 3 attempts, 1s/2s/4s backoff).
- On final failure, emit a recoverable `StreamErrorEvent` with message:
  "Failed to submit approval after 3 attempts. Re-attach to retry:
  `stigmer run ses-XXX`".

**Files**: `run_stream_events.go`
**Tests**: `run_stream_events_test.go`

### 2.4 Preparation Phase Spinner (Gap #7)

**Problem**: Between `stigmer run agent ...` and the TUI appearing, there's
no feedback during backend connection, agent resolution, and attachment processing.

**Fix**:
- In `prepareAgentExec`: show a spinner ("Connecting to server...") using
  the existing `pkg/spinner` package.
- In `executeResolvedAgent`: update spinner text as each step completes
  ("Resolving agent...", "Processing attachments...", "Creating session...").
- Stop spinner just before `tea.NewProgram` starts.

**Files**: `run_agent_exec.go`

---

## Phase 3: Medium — UX Discipline & Correctness

### 3.1 stdout/stderr Separation (Gap #8)

**Problem**: Non-TUI display functions write status/feedback to stdout instead
of stderr.

**Fix**:
- Audit all `fmt.Printf`/`fmt.Println` in `run_display.go`,
  `run_display_stream.go`, `run_display_approval.go`.
- Status messages → `fmt.Fprintf(os.Stderr, ...)`.
- Data output (JSON, structured results) → stdout.
- The `messageStreamRenderer` already takes an `io.Writer` — pass
  `os.Stderr` for status, keep `os.Stdout` for data.

**Files**: `run_display.go`, `run_display_stream.go`, `run_display_approval.go`
**Tests**: Capture stderr/stdout separately in tests.

### 3.2 Sub-agent Activity Indicator on Collapsed Header (Gap #9)

**Problem**: Collapsed sub-agent blocks show no activity.

**Fix**:
- In `updateSubAgentHeader`: when the sub-agent is running and has
  `toolCount > 0`, append a running indicator to the preview line
  (e.g., "⚙ 3 tools" that updates as tools are added).
- On completion, update to "✓ 5 tools" or "✗ failed".
- Already partially done — just needs the dynamic tool count to render
  in collapsed state (the data is tracked in `subAgentMeta`).

**Files**: `pkg/executiontui/render_blocks.go`, `handle_events.go`

### 3.3 --dry-run for Draft Commands (Gap #10)

**Problem**: `draft` creates an execution immediately with no preview.

**Fix**:
- Add `--dry-run` flag to `draftOptions`.
- When set, resolve the agent, display the execution plan (agent name,
  message, attachments, model, runtime env), and exit without creating
  an execution.
- Print to stderr with a clear "DRY RUN — no execution created" banner.

**Files**: `draft_handler.go`, `draft.go`

### 3.4 Follow-up Todo Block Index Reset (Gap #11)

**Problem**: `handleFollowUpStarted` doesn't reset `todoBlockIdx`. Stale index
may point to wrong block after appending more blocks.

**Fix**:
- In `followup.go` → `handleFollowUpStarted`: add `m.todoBlockIdx = -1`.
- Verify that `approvalBlockIdx` is also reset (it should be).

**Files**: `pkg/executiontui/followup.go`
**Tests**: `update_test.go` — test follow-up with previous todo.

### 3.5 Duplicate Code in connectToBackend (Gap #12)

**Problem**: `resolveOrgID` is called twice in `connectToBackend`.

**Fix**: Remove the duplicate block.

**Files**: `run_resolve.go`

### 3.6 Remove Orphaned Pre-TUI Approval Functions (Gap #13)

**Problem**: `run_stream_approval.go` contains orphaned functions from the
pre-TUI approval flow that are no longer called.

**Fix**:
- Verify via `grep` that `needsAgentApprovalPrompt`, `findUnpromptedApproval`,
  `countUnresolvedApprovals`, `handleToolCallApproval` are not referenced.
- If confirmed orphaned, remove them.
- Keep `handleAgentApprovalPrompt`, `handleWorkflowApprovalPrompt`,
  `buildPromptOptions`, `buildPendingApprovalFromToolCall` only if they
  are used by the workflow streaming path (non-TUI).

**Files**: `run_stream_approval.go`
**Tests**: Ensure existing tests still pass.

---

## Phase 4: Low — Polish & Hardening

### 4.1 Pagination for Long Session History (Gap #14)

**Problem**: `resumeSession` loads all executions into memory.

**Fix**:
- For sessions with > 10 executions, only load the last 10 for display.
- Add a system block at the top: "Showing last 10 of N executions.
  Use `stigmer get session ses-XXX` for full history."

**Files**: `run_session.go`

### 4.2 Viewport Rebuild Optimization (Gap #15)

**Problem**: `rebuildViewportContent` walks all blocks on every refresh.

**Fix**:
- Track a `dirty` flag. Only rebuild when blocks are added/modified.
- For spinner ticks (thinking indicator), append the indicator without
  rebuilding the full block list.

**Files**: `pkg/executiontui/handle_events.go`, `render_blocks.go`

### 4.3 Signal Handling (Gap #16)

**Problem**: No `SIGTERM`/`SIGHUP` handlers; alt-screen may not be restored.

**Fix**:
- Bubbletea handles `SIGINT` internally. For `SIGTERM` and `SIGHUP`,
  register a signal handler that sends `tea.Quit` to the program.
- This ensures the alt-screen is properly torn down.

**Files**: `run_stream.go`, `run_session.go`

### 4.4 Discover Command Error Improvements (Gap #17)

**Problem**: Discover errors are generic wrapped messages.

**Fix**:
- In `internal/cli/mcpserver/discover.go` (or wherever Discover is
  implemented), distinguish between:
  - "MCP server not found" → suggest `stigmer list mcp-servers`
  - "Process crashed" → show last stderr line
  - "Connection timeout" → suggest `--timeout 60s`
  - "Missing env var" → show which var and how to set it

**Files**: `internal/cli/mcpserver/` (discover implementation)

---

## Implementation Order

```
Phase 1 (Critical)     ←── START HERE
  1.1 Approval on resume
  1.2 Channel deadlock
  1.3 Dead connection detection

Phase 2 (High)
  2.1 Error handler overhaul
  2.2 Terminal degradation
  2.3 Approval retry
  2.4 Preparation spinner

Phase 3 (Medium)
  3.1 stdout/stderr
  3.2 Sub-agent indicator
  3.3 Draft --dry-run
  3.4 Todo index reset
  3.5 Duplicate code
  3.6 Orphaned functions

Phase 4 (Low)
  4.1 Session pagination
  4.2 Viewport optimization
  4.3 Signal handling
  4.4 Discover errors
```

## Success Criteria (measurable)

1. `snapshotToEvents` with `pending_approvals` → `ApprovalNeededEvent` emitted (unit test)
2. `emitAndWaitApproval` with full channel → no deadlock (unit test with timeout)
3. Stream with 60s inactivity → `StreamErrorEvent` emitted (unit test)
4. `clierr.Handle` covers all 13 gRPC codes with actionable messages (unit test)
5. `TERM=dumb stigmer run agent x` → no alt-screen, readable output (manual test)
6. Approval submit failure → 3 retries with backoff (unit test)
7. All non-TUI status output goes to stderr (test captures)
8. Exit codes: 1=general, 2=usage, 3=connection, 4=auth, 5=not-found (unit test)

## Estimated Effort per Phase

| Phase | Scope | Estimated Effort |
|-------|-------|-----------------|
| Phase 1 | 3 gaps, ~4 files | 1 session |
| Phase 2 | 4 gaps, ~5 files | 1-2 sessions |
| Phase 3 | 6 gaps, ~8 files | 1-2 sessions |
| Phase 4 | 4 gaps, ~5 files | 1 session |

---

**PENDING REVIEW** — Please review and provide feedback before execution begins.
