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
**Current Task**: T01 — All steps complete
**Status**: Complete — All 6 steps done, all tests passing

## Session Progress (2026-02-26)

### Session 1: Steps 1-2 — Redirect Ephemeral Output to stderr

- **Step 1**: Added `tea.WithOutput(os.Stderr)` to `NewProgressDisplay()` in `cliprint/progress.go`. Single-point fix that redirects all BubbleTea spinner output to stderr across all three call sites (`handleServerStart`, `handleLLMPull`, `EnsureRunning`).
- **Step 2**: Replaced 4 bare `fmt.Println` calls that leaked decorative blank lines to stdout:
  - `server_llm.go` lines 238, 258: `fmt.Println("")` → `fmt.Fprintln(os.Stderr)`
  - `daemon.go` lines 1084, 1097: `fmt.Println()` → `fmt.Fprintln(os.Stderr)`
- **Commit**: `73dd437d refactor(cli): redirect ProgressDisplay and bare fmt.Println to stderr`

### Session 2: Steps 3-4, 6 — Output Format Flag Wiring + Tests

- **Step 3**: Added `--json`/`--quiet` flags to `server start` (`server.go`). Conditional ProgressDisplay (nil in non-human modes leveraging existing nil guards in `daemon.StartWithOptions`). Format-aware final output: human mode preserves climsg, JSON/quiet mode builds CommandResult with PID/port/data.
- **Step 4**: Added `--json`/`--quiet` flags to `server llm pull` (`server_llm.go`). Warning paths (non-ollama, not running) migrated from bare climsg to CommandResult+Renderer (consistent with `handleLLMList`). Pre-operation climsg conditional on human mode. Final success uses CommandResult for all modes.
- **Step 5**: Resolved by Steps 1-2 (no code change needed for `EnsureRunning`).
- **Step 6**: Added 4 integration tests to `output_format_test.go`: 2 flag wiring tests (server, server llm pull), 1 JSON warning path test, 1 quiet stdout-empty test. All 30 test cases pass.
- **Design Decision**: climsg stays format-agnostic (always writes to stderr). `--json`/`--quiet` control Command Result formatting only, not operational progress. This follows bounded context separation and Unix conventions.
- **Commit**: `6c1ed6e9 feat(cli): add --json/--quiet flags to server start and server llm pull`

### Files Modified (All Steps)

```
client-apps/cli/internal/cli/cliprint/progress.go     (Step 1: tea.WithOutput(os.Stderr))
client-apps/cli/cmd/stigmer/root/server.go             (Steps 1,3: flag wiring, conditional progress, format-aware output)
client-apps/cli/cmd/stigmer/root/server_llm.go         (Steps 2,4: flag wiring, warning migration, conditional progress)
client-apps/cli/internal/cli/daemon/daemon.go          (Step 2: fmt.Println → fmt.Fprintln(os.Stderr))
client-apps/cli/cmd/stigmer/root/output_format_test.go (Step 6: 4 new test cases)
```

## Project Completion Summary

All 12 mutating CLI commands now have `--json`/`--quiet` support. The output system follows three bounded contexts:
- **ProgressDisplay**: format-aware (skip in non-human modes)
- **climsg**: format-agnostic (always stderr)
- **CommandResult**: format-aware (JSON/quiet/human rendering)

No changes were needed to: `daemon.go` (beyond Step 2 stderr fix), `progress.go` (beyond Step 1 stderr fix), `clioutput/`, `climsg/`, `output_flags.go`, or any BUILD.bazel files.

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-02/20260226.03.progress-display-output-correctness/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
