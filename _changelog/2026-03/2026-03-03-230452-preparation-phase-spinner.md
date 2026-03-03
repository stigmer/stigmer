# Preparation Phase Spinner

**Date**: March 3, 2026

## Summary

Added animated preparation spinners across all three CLI command paths (run, draft, session) so users get immediate visual feedback during the 3-10 second gap between command invocation and TUI/streaming appearance. Fixed a correctness bug in the spinner package where TTY detection was hardcoded to stdout, preventing spinners from animating when writing to stderr.

## Problem Statement

When a user runs `stigmer run agent my-agent`, there is a multi-second silent gap while the CLI connects to the backend, resolves the agent, processes attachments, creates the session, and creates the execution. During this time the terminal shows nothing — the user has no indication that the CLI is working and may assume it has hung.

### Pain Points

- 3-10 seconds of complete silence between command invocation and TUI appearance
- Network-bound operations (connect, resolve, create) provide zero progress feedback
- The `draft` and `run ses-xxx` paths have the same silent gap
- When stdout is piped (`--json | jq`), the spinner package incorrectly suppressed output even though stderr was available as a terminal

## Solution

Threaded a `*spinner.Spinner` through the entire preparation call chain. Each command path creates a spinner writing to `os.Stderr`, starts it immediately, and passes it to downstream functions that update the label at each network-bound step. The spinner is stopped just before TUI/streaming begins, followed by a static success message.

Fixed the spinner's TTY detection to check the writer's own file descriptor instead of hardcoding `os.Stdout`, enabling correct behavior when the spinner writes to stderr.

## Implementation Details

### Spinner TTY Detection Fix (`pkg/spinner/spinner.go`)

Replaced `display.IsTerminal()` (which hardcodes `os.Stdout.Fd()`) with a writer-fd-based check:

```go
func isWriterTerminal(w io.Writer) bool {
    if f, ok := w.(*os.File); ok {
        return term.IsTerminal(int(f.Fd()))
    }
    return false
}
```

This removes the `display` package dependency from `spinner` and correctly handles:
- `os.Stderr` spinners (new behavior — animates when stdout is piped)
- `os.Stdout` spinners (identical to previous behavior)
- `bytes.Buffer` spinners (no-op — existing tests unchanged)

### Run Agent Path (`run.go` + `run_agent_exec.go`)

`executeRun` creates `spinner.New(os.Stderr)` and starts it with "Preparing...". The spinner is threaded through:
1. `prepareAgentExec(flags, sp)` — updates to "Connecting..." and "Processing attachments..."
2. `routeRun(info, ref, downloadDir, prep, sp)` — updates to "Resolving agent..."
3. `executeResolvedAgent(input, sp)` — updates to "Creating workspace..." and "Creating execution...", then stops before printing the static "Session started" line

### Draft Path (`draft_handler.go`)

Same pattern with a stop-print-restart cycle: spinner stops after agent resolution to display "Using system agent: ..." as a static line, then `executeResolvedAgent` restarts it for execution creation via `sp.Start()` (which handles both starting a stopped spinner and updating an active one).

### Session Path (`run_session.go`)

`executeRunSession` creates a spinner with "Connecting..." and passes it to `openSession`, which updates through "Loading session..." and "Loading session history...", then stops before printing session info.

### Progress Messages Replaced

Three `climsg.Info` intermediate messages in `executeResolvedAgent` were replaced by spinner labels:
- "Creating workspace session..." → spinner label "Creating workspace..."
- "Starting execution with N input file(s)..." → removed (redundant — attachments already processed)
- "Starting session..." → removed (redundant — spinner shows "Creating execution...")

The final `climsg.Success("Session started: ses-xxx")` remains as a static confirmation after spinner stops.

## Benefits

- Immediate visual feedback on command invocation — no more silent gaps
- Elapsed time display helps users gauge whether something is genuinely slow vs. hung
- Spinner writes to stderr, maintaining stdout/stderr discipline from Phase 2.2
- `stigmer run --json | jq` now correctly shows the spinner on stderr while JSON flows through stdout
- The `pkg/spinner` package is now self-contained (no dependency on `display` package for TTY detection)

## Impact

- **Users**: Every `stigmer run`, `stigmer draft`, and session re-attach command now provides animated preparation feedback
- **Piped/CI usage**: Spinner animates on stderr when stderr is a TTY, even if stdout is piped
- **Maintainers**: Spinner accepts `*spinner.Spinner` parameter — adding progress to new preparation steps is a single `sp.Update("label...")` call

## Related Work

- Phase 2.2 (Two-Lane Output Design) established the stdout/stderr discipline that this phase builds on
- The existing workflow spinner in `streamWorkflowExecution` provided the pattern for spinner usage
- Phase 2.5 (`stigmer doctor`) is the next item in the Phase 2 (High) sequence

---

**Status**: Production Ready
**Tests**: 3 new spinner tests + full existing suite passing
