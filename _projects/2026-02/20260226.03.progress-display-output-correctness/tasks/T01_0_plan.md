# Task T01: ProgressDisplay Output Correctness

**Created**: 2026-02-26
**Status**: PENDING REVIEW
**Type**: Refactoring

## Domain Analysis (Principal Architect)

### The Problem

`ProgressDisplay` (BubbleTea-based interactive spinner) writes to **stdout** via `tea.NewProgram(model)` with no explicit output writer. This violates the CLI output contract established by the clioutput/climsg migration:

- **Structured data** (CommandResult JSON, piped values) → stdout
- **Ephemeral status** (progress, diagnostics, confirmations) → stderr

Additionally, `server start` and `server llm pull` are the only 2 of 12 mutating commands that don't support `--json`/`--quiet` flags. And `handleLLMPull` has bare `fmt.Println("")` calls that also leak to stdout.

### Call Sites (3 total)

| Call Site | File | Creates ProgressDisplay? | Has --json/--quiet? |
|-----------|------|--------------------------|---------------------|
| `handleServerStart` | `cmd/stigmer/root/server.go:139` | Yes | No |
| `handleLLMPull` | `cmd/stigmer/root/server_llm.go:240` | Yes | No |
| `EnsureRunning` | `internal/cli/daemon/daemon.go:1087` | Yes (auto-start) | No (called by other commands) |

Downstream consumers that receive `*cliprint.ProgressDisplay` and call `SetPhase`:
- `daemon.StartWithOptions` — 7 phase updates
- `llm.SetupOptions.Progress` — 3 phase updates (download, start server, pull model)
- `llm.progressReader` — holds reference for download progress

### What NOT to change

- **BubbleTea stays.** ProgressDisplay models ongoing, streaming state transitions. CommandResult models end-of-command structured output. They are different bounded contexts and should coexist.
- **ProgressDisplay API stays.** `NewProgressDisplay()`, `Start()`, `SetPhase()`, `CompletePhase()`, `Stop()` — the lifecycle is correct.
- **Default human mode UX stays.** Users running `stigmer server` interactively see the exact same spinner behavior.

## Task Breakdown

### Step 1: Redirect ProgressDisplay to stderr (1 line change)

**File**: `client-apps/cli/internal/cli/cliprint/progress.go`

Change `NewProgressDisplay`:
```go
// Before
program := tea.NewProgram(model)

// After
program := tea.NewProgram(model, tea.WithOutput(os.Stderr))
```

**Rationale**: This is the root fix. All three call sites and all downstream consumers inherit the correction. Zero behavioral change for interactive users (stderr and stdout both go to the terminal). Fixes stdout contamination for scripts piping output.

**Risk**: `tea.WithOutput(os.Stderr)` may affect BubbleTea's terminal detection. Verify that spinner rendering, cursor hiding, and alternate screen behavior still work. BubbleTea uses the output writer for `term.IsTerminal()` checks — stderr is a TTY in interactive use, so this should be fine.

**Validation**: `stigmer server 2>/dev/null` should show nothing (progress goes to stderr). `stigmer server` should look identical to today.

### Step 2: Fix bare stdout writes in handlers

**Files**: `server_llm.go`, `daemon/daemon.go`

Replace `fmt.Println("")` with `fmt.Fprintln(os.Stderr, "")` in:
- `handleLLMPull` (lines 239, 258)
- `EnsureRunning` (lines 1084, 1097)

**Rationale**: These are decorative blank lines between progress messages. They belong on stderr with the rest of the ephemeral output.

### Step 3: Add --json/--quiet flags to `server start`

**File**: `cmd/stigmer/root/server.go`

1. Register `--json` and `--quiet` flags on the `server` command (same pattern as `server stop`)
2. Pass `OutputFormat` to `handleServerStart`
3. In `handleServerStart`:
   - **Human mode** (default): Current behavior unchanged — create ProgressDisplay, show spinner, print climsg status
   - **JSON mode**: Skip ProgressDisplay (pass `nil` to `StartOptions.Progress`), suppress climsg, build a `CommandResult` at end with server status (PID, port, data dir), render as JSON to stdout
   - **Quiet mode**: Skip ProgressDisplay, suppress climsg, render single status line

