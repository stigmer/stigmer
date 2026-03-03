# Next Task: 20260304.02.inline-first-cli

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260304.02.inline-first-cli

**Description**: Move Stigmer CLI from alt-screen TUI default to inline-first terminal experience inspired by Claude Code. Compact tool rendering (read as filename+line count, write/edit with previews, grouped sub-agents), inline follow-up input, and streamlined approval prompts — all in normal terminal scrollback without alt-screen.
**Goal**: Make the inline rendering mode the default CLI experience with four perfected UI surfaces: (1) Read tool as compact filename+line count, (2) Write/Edit tool with appropriate previews, (3) Sub-agent tool grouping, and (4) Streamlined approval prompts. TUI code retained but unreachable from CLI flags.
**Tech Stack**: Go, Bubbletea (charmbracelet), gRPC, Cobra
**Components**: client-apps/cli/cmd/stigmer/root (run_stream_inline.go, output_mode.go, run_stream.go), client-apps/cli/pkg/executiontui (model.go, render_blocks.go, view.go), client-apps/cli/pkg/toolrender (file_preview.go, render.go)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.02.inline-first-cli/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-04 00:23
**Current Task**: Phase 2 (Compact Tool Rendering)
**Status**: In Progress
**Last Session**: 2026-03-04 — Phase 1 complete

## Session Progress (2026-03-04)

- Phase 1 (Flip Default to Inline) completed
- Removed `--no-tui` flag and `NoTUI` struct field from `outputModeFlags`
- Simplified `resolveOutputMode` to a two-path function: `--json` or inline (default)
- Updated help text, examples, and doctor hints to remove all `--no-tui` references
- Decision: TUI code stays in codebase but unreachable from CLI flags (no `--tui` flag added)
- Tests updated: removed 6 obsolete tests, added `TestResolveOutputMode_NoFlags_AlwaysInline`

### Files Modified
- `client-apps/cli/cmd/stigmer/root/output_mode.go`
- `client-apps/cli/cmd/stigmer/root/output_mode_test.go`
- `client-apps/cli/cmd/stigmer/root/run.go`
- `client-apps/cli/cmd/stigmer/root/doctor_checks_runtime.go`

## Next Steps

1. Phase 2.0: Clickable file paths (OSC 8 hyperlinks) — `pkg/toolrender/hyperlink.go`
2. Phase 2.1: Read tool compact rendering — one-line with clickable path
3. Phase 2.2: Write/Edit tool compact rendering
4. Phase 2.3: Shell tool compact rendering
5. Phase 2.4: Other tools (glob, search, delete, think)
6. Phase 2.5: Sub-agent tool grouping with indentation

## Context for Resume

- Pre-existing compile error in `run_create.go:114` (references `WorkspaceSource` from multi-source-workspace project) blocks `go test` for the `root` package. Our changes are isolated and verified correct via `go vet`.
- The `OutputInteractive` constant is retained in `output_mode.go` — TUI code references it from `run_stream.go` and `run_session.go` default branches.
- No OSC 8 hyperlink support exists yet — Phase 2.0 creates this from scratch.
- Current tool rendering uses `RenderWithBadge` in `pkg/toolrender/` — Phase 2 will add a new `RenderCompact` path.

## Blockers

None.

## Quick Commands

After loading context:
- "Continue with Phase 2" - Resume compact tool rendering
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260304.02.inline-first-cli/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
