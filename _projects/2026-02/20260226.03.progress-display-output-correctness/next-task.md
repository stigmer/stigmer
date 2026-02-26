# Next Task: 20260226.03.progress-display-output-correctness

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260226.03.progress-display-output-correctness

**Description**: Make ProgressDisplay a well-behaved citizen in the CLI output system by redirecting BubbleTea output to stderr and adding --json/--quiet flag support to the two remaining mutating commands (server start, server llm pull).
**Goal**: Ensure all mutating CLI commands have consistent output behavior: structured data to stdout, ephemeral progress to stderr, and --json/--quiet flag support for scriptability.
**Tech Stack**: Go (Golang), cobra CLI framework, charmbracelet/bubbletea, charmbracelet/lipgloss, clioutput package
**Components**: client-apps/cli/internal/cli/cliprint/progress.go, client-apps/cli/cmd/stigmer/root/server.go, client-apps/cli/cmd/stigmer/root/server_llm.go, client-apps/cli/pkg/clioutput, client-apps/cli/cmd/stigmer/root/output_flags.go

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.03.progress-display-output-correctness/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-26 21:15
**Current Task**: T01 Steps 3-4 (next)
**Status**: In Progress — Steps 1-2 complete, Steps 3-6 remaining

## Session Progress (2026-02-26)

### Completed: Steps 1-2 — Redirect Ephemeral Output to stderr

- **Step 1**: Added `tea.WithOutput(os.Stderr)` to `NewProgressDisplay()` in `cliprint/progress.go`. Single-point fix that redirects all BubbleTea spinner output to stderr across all three call sites (`handleServerStart`, `handleLLMPull`, `EnsureRunning`).
- **Step 2**: Replaced 4 bare `fmt.Println` calls that leaked decorative blank lines to stdout:
  - `server_llm.go` lines 238, 258: `fmt.Println("")` → `fmt.Fprintln(os.Stderr)`
  - `daemon.go` lines 1084, 1097: `fmt.Println()` → `fmt.Fprintln(os.Stderr)`
- **Verification**: `go build ./client-apps/cli/...` and `go vet ./client-apps/cli/...` both pass clean.
- **No surprises**: All changes matched the plan exactly. No import or BUILD.bazel complications.

### Files Modified (Steps 1-2)

```
client-apps/cli/internal/cli/cliprint/progress.go   (+1 import, 1 line changed)
client-apps/cli/cmd/stigmer/root/server_llm.go      (2 lines changed)
client-apps/cli/internal/cli/daemon/daemon.go        (2 lines changed)
```

## Next Steps

1. **Step 3**: Add `--json`/`--quiet` flags to `server start` command (`server.go`)
2. **Step 4**: Add `--json`/`--quiet` flags to `server llm pull` command (`server_llm.go`)
3. **Step 5**: Resolved by Steps 1-2 (no code change needed for `EnsureRunning`)
4. **Step 6**: Integration tests — flag wiring tests for the 2 new commands in `output_format_test.go`

## Context for Resume

- Steps 1-2 are the "correctness foundation" — they ensure all ephemeral output stays off stdout. Steps 3-4 build on top by adding structured output support.
- `climsg` already writes to stderr (confirmed). No changes needed there.
- `server.go` has no bare `fmt.Print*` calls — it only needed the `NewProgressDisplay` fix (inherited from Step 1).
- The existing `if opts.Progress != nil` guards in `daemon.StartWithOptions` and `llm.SetupOptions` mean passing `nil` in JSON/quiet mode cleanly suppresses all phase updates with zero downstream changes.

## Quick Commands

After loading context:
- "Continue with Steps 3-4" - Add --json/--quiet flags to server start and server llm pull
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-02/20260226.03.progress-display-output-correctness/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
