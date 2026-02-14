---
name: T02 Streaming-First Engine
overview: Refactor the CLI execution architecture so that gRPC streaming is the single, always-on execution path for both agent and workflow executions. Remove the `--follow` flag, fix the `draft skill` race condition, and make streaming functions return the final execution state so callers can use it for artifact downloads and result display.
todos:
  - id: t02-1-bugfix-terminal-phases
    content: Fix `isTerminalAgentPhase` and `isTerminalWorkflowPhase` to include `EXECUTION_TERMINATED`. Update tests in `run_display_test.go`.
    status: completed
  - id: t02-2-refactor-stream-signatures
    content: "Refactor `streamAgentExecutionLogs` and `streamWorkflowExecutionLogs` in `run_stream.go`: rename, return final state + error, inject prompter as parameter, proper error wrapping."
    status: completed
  - id: t02-3-simplify-handlers
    content: "Update `runAgent()` and `runWorkflow()` in `run_handlers.go`: remove follow/wait branching, add detach, always use streaming, use returned state for downloads."
    status: completed
  - id: t02-4-flag-changes
    content: "Update `run.go`: remove --follow/--wait flags, add --detach. Update `draft_skill.go`: remove --follow. Update help text and examples."
    status: completed
  - id: t02-5-fix-draft-skill-race
    content: "Rewrite `draft_skill_handler.go`: replace goroutine + polling with synchronous `streamAgentExecution()` call, use returned state for artifacts."
    status: completed
  - id: t02-6-verify-build-tests
    content: Run build and tests to verify everything compiles and passes. Fix any issues.
    status: completed
isProject: false
---

# T02: Streaming-First Execution Engine

## Codebase Analysis -- What I Found

