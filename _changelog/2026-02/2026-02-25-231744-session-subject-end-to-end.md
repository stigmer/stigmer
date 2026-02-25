# Session Subject: End-to-End Fix — Sentinel Normalization, Live TUI Updates, and Backend Activity Wiring

**Date**: February 25, 2026

## Summary

The session subject feature had three compounding failures that made it completely invisible to users: the backend sentinel leaked verbatim into every display surface, the TUI never re-checked the subject after startup, and — the root cause — the Go workflow never called the subject-generation activity at all. This change fixes all three layers coherently: normalizing the sentinel in the CLI, adding live in-place header updates via bounded backoff polling, and wiring the missing `GenerateSessionSubject` activity step into the Go Temporal workflow.

## Problem Statement

Sessions are auto-created with `Subject: "Auto-created session"` as a sentinel value. A Temporal activity (`GenerateSessionSubject`) is supposed to replace this asynchronously with an LLM-generated title derived from the user's first message. Users expected to see a meaningful subject in `stigmer list sessions` and in the TUI alt-screen header.

### Pain Points

- `stigmer list sessions` showed `Auto-created session` verbatim as the subject for every session — a backend implementation detail exposed as a user-visible label
- `stigmer run ses-xxx` inline print line showed `Session: ses-xxx (Auto-created session)`, also exposing the sentinel
- The TUI alt-screen header showed `Session: Auto-created session` on re-attach/resume paths (because `openSession` passed the raw subject without filtering)
- Even after fixing the display: the TUI was a one-time snapshot — it captured the subject at startup and never updated. If the backend generated a real title 3 seconds later, the header stayed wrong for the entire session
- Underlying all of this: the Go workflow (`invoke_workflow_impl.go`) never called `GenerateSessionSubject`. The activity was registered in the Python worker and fully implemented, but never invoked — the step existed only in the Java (`stigmer-cloud`) workflow, not the OSS Go workflow. Subject generation never ran

## Solution

The fix is three-layered, addressing the display, the reactivity, and the root cause in order.

**Layer 1 — Sentinel normalization in the CLI display layer.** A single `ResolvedSubject()` helper in the `session` package converts the sentinel to an empty string before it touches any display or TUI path. All display surfaces call through this helper, so the sentinel is never rendered.

**Layer 2 — Live in-place TUI header update.** A new `SubjectFetchFn func() string` field on the TUI `Config` enables bounded background polling via the standard Bubbletea `tea.Cmd` pattern. The TUI fires an initial poll at t+3s and retries at t+8s and t+18s if the subject is still pending. When a real subject arrives, `Update()` writes it into `m.cfg.SessionSubject` and Bubbletea re-renders the header on the next frame — no additional state, no viewport flush needed.

**Layer 3 — Backend workflow fix.** The missing `GenerateSessionSubject` step is added to the Go Temporal workflow as Step 1.5, using `workflow.Go()` (Go's equivalent of Java's `Async.procedure()`). It fires concurrently with `ExecuteGraphton`, logs failures, and never propagates them.

## Implementation Details

### CLI: Sentinel Normalization

**`client-apps/cli/internal/cli/session/get.go`**
- Added `PendingSubject = "Auto-created session"` constant — single source of truth for the sentinel string in the CLI
- Added `ResolvedSubject(subject string) string` — returns empty string when subject is the sentinel, real subject otherwise
- All future callers normalize through this helper; a backend sentinel value change requires updating one line

**`client-apps/cli/internal/cli/session/display.go`**
- `displayListTable()`: resolves subject before truncating; shows `-` when empty (consistent with the `created` column convention)
- `displaySessionTable()`: applies `ResolvedSubject()` inside the existing `if subject != ""` guard — no behavioral change when subject is real

**`client-apps/cli/cmd/stigmer/root/run_session.go`**
- `openSession()`: `session.ResolvedSubject()` applied to the raw proto subject before the inline print line and before passing into `streamAgentExecution`/`resumeSession`

### CLI: Live TUI Header Update

