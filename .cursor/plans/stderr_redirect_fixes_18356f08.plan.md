---
name: stderr redirect fixes
overview: Redirect ProgressDisplay (BubbleTea) output to stderr and fix bare fmt.Println stdout leaks in two handler files, ensuring all ephemeral output stays off stdout.
todos:
  - id: step1-progress-stderr
    content: Add os import and tea.WithOutput(os.Stderr) to NewProgressDisplay in cliprint/progress.go
    status: completed
  - id: step2a-llm-fprintln
    content: Replace fmt.Println("") with fmt.Fprintln(os.Stderr) in server_llm.go (lines 238, 258)
    status: completed
  - id: step2b-daemon-fprintln
    content: Replace fmt.Println() with fmt.Fprintln(os.Stderr) in daemon.go (lines 1084, 1097)
    status: completed
  - id: verify-build
    content: Run go build and go vet to confirm clean compilation
    status: completed
isProject: false
---

# Steps 1-2: Redirect Ephemeral Output to stderr

## What We Are Fixing

Three call sites create `ProgressDisplay`, which internally calls `tea.NewProgram(model)` with no explicit output writer. BubbleTea defaults to **stdout**. This violates the CLI output contract:

- **stdout** = structured data (CommandResult JSON, piped values)
- **stderr** = ephemeral status (progress spinners, diagnostics, confirmations)

Additionally, decorative `fmt.Println` calls in `handleLLMPull` and `EnsureRunning` leak blank lines to stdout.

`climsg` already writes to stderr (confirmed in source), so only ProgressDisplay and the bare `fmt.Println` calls are violations.

## Changes

### Change 1: Redirect ProgressDisplay to stderr

**File**: [client-apps/cli/internal/cli/cliprint/progress.go](client-apps/cli/internal/cli/cliprint/progress.go)

- Add `"os"` to the stdlib import block (between `"fmt"` and `"strings"`)
- Line 242: `tea.NewProgram(model)` becomes `tea.NewProgram(model, tea.WithOutput(os.Stderr))`

This is a single-point fix. All three call sites (`handleServerStart`, `handleLLMPull`, `EnsureRunning`) and all downstream consumers inherit the correction with zero changes on their side.

**Why stderr works**: BubbleTea uses its output writer for `term.IsTerminal()` checks. In interactive use, stderr is a TTY just like stdout, so spinner rendering, cursor hiding, and all terminal behavior remain identical. The only observable difference is for scripts redirecting stdout — they get clean output.

**BUILD.bazel**: No change needed. `os` is a stdlib package; Bazel Go rules resolve it automatically.

### Change 2: Fix bare `fmt.Println` in `handleLLMPull`

**File**: [client-apps/cli/cmd/stigmer/root/server_llm.go](client-apps/cli/cmd/stigmer/root/server_llm.go)

Two locations where `fmt.Println("")` writes a decorative blank line to stdout:

- Line 238: `fmt.Println("")` (between "pulling model" info and ProgressDisplay start)
- Line 258: `fmt.Println("")` (after ProgressDisplay stop, before config hint)

Both become `fmt.Fprintln(os.Stderr)`. No import changes — `"fmt"` and `"os"` are already imported.

### Change 3: Fix bare `fmt.Println` in `EnsureRunning`

**File**: [client-apps/cli/internal/cli/daemon/daemon.go](client-apps/cli/internal/cli/daemon/daemon.go)

Two locations where `fmt.Println()` writes a decorative blank line to stdout:

- Line 1084: `fmt.Println()` (after "Starting local backend daemon" info, before ProgressDisplay)
- Line 1097: `fmt.Println()` (after "Daemon started successfully", before return)

Both become `fmt.Fprintln(os.Stderr)`. No import changes — `"fmt"` and `"os"` are already imported.

## What NOT to Change

- **ProgressDisplay API** (`Start`, `Stop`, `SetPhase`, `CompletePhase`) — the lifecycle is correct
- `**climsg` calls** — they already write to stderr
- `**server.go`** — no bare stdout writes exist; only uses `NewProgressDisplay` (fixed by Change 1) and `climsg`
- `**EnsureRunning` signature** — no need to pass `OutputFormat`; after these changes its output is entirely on stderr, so callers like `stigmer apply --json` get clean stdout automatically

## Verification

After the changes:

1. `stigmer server 2>/dev/null` should show nothing (spinner + status go to stderr)
2. `stigmer server` should look visually identical to today (stderr renders to terminal)
3. `stigmer server llm pull MODEL 2>/dev/null` should show nothing
4. `go build ./client-apps/cli/...` passes
5. `go vet ./client-apps/cli/...` passes
6. Existing tests pass