After reading every relevant file, here is the actual state of things (some of this diverges from the T01 plan's framing):

### Current execution paths


| Command | Default behavior | `--no-follow` | `--wait`/`--download` |
| ------- | ---------------- | ------------- | --------------------- |


*Cannot use tables -- using lists instead:*

- `**stigmer run agent**`: `--follow` defaults to `true`. Calls `streamAgentExecutionLogs()` synchronously. Works correctly for streaming + approvals.
- `**stigmer run agent --no-follow**`: Fire-and-forget. Prints execution ID, exits.
- `**stigmer run agent --wait**` or `**--download**`: Uses `waitForExecution()` polling. NO streaming, NO approval handling. **This is broken** -- hangs forever if execution needs approval.
- `**stigmer run workflow**`: `--follow` defaults to `true`. Calls `streamWorkflowExecutionLogs()` synchronously. Works correctly.
- `**stigmer draft skill**`: `--follow` defaults to `false`. Without it: just polls via `waitForExecution()` (no streaming, no approvals -- **hangs on approvals**). With it: launches `go streamAgentExecutionLogs()` as a goroutine racing against foreground `waitForExecution()` -- **the race condition from T01**.

### Bugs discovered

1. `**isTerminalAgentPhase()` is missing `EXECUTION_TERMINATED**` ([run_display.go](client-apps/cli/cmd/stigmer/root/run_display.go) line 210). The streaming loop will never break for terminated executions. The polling path in `waitForExecution` handles it correctly, but streaming does not.
2. **Same bug in `isTerminalWorkflowPhase()**` ([run_display.go](client-apps/cli/cmd/stigmer/root/run_display.go) line 217).
3. `**waitForExecution()` does not handle approvals** ([run_handlers.go](client-apps/cli/cmd/stigmer/root/run_handlers.go) line 76). Any execution path using polling will hang indefinitely (or timeout at 30 min) if the execution needs approval.
4. **Streaming functions return void** ([run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)). Callers cannot use the final execution state for artifact downloads or result display. This is why `draft skill` had to add a parallel polling path.

---

## Architecture Decision

**Streaming functions become the single execution mechanism**, returning the final execution state. This eliminates the need for the polling path in all interactive cases.

```go
// Before: fire-and-forget, returns nothing
func streamAgentExecutionLogs(executionID string, conn *grpc.ClientConn)

// After: returns final state, takes injected dependencies
func streamAgentExecution(executionID string, prompter approval.Prompter, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error)
```

The `prompter` is injected as a parameter (per coding guidelines: dependency injection over hard-coding). This makes the function testable and allows non-TTY callers to pass a non-interactive prompter.

---

## Changes By File

### 1. `run_stream.go` -- Core refactor (the foundation everything builds on)

**Current**: Two void functions (`streamAgentExecutionLogs`, `streamWorkflowExecutionLogs`) that create their own prompter internally, print to stdout, and return nothing.

**Change**:

- Rename `streamAgentExecutionLogs` to `streamAgentExecution`
- Rename `streamWorkflowExecutionLogs` to `streamWorkflowExecution`
- Both return `(finalExecution, error)` instead of void
- Accept `prompter approval.Prompter` as a parameter (dependency injection)
- Proper error wrapping per coding guidelines (`errors.Wrap`)
- On stream error (non-EOF), return the error instead of silently printing and returning
- On approval error, return the error (caller decides what to do)

### 2. `run_display.go` -- Bug fixes

**Current**: `isTerminalAgentPhase` and `isTerminalWorkflowPhase` are missing `EXECUTION_TERMINATED`.

**Change**:

- Add `EXECUTION_TERMINATED` to both terminal phase checks
- Update tests to cover the new case

### 3. `run_handlers.go` -- Simplify execution paths

**Current**: `runAgent()` has three branches (wait/download, follow, no-follow). `runWorkflow()` has two branches (follow, no-follow).

**Change to `runAgent()**`:

- Remove `follow` and `wait` parameters entirely
- Add `detach` parameter (replaces `--no-follow`)
- If `detach`: print execution ID and return (fire-and-forget)
- Otherwise: always call `streamAgentExecution()`, use returned final state for artifact download and result display
- The `--download` flag no longer implies a separate code path -- it just adds a post-streaming download step

**Change to `runWorkflow()**`:

- Remove `follow` parameter
- Add `detach` parameter
- If `detach`: print execution ID and return
- Otherwise: always call `streamWorkflowExecution()`

`**waitForExecution()**`: Keep it but add a clear comment that it is a legacy fallback. It is not called in any active code path after this refactor, but removing it entirely can happen in a later cleanup pass to keep this diff focused.

### 4. `run.go` -- Flag changes

**Current**: Has `--follow` (default true), `--wait`, and related options.

**Change**:

- Remove `--follow` flag
- Remove `--wait` flag (streaming inherently waits for completion)
- Add `--detach` flag (default false): "Start execution and return immediately without streaming"
- Remove `Follow`, `Wait` from `runOptions` struct
- Add `Detach` to `runOptions` struct
- Update `routeRun()` signature to pass `detach` instead of `follow`/`wait`
- Update help text and examples to reflect the new behavior

### 5. `draft_skill.go` -- Flag cleanup

**Current**: Has `--follow` (default false).

**Change**:

- Remove `--follow` flag entirely
- Remove `Follow` from `draftSkillOptions`
- `draft skill` always streams (no `--detach` for draft -- it always needs to wait for artifacts)

### 6. `draft_skill_handler.go` -- Fix race condition

**Current**: Lines 67-74 run `go streamAgentExecutionLogs()` as a goroutine while `waitForExecution()` polls in foreground. Race condition on stdout.

**Change**:

- Remove the goroutine + polling dual path entirely
- Create a prompter (respecting TTY detection)
- Call `streamAgentExecution()` synchronously
- Use the returned final `AgentExecution` for artifact download and result display
- This collapses ~15 lines of racy code into ~5 lines of clean sequential code

### 7. Tests -- Update existing, add new

- `**run_display_test.go**`: Add `EXECUTION_TERMINATED` to `isTerminalAgentPhase` and `isTerminalWorkflowPhase` test tables
- `**run_stream_approval_test.go**`: Tests for `needsAgentApprovalPrompt` and `needsWorkflowApprovalPrompt` remain unchanged (pure logic, no dependency on streaming return type)
- Existing tests should continue to pass since approval logic, display logic, and prompt logic are not changing -- only the orchestration (streaming functions) changes

---

## What Is NOT Changing in T02

To keep this focused and avoid scope creep:

- **Display functions** (`displayAgentPhaseChange`, `displayAgentMessage`, etc.) stay as-is. Improving them is T03/T04.
- **Approval display** (`displayPendingApproval`) stays as-is. Improving it is T03.
- **Approval prompter** (`pkg/approval/`) stays as-is. Replacing Survey with Bubbletea is T03.
- `**cliprint` package** stays as-is.
- **Non-TTY graceful degradation** (auto-approve flags, plain text mode) is T05 scope. For now, non-TTY will use the existing `InteractivePrompter` fallback (which returns `ErrNonInteractiveNoDefault` if no default action is set -- a known limitation to address in T05).

---

## Implementation Order

The changes have dependencies and should be done in this sequence:

1. **Bug fixes first** (`run_display.go`): Fix terminal phase checks. Zero risk, standalone.
2. **Core refactor** (`run_stream.go`): Change signatures to return final state + error. This is the keystone.
3. **Handler simplification** (`run_handlers.go`): Update `runAgent` and `runWorkflow` to use new streaming signatures.
4. **Flag changes** (`run.go`, `draft_skill.go`): Remove `--follow`/`--wait`, add `--detach`.
5. **Race condition fix** (`draft_skill_handler.go`): Replace goroutine + polling with synchronous streaming.
6. **Tests**: Update throughout, verify build.

---

## Risks and Open Questions

- **Breaking change**: Removing `--follow` and `--wait` flags will break any scripts or CI pipelines using them. This is an accepted trade-off per the T01 review ("Remove entirely, not deprecate").
- **Bubbletea is already a dependency**: `cliprint/progress.go` already uses `charmbracelet/bubbletea` and `charmbracelet/lipgloss`. No new dependency needed.
- **File sizes**: After refactoring, `run_stream.go` will remain under 170 lines (well within the 250-line guideline). `run_handlers.go` will shrink significantly as the branching logic simplifies.