**`client-apps/cli/pkg/executiontui/messages.go`**
- `subjectFetchBackoff = []time.Duration{5s, 10s}` — retry delays after the initial 3s poll (3 total attempts, ~18s total window)
- `subjectFetchedMsg{subject string}` — internal Bubbletea message carrying each poll result
- `scheduleSubjectFetch(delay, fn)` — returns a `tea.Cmd` that sleeps `delay` then calls `fn()` and wraps the result

**`client-apps/cli/pkg/executiontui/model.go`**
- `Config.SubjectFetchFn func() string` — caller-supplied closure; returns empty when subject is still pending, real subject when available; errors swallowed by caller
- `Model.subjectFetchAttempt int` — tracks retry count for bounded backoff
- `Init()` — schedules the first poll (t+3s) when there is a live events channel, a fetch function, and no subject yet

**`client-apps/cli/pkg/executiontui/update.go`**
- `handleSubjectFetched(msg)` — on non-empty subject: writes `m.cfg.SessionSubject`, Bubbletea renders the updated header immediately. On empty: schedules the next retry if attempts remain and execution is not done. All retries silently drop once execution reaches a terminal phase

**`client-apps/cli/cmd/stigmer/root/run_stream.go`**
- Added `session` import
- Constructs `SubjectFetchFn` closure (conditional on `sessionSubject == ""`): calls `session.GetFromBackend` and returns `session.ResolvedSubject()`

**`client-apps/cli/cmd/stigmer/root/run_session.go`**
- `resumeSession()`: same `SubjectFetchFn` closure pattern, wired into the TUI config

### Backend: Go Workflow Activity Step

**`backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities/generate_session_subject.go`** *(new)*
- `GenerateSessionSubjectActivity` interface with single `GenerateSessionSubject(executionID string) error` method
- `GenerateSessionSubjectActivityName = "GenerateSessionSubject"` — must match Python `@activity.defn(name=...)` exactly for polyglot routing
- `NewGenerateSessionSubjectActivityStub()` — creates the activity stub with 60s `StartToCloseTimeout`, 30s `ScheduleToStartTimeout`, and `MaximumAttempts: 1` (best-effort, matching Java policy)

**`backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go`**
- Step 1.5 added between `EnsureThread` (Step 1) and `ExecuteGraphton` (Step 2)
- Uses `workflow.Go(ctx, func(...) { ... })` — Go's analog of Java's `Async.procedure()`. Dispatches the activity concurrently; the `workflow.Go` goroutine runs in parallel with the main execution
- Failure is logged at `Warn` level and swallowed; never propagates to the main workflow

## Benefits

- Users see `-` in `stigmer list sessions` subject column for sessions without a generated title, instead of the sentinel string
- `stigmer run ses-xxx` print line no longer shows `(Auto-created session)` alongside the session ID
- TUI header starts as `Session: ses-xxx` (session ID fallback) and transitions in-place to `Session: Refactor auth module` (generated title) within seconds of execution start — without requiring user interaction or restart
- The backend activity now actually runs on every new execution in the OSS stack — the fundamental gap that made all prior display work irrelevant is closed
- `GenerateSessionSubject` activity will now be visible in the Temporal UI alongside `EnsureThread` and `ExecuteGraphton`

## Impact

- **CLI users**: `list sessions` output is clean; TUI header is meaningful from early in the execution lifecycle
- **Session management**: Sessions acquire human-readable titles automatically, making multi-session workflows easier to navigate
- **Backend observability**: The subject generation step is now tracked in Temporal, making failures visible rather than silent
- **Architecture**: `PendingSubject` / `ResolvedSubject()` establish a pattern for handling sentinel values at the boundary between backend storage and CLI display; future sentinel changes require one-line updates

## Related Work

- [TUI Header: Show Session Subject Instead of Raw ID](_changelog/2026-02/2026-02-25-222136-tui-session-subject-in-header.md) — prior work that added the subject-aware header rendering (display side); this change completes it end-to-end
- Session subject generation activity (`generate_session_subject.py`) — already implemented and registered; this change provides the missing workflow invocation
- Java workflow parity (`InvokeAgentExecutionWorkflowImpl.java`) — the Go workflow now matches the Java workflow's Step 1.5 fire-and-forget pattern

---

**Status**: ✅ Production Ready
