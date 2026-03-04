# Task T01: CLI/TUI UX Hardening — Full Gap Fix Plan

**Created**: 2026-03-03
**Updated**: 2026-03-03 (integrated deep research findings)
**Status**: PENDING REVIEW

## Context

A thorough audit of the CLI/TUI codebase identified 17 gaps across error handling,
approval flows, stream resilience, terminal degradation, and UX polish. A deep
research report on industry patterns (Claude Code, Codex CLI, Copilot CLI, Aider,
Open Interpreter, Warp, Cursor CLI) surfaced 11 additional improvements derived
from best-in-class practices. This plan organizes all items into 5 implementation
phases, ordered by severity and dependency chain.

**Research reference**: `research.cli-tui-conversational-patterns/04.report.gpt.md`

### Files in Scope

| Package | Key Files |
|---------|-----------|
| `cmd/stigmer/root/` | `run_stream_events.go`, `run_stream_snapshot.go`, `run_session.go`, `run_stream.go`, `run_stream_approval.go`, `run_resolve.go`, `run_display.go`, `run_display_stream.go`, `run_agent_exec.go`, `draft_handler.go`, `discover.go` |
| `pkg/executiontui/` | `model.go`, `update.go`, `handle_events.go`, `events.go`, `view.go`, `approval.go`, `blocks.go`, `input.go`, `followup.go`, `render_blocks.go` |
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

### 1.4 Emergency Terminal Restore on Crash (Research #H)

**Problem**: If the TUI panics or receives SIGTERM/SIGHUP, the alt-screen
terminal state is not restored, leaving the user with a broken terminal.
Claude Code had real user complaints about exactly this class of bug.

**Fix**:
- Register a `defer` recovery handler around `tea.NewProgram().Run()` that
  restores terminal state on panic.
- Register signal handlers for `SIGTERM` and `SIGHUP` that send `tea.Quit`
  to gracefully tear down alt-screen before exit.
- Add a `stigmer reset-terminal` escape hatch command that restores terminal
  settings (calls `stty sane` equivalent) for when all else fails.

**Files**: `run_stream.go`, `run_session.go`, new `cmd/stigmer/root/reset_terminal.go`

### 1.5 Esc as Cancel Shortcut (Research #F)

**Problem**: Cancel requires pressing `c` then confirming with `y`. Codex CLI
and Copilot CLI use `Esc` to stop a running operation — the universally
expected "stop" key.

**Fix**:
- Map `Esc` to the same cancel-confirm flow as `c` when the execution is
  running (i.e., not during input active or approval).
- When input is active, `Esc` already exits — no change needed there.

**Files**: `pkg/executiontui/update.go`

---

## Phase 2: High — Error Handling, Progress & Output Modes

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

### 2.2 Two-Lane Output Design (Gap #5 + Research #C)

**Problem**: TUI always launches in alt-screen mode. Piped or dumb terminals
get garbled output. No structured output for scripting/CI.

**Industry pattern**: Codex CLI has `--no-alt-screen` and non-interactive mode.
Cursor CLI documents structured JSON output. Claude Code has `--output-format
stream-json`. This "two-lane" design (interactive TUI + structured stream) is
the industry standard.

**Fix**:
- **Lane 1 (Interactive)**: Current alt-screen TUI (default when TTY detected).
- **Lane 2 (Non-interactive)**: Fall back to existing `messageStreamRenderer`
  when stdout is not a TTY or `TERM=dumb`.
- Add `--no-alt-screen` flag: renders inline, preserves terminal scrollback
  (uses the non-TUI renderer but with colors enabled).
- Add `--output json` flag: emit events as newline-delimited JSON for scripting.
  Each line is a self-contained event object with type, timestamp, and payload.
- Disable colors automatically when piped (`NO_COLOR` env var support).

**Files**: `run_stream.go`, `run_session.go`, new `run_output_json.go`
**Tests**: Integration test with `TERM=dumb`, test with `| cat`.

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

### 2.5 `stigmer doctor` Diagnostic Command (Research #G)