**Design**: The `if opts.Progress != nil` guards already exist in `daemon.StartWithOptions` and `llm.SetupOptions` — passing `nil` cleanly suppresses all phase updates with zero changes to those packages.

### Step 4: Add --json/--quiet flags to `server llm pull`

**File**: `cmd/stigmer/root/server_llm.go`

Same pattern as Step 3:
1. Register flags on `newServerLLMPullCommand`
2. Pass `OutputFormat` to `handleLLMPull`
3. Conditional ProgressDisplay creation + CommandResult at end

### Step 5: Handle `EnsureRunning` output format awareness

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

`EnsureRunning` is called from other commands' code paths (apply, delete, etc.) that may themselves have `--json`/`--quiet` flags. Currently it unconditionally creates a ProgressDisplay and prints climsg messages.

Options:
- **Option A**: Add an `OutputFormat` parameter to `EnsureRunning`. Callers pass their resolved format. In JSON/quiet mode, skip ProgressDisplay and climsg.
- **Option B**: Accept `*cliprint.ProgressDisplay` as optional parameter (callers create or not based on format).
- **Option C**: Leave as-is — `EnsureRunning` is a "best-effort auto-start" and its output is always ephemeral/stderr (after Step 1+2).

**Recommendation**: Option C for now. After Steps 1-2, `EnsureRunning`'s ProgressDisplay writes to stderr and its `fmt.Println` goes to stderr. This means `stigmer apply --json` would get clean JSON on stdout even if `EnsureRunning` fires — the auto-start progress goes to stderr where it belongs. No API change needed.

If the user later wants `EnsureRunning` to be completely silent in JSON/quiet mode, we can revisit with Option A. But the correctness guarantee (clean stdout) is already met by Step 1+2.

### Step 6: Integration tests

**File**: `cmd/stigmer/root/output_format_test.go` (extend existing)

Add test cases for `server start` and `server llm pull`:
- Flag wiring: verify `--json` (no shorthand) and `--quiet`/`-q` registered
- These commands require daemon interaction so only flag-wiring tests are feasible (matching the "tier 3" pattern from the previous project's Item 6)

## Files Changed Summary

| File | Change |
|------|--------|
| `cliprint/progress.go` | `tea.WithOutput(os.Stderr)` + `os` import |
| `server_llm.go` | `fmt.Println` → `fmt.Fprintln(os.Stderr)`, add flags, conditional progress |
| `daemon/daemon.go` | `fmt.Println` → `fmt.Fprintln(os.Stderr)` |
| `server.go` | Add flags to server command, pass format to handler |
| `output_format_test.go` | Add flag wiring tests for 2 new commands |
| `BUILD.bazel` | Update deps if needed |

## Success Criteria

1. `ProgressDisplay` writes to stderr (verified: `stigmer server 2>/dev/null` shows nothing)
2. `stigmer server --json` produces valid, parseable JSON on stdout
3. `stigmer server --quiet` produces zero stdout
4. `stigmer server llm pull MODEL --json` produces valid JSON on stdout
5. `stigmer server llm pull MODEL --quiet` produces zero stdout
6. Default human mode behavior unchanged for both commands
7. `stigmer apply --json` stdout is clean even when `EnsureRunning` fires (auto-start)
8. All existing tests pass
9. `go build`, `go vet` clean

## Execution Order

Steps 1-2 are safe, independent fixes (can ship alone). Steps 3-4 depend on 1-2. Step 5 is resolved by 1-2. Step 6 can be done after 3-4.

Incremental verification after each step.

## Notes

- **Preserve behavior**: Interactive `stigmer server` must look identical to today
- **No new packages**: Uses existing `clioutput`, `climsg`, `output_flags.go` infrastructure
- **No ProgressDisplay API changes**: The `Start()`/`Stop()`/`SetPhase()` lifecycle is correct
- **IMPORTANT**: Only document in knowledge folders after ASKING for permission

## Review Process

**What happens next**:
1. **You review this plan** — consider approach, risks, scope
2. **Provide feedback** — concerns, suggestions, changes
3. **I'll revise** — create updated version incorporating feedback
4. **You approve** — explicit approval to proceed
5. **Execution begins** — tracked in T01_3_execution.md
