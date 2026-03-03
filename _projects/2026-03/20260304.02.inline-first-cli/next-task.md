# Next Task: 20260304.02.inline-first-cli

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260304.02.inline-first-cli

**Description**: Move Stigmer CLI from alt-screen TUI default to inline-first terminal experience inspired by Claude Code. Compact tool rendering (read as filename+line count, write/edit with previews, grouped sub-agents), inline follow-up input, and streamlined approval prompts — all in normal terminal scrollback without alt-screen.
**Goal**: Make the inline rendering mode the default CLI experience with four perfected UI surfaces: (1) Read tool as compact filename+line count, (2) Write/Edit tool with appropriate previews, (3) Sub-agent tool grouping, and (4) Streamlined approval prompts. TUI code retained but unreachable from CLI flags.
**Tech Stack**: Go, Bubbletea (charmbracelet), gRPC, Cobra
**Components**: client-apps/cli/cmd/stigmer/root (run_stream_inline.go, output_mode.go, run_stream.go), client-apps/cli/pkg/executiontui (model.go, render_blocks.go, view.go), client-apps/cli/pkg/toolrender (file_preview.go, render.go, hyperlink.go)

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
**Current Task**: Phase 2.1 (Read Tool Compact Rendering)
**Status**: Ready to Start
**Last Session**: 2026-03-04 — Phase 2.0 complete

## Session Progress (2026-03-04, Session 1)

- Phase 1 (Flip Default to Inline) completed
- Removed `--no-tui` flag and `NoTUI` struct field from `outputModeFlags`
- Simplified `resolveOutputMode` to a two-path function: `--json` or inline (default)
- Updated help text, examples, and doctor hints to remove all `--no-tui` references
- Decision: TUI code stays in codebase but unreachable from CLI flags (no `--tui` flag added)
- Tests updated: removed 6 obsolete tests, added `TestResolveOutputMode_NoFlags_AlwaysInline`

### Files Modified (Session 1)
- `client-apps/cli/cmd/stigmer/root/output_mode.go`
- `client-apps/cli/cmd/stigmer/root/output_mode_test.go`
- `client-apps/cli/cmd/stigmer/root/run.go`
- `client-apps/cli/cmd/stigmer/root/doctor_checks_runtime.go`

## Session Progress (2026-03-04, Session 2)

- Phase 2.0 (OSC 8 File Hyperlinks) completed
- Created `pkg/toolrender/hyperlink.go` (81 lines) — foundational OSC 8 hyperlink primitives
- Created `pkg/toolrender/hyperlink_test.go` (257 lines) — 22 test functions with full coverage
- Updated `pkg/toolrender/BUILD.bazel` — added new files and `golang.org/x/term` dep

### Key Design Decisions (Session 2)
- `FileHyperlink(displayPath, absolutePath, enabled)` is pure — takes an `enabled bool` per DI guidelines, no env var reads
- `Hyperlink(displayText, uri)` is generic OSC 8 wrapper exposed for future non-file links (HTTP URLs, issue links)
- `HyperlinksEnabled(w)` co-located in `toolrender/hyperlink.go` (not `display/terminal.go`) to avoid unnecessary cross-package coupling
- `NO_COLOR` conservatively disables hyperlinks (OSC 8 is an escape sequence; users who set NO_COLOR want plain text)
- Uses ESC+backslash (`\033\\`) as String Terminator per modern OSC 8 spec
- `file://` URIs work for local+cloud backend scenarios since CLI always runs locally; future cloud-workspace can set enabled=false

### Files Modified (Session 2)
- `client-apps/cli/pkg/toolrender/hyperlink.go` (new)
- `client-apps/cli/pkg/toolrender/hyperlink_test.go` (new)
- `client-apps/cli/pkg/toolrender/BUILD.bazel` (modified)

## Next Steps

1. Phase 2.1: Read tool compact rendering — `RenderCompact` with one-line clickable path + "Read N lines"
2. Phase 2.2: Write/Edit tool compact rendering — minimal header + line count with clickable path
3. Phase 2.3: Shell tool compact rendering — command + exit code + truncated output
4. Phase 2.4: Other tools (glob, search, delete, think)
5. Phase 2.5: Sub-agent tool grouping with indentation

## Context for Resume

- Pre-existing compile error in `run_create.go:114` (references `WorkspaceSource` from multi-source-workspace project) blocks `go test` for the `root` package. Our changes are isolated and verified correct via `go vet`.
- The `OutputInteractive` constant is retained in `output_mode.go` — TUI code references it from `run_stream.go` and `run_session.go` default branches.
- OSC 8 hyperlink primitives now exist in `pkg/toolrender/hyperlink.go`. Phase 2.1 will wire them into a new `RenderCompact` function.
- **Integration concern for Phase 2.1**: `display/colors.go` `stripANSI` only handles CSI (`\x1b[...m`), not OSC (`\x1b]...`). When hyperlinked strings flow through `MeasureColorizedString` or `TrimColorizedString`, those functions will need OSC-awareness.
- **Integration concern for Phase 2.1**: Verify that `charmbracelet/x/ansi.StringWidth()` correctly handles OSC 8 sequences in width calculations.
- Current tool rendering uses `RenderWithBadge` in `pkg/toolrender/` — Phase 2.1 will add a new `RenderCompact` path that the inline renderer calls instead.
- The inline renderer (`run_stream_inline.go`) will call `HyperlinksEnabled(cfg.status)` once at init and store the bool.

## Blockers

None.

## Quick Commands

After loading context:
- "Continue with Phase 2.1" - Start Read tool compact rendering
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260304.02.inline-first-cli/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