**Problem**: When things go wrong, users have no self-service diagnostic tool.
Errors dump raw gRPC internals instead of guiding the user. Claude Code provides
`/status` and `/doctor` as first-class diagnostic surfaces.

**Fix**:
- New `stigmer doctor` command that checks and reports:
  - Server connectivity (gRPC dial + health check)
  - Authentication status (token valid/expired)
  - Organization context (set/not set, org name)
  - Agent availability (can list agents)
  - MCP server health (for `discover` flows)
  - Terminal capabilities (TTY, color support, dimensions)
- Output as a checklist with ✓/✗ per item and actionable fix suggestions.

**Files**: new `cmd/stigmer/root/doctor.go`

---

## Phase 3: Medium — UX Discipline, Approval Upgrades & Correctness

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

### 3.2 Sub-agent: Activity Indicator + Permission Context (Gap #9 + Research #E)

**Problem**: Collapsed sub-agent blocks show no activity and no permission info.
Claude Code warns that subagents inherit permission modes; users need to see
which agent is acting and under what policy.

**Fix**:
- In `updateSubAgentHeader`: when the sub-agent is running and has
  `toolCount > 0`, append a running indicator to the preview line
  (e.g., "⚙ 3 tools" that updates as tools are added).
- On completion, update to "✓ 5 tools" or "✗ failed".
- Add permission context to the sub-agent header: "Sub-agent: researcher
  (inherits approval policy)" — sourced from the sub-agent execution metadata.
- Auto-expand sub-agent header on failure; keep collapsed on success (Copilot
  CLI pattern: "brief summaries on success, full output on failure").

**Files**: `pkg/executiontui/render_blocks.go`, `handle_events.go`

### 3.3 "Approve for Session" + "Deny with Redirect" (Research #A)

**Problem**: Approval options are limited to approve/skip/reject. Copilot CLI
offers "Yes, and approve TOOL for the rest of the session" (reduces approval
fatigue) and "No, and tell Copilot what to do differently" (denial without
dead-end).

**Fix**:
- Add `A` key: "Approve this tool for the rest of the session." Track approved
  tool names in a `sessionApproved map[string]bool` on the model. When future
  `ApprovalNeededEvent` arrives for a session-approved tool, auto-approve via
  the approval channel without showing the prompt.
- On `r` (reject): instead of just sending reject, activate the input composer
  so the user can type corrective instructions. The rejection comment becomes
  the user's message. This requires the execution to support "reject with
  feedback" on the backend, or we queue the feedback as a follow-up message
  after the rejection.
- Update footer hints: `[a] approve  [A] approve for session  [s] skip
  [r] reject & redirect  [q] detach`

**Files**: `pkg/executiontui/approval.go`, `view.go` (footer), `handle_events.go`,
`model.go` (add `sessionApproved` map)

### 3.4 "Expand on Failure, Collapse on Success" Heuristic (Research #D)

**Problem**: Tool blocks start collapsed regardless of outcome. Aider's `/test`
only surfaces output on failure. Copilot CLI gives "brief summaries on success,
full output on failure."

**Fix**:
- In `updateToolBadge`: when a tool transitions to "failed" status, set
  `expanded = true` on the block so the error is immediately visible.
- Keep "completed" tools collapsed (current behavior).
- For sub-agent header blocks: auto-expand on failure, keep collapsed on
  success (handled in 3.2).

**Files**: `pkg/executiontui/handle_events.go`

### 3.5 --dry-run for Draft Commands (Gap #10)

**Problem**: `draft` creates an execution immediately with no preview.

**Fix**:
- Add `--dry-run` flag to `draftOptions`.
- When set, resolve the agent, display the execution plan (agent name,
  message, attachments, model, runtime env), and exit without creating
  an execution.
- Print to stderr with a clear "DRY RUN — no execution created" banner.

**Files**: `draft_handler.go`, `draft.go`

### 3.6 Terminal Bell on Approval Events (Research #I)

**Problem**: When a user is in another terminal tab, they have no notification
that the agent is waiting for approval. Aider supports terminal bell; Claude
Code has notification hooks.

**Fix**:
- When `ApprovalNeededEvent` is handled in the TUI, emit `\a` (BEL character)
  to trigger the terminal bell / OS notification.
- Make configurable: `stigmer config set notifications.bell true/false`
  (default: true).
- Also emit bell when the input composer activates (execution done, user's
  turn) — helps with long-running agents where the user has switched context.

**Files**: `pkg/executiontui/handle_events.go`, `internal/cli/config/`

### 3.7 Follow-up Todo Block Index Reset (Gap #11)

**Problem**: `handleFollowUpStarted` doesn't reset `todoBlockIdx`. Stale index
may point to wrong block after appending more blocks.

**Fix**:
- In `followup.go` → `handleFollowUpStarted`: add `m.todoBlockIdx = -1`.
- Verify that `approvalBlockIdx` is also reset (it should be).

**Files**: `pkg/executiontui/followup.go`
**Tests**: `update_test.go` — test follow-up with previous todo.

### 3.8 Duplicate Code in connectToBackend (Gap #12)

**Problem**: `resolveOrgID` is called twice in `connectToBackend`.

**Fix**: Remove the duplicate block.

**Files**: `run_resolve.go`

### 3.9 Remove Orphaned Pre-TUI Approval Functions (Gap #13)

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

### 4.3 Discover Command Error Improvements (Gap #17)

**Problem**: Discover errors are generic wrapped messages.

**Fix**:
- In `internal/cli/mcpserver/discover.go` (or wherever Discover is
  implemented), distinguish between:
  - "MCP server not found" → suggest `stigmer list mcp-servers`
  - "Process crashed" → show last stderr line
  - "Connection timeout" → suggest `--timeout 60s`
  - "Missing env var" → show which var and how to set it

**Files**: `internal/cli/mcpserver/` (discover implementation)

### 4.4 Tiered Approval Policies (Research #B)

**Problem**: `--auto-approve` is all-or-nothing. Claude Code has three tiers
(read=no approval, bash=prompt, file-write=session-scoped). Codex CLI pairs
approval policies with sandbox policies. Copilot CLI supports `--allow-tool`
with pattern matching like `shell(git push)`.

**Fix**:
- Replace `--auto-approve` with a tiered system:
  - `--approve-reads` (auto-approve read-only tools like file reads, searches)
  - `--approve-tool <pattern>` (auto-approve specific tools, repeatable flag,
    supports glob patterns like `shell(git *)`)
  - `--approve-all` (the current nuclear option, with explicit warning banner)
- Default: read tools auto-approved, write tools prompt, shell commands always
  prompt (unless `--approve-tool shell(*)` is set).
- Maintain backward compatibility: `--auto-approve` maps to `--approve-all`
  with a deprecation warning.

**Files**: `run_agent_exec.go`, `draft_handler.go`, `pkg/approval/policy.go` (new),
`run_stream_events.go` (policy check before emitting ApprovalNeededEvent)

---

## Phase 5: Future — Sophistication & Feature Parity

Items that bring us to feature parity with Claude Code / Codex CLI. These are
valuable but not urgent — implement after Phases 1-4 are solid.

### 5.1 Slash Commands in TUI (`/status`, `/diff`, `/help`)

**Industry pattern**: Claude Code provides `/diff`, `/status`, `/config`,
`/resume` as in-session commands. Codex CLI has `/theme`. Aider has extensive
slash commands (`/diff`, `/undo`, `/run`, `/test`).

**Fix**:
- When input is active, detect lines starting with `/` and route to a
  command handler instead of sending as a follow-up message.
- Initial commands:
  - `/status` — show session ID, execution ID, server connection, phase, elapsed
  - `/help` — show available commands and key bindings
  - `/verbose` — toggle verbose mode (show execution IDs and phase transitions)
- Future commands:
  - `/diff` — show files modified across the session
  - `/artifacts` — list downloadable artifacts

**Files**: `pkg/executiontui/input.go`, new `pkg/executiontui/commands.go`

### 5.2 Session Picker for `stigmer run` Without Args

**Industry pattern**: Claude Code has a session picker with preview, rename,
search, and repo/branch scoping. Codex CLI has `codex cloud` for task browsing.

**Fix**:
- When `stigmer run` is invoked with no args, show an interactive session
  picker listing recent sessions (subject, last activity, phase).
- Use Bubbletea list component for the picker.
- Support filtering by status (running, completed, failed).

**Files**: new `cmd/stigmer/root/run_picker.go`

### 5.3 Mid-Run Message Injection

**Industry pattern**: Codex CLI lets you press Enter to inject instructions
mid-run or Tab to queue a follow-up. Copilot CLI lets you send follow-ups
while the agent is thinking.

**Fix**:
- Allow the user to type while the agent is working. Queue the message and
  inject it as a follow-up when the agent reaches a natural pause point
  (completion or approval).
- Requires backend support for message injection into active executions.

**Files**: `pkg/executiontui/input.go`, backend API changes (out of scope for CLI-only)

---

## Implementation Order

```
Phase 1 (Critical)     ←── START HERE
  1.1 Approval on resume
  1.2 Channel deadlock
  1.3 Dead connection detection
  1.4 Emergency terminal restore            [NEW from research]
  1.5 Esc as cancel shortcut                [NEW from research]

Phase 2 (High)
  2.1 Error handler overhaul
  2.2 Two-lane output design                [UPGRADED from research]
  2.3 Approval retry
  2.4 Preparation spinner
  2.5 stigmer doctor command                [NEW from research]

Phase 3 (Medium)
  3.1 stdout/stderr separation
  3.2 Sub-agent indicator + permissions     [UPGRADED from research]
  3.3 Approve-for-session + deny-redirect   [NEW from research]
  3.4 Expand-on-failure heuristic           [NEW from research]
  3.5 Draft --dry-run
  3.6 Terminal bell on approval             [NEW from research]
  3.7 Follow-up todo index reset
  3.8 Duplicate code cleanup
  3.9 Orphaned function removal

Phase 4 (Low)
  4.1 Session pagination
  4.2 Viewport optimization
  4.3 Discover error improvements
  4.4 Tiered approval policies              [NEW from research]

Phase 5 (Future)
  5.1 Slash commands in TUI                 [NEW from research]
  5.2 Session picker                        [NEW from research]
  5.3 Mid-run message injection             [NEW from research]
```

## Success Criteria (measurable)

1. `snapshotToEvents` with `pending_approvals` → `ApprovalNeededEvent` emitted (unit test)
2. `emitAndWaitApproval` with full channel → no deadlock (unit test with timeout)
3. Stream with 60s inactivity → `StreamErrorEvent` emitted (unit test)
4. Panic during TUI → terminal state restored (manual test)
5. `clierr.Handle` covers all 13 gRPC codes with actionable messages (unit test)
6. `TERM=dumb stigmer run agent x` → no alt-screen, readable output (manual test)
7. `stigmer run agent x --output json | jq` → valid NDJSON events (manual test)
8. Approval submit failure → 3 retries with backoff (unit test)
9. All non-TUI status output goes to stderr (test captures)
10. Exit codes: 1=general, 2=usage, 3=connection, 4=auth, 5=not-found (unit test)
11. `A` key in approval → tool auto-approved for rest of session (unit test)
12. Failed tool block → auto-expanded (unit test)
13. `stigmer doctor` → checklist with pass/fail per item (manual test)
14. Terminal bell emitted on approval event (manual test)

## Estimated Effort per Phase

| Phase | Scope | Estimated Effort |
|-------|-------|-----------------|
| Phase 1 | 5 items, ~5 files | 1-2 sessions |
| Phase 2 | 5 items, ~7 files | 2-3 sessions |
| Phase 3 | 9 items, ~10 files | 2-3 sessions |
| Phase 4 | 4 items, ~6 files | 1-2 sessions |
| Phase 5 | 3 items, ~4 files | 2-3 sessions (future) |

---

**PENDING REVIEW** — Please review and provide feedback before execution begins.
