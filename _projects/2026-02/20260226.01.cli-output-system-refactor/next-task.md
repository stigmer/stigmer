# Next Task: 20260226.01.cli-output-system-refactor

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260226.01.cli-output-system-refactor

**Description**: Refactor the Stigmer CLI output layer from ad-hoc fmt.Println calls into a structured, domain-driven output system with consistent formatting, proper confirmation prompts, and machine-readable output support.
**Goal**: Replace the current anemic CLI output model with a structured CommandResult domain entity, a Renderer interface (Human/JSON/Quiet), fix the destructive delete-without-confirmation bug, consolidate 8 duplicate display.go files into a generic resource renderer, and establish a strict icon/semantic vocabulary.
**Tech Stack**: Go (Golang), cobra CLI framework, charmbracelet/lipgloss, charmbracelet/bubbletea, fatih/color
**Components**: client-apps/cli/internal/cli/cliprint, client-apps/cli/internal/cli/clierr, client-apps/cli/internal/cli/*/display.go (8 files), client-apps/cli/cmd/stigmer/root/*.go (command handlers), client-apps/cli/pkg/display

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260226.01.cli-output-system-refactor/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-26 02:27
**Current Task**: Phase 3.2 (Resolve get/list format tension, then migrate server/backend/config commands)
**Status**: In Progress - Phase 1, Phase 2, and Phase 3.1 Complete

## Session Progress (2026-02-26)

### Completed: Phase 1 - Core `clioutput` Package Foundation

- Built the new `client-apps/cli/pkg/clioutput/` package (7 source files, 5 test files, 1 BUILD.bazel)
- **result.go** (123 lines): `CommandResult`, `Section`, `KeyValue` types with ergonomic builder pattern
- **renderer.go** (37 lines): `Renderer` interface, `OutputFormat` constants, `NewRenderer()` factory
- **human_renderer.go** (103 lines): Colored terminal output with strict semantic vocabulary (`✓`/`⚠`/`✗`)
- **json_renderer.go** (61 lines): Machine-readable JSON output with string-typed status
- **quiet_renderer.go** (33 lines): Status-line-only output for scripting
- **confirm.go** (74 lines): `Confirmer` interface with `InteractiveConfirmer` and `AlwaysYesConfirmer`
- **BUILD.bazel** (34 lines): Bazel targets following repo conventions
- 38 tests passing, zero linter errors, `go build` and `go vet` clean

### Completed: Phase 2 - Fix Critical Delete Confirmation Bug

- Fixed the critical bug where `stigmer delete` proceeded without confirmation
- Introduced `deleteContext` struct to bundle handler dependencies (ref, orgID, force, confirmer, conn)
- Refactored `routeDelete` and all 5 resource handler signatures from flat parameters to `*deleteContext`
- Wired `clioutput.Confirmer.Confirm()` into all 6 delete paths
- Non-TTY stdin now safely aborts (InteractiveConfirmer returns false when piped)
- `go build`, `go vet`, all tests passing, zero new linter errors

### Completed: Phase 3.1 - Migrate Delete Command to CommandResult

- Migrated all delete output from ad-hoc cliprint/fmt to structured CommandResult + Renderer
- Split `delete.go` (401 lines) into three files per 250-line guideline:
  - `delete.go` (158 lines): Command definition, deleteContext (with new `renderer` field), orchestration
  - `delete_handlers.go` (234 lines): 5 per-resource delete handlers using `clioutput.Warning()`/`Success()` + `dctx.renderer.Render()`
  - `delete_cancel.go` (87 lines): Execution cancel handler with inline renderer
- Removed 11 dead display functions from 5 resource packages + execution
- Exported `execution.FormatPhase()` for cross-package phase formatting
- Removed corresponding tests for deleted functions
- Zero `cliprint` imports in any delete file
- `go build`, `go vet`, all tests passing

### Key Design Decisions

1. **`[]*Section` not `[]Section`**: Prevents dangling pointer bugs when slice grows on subsequent `AddSection()` calls
2. **`InteractiveConfirmer` takes `*os.File`**: Required for `term.IsTerminal()` to check TTY status
3. **Non-terminal stdin defaults to deny**: Safety-first - piped input aborts destructive ops, requires `--force`
4. **Deferred Phase 1.2 and 1.3**: `Displayable` interface and `--output` flag moved to their respective phases to avoid speculative abstractions
5. **`deleteContext` struct over parameter explosion**: Bundles handler dependencies into one unexported struct, extended with `renderer` in Phase 3.1
6. **Abort returns `nil` not error**: User choosing "N" at prompt is not a failure -- their intent was honored
7. **Hardcoded `FormatHuman` for delete**: Delete has no `--output` flag. No speculative abstraction until Phase 5.
8. **`--output table/yaml/json` vs `clioutput.OutputFormat`**: These are two different concerns (data serialization vs CLI chrome). Scoped Phase 3.1 to delete-only. Requires design decision before migrating get/list.

### Files Created (Phase 1)

```
client-apps/cli/pkg/clioutput/
├── BUILD.bazel
├── confirm.go
├── confirm_test.go
├── human_renderer.go
├── human_renderer_test.go
├── json_renderer.go
├── json_renderer_test.go
├── quiet_renderer.go
├── quiet_renderer_test.go
├── renderer.go
├── result.go
└── result_test.go
```

### Files Modified (Phase 2)

```
client-apps/cli/cmd/stigmer/root/delete.go    (+99, -48)
client-apps/cli/cmd/stigmer/root/BUILD.bazel   (+1)
```

### Files Created/Modified (Phase 3.1)

```
Created:
  client-apps/cli/cmd/stigmer/root/delete_handlers.go  (234 lines, new)
  client-apps/cli/cmd/stigmer/root/delete_cancel.go     (87 lines, new)

Modified:
  client-apps/cli/cmd/stigmer/root/delete.go            (401→158 lines)
  client-apps/cli/cmd/stigmer/root/BUILD.bazel           (+2 srcs)
  client-apps/cli/internal/cli/agent/display.go          (-29 lines)
  client-apps/cli/internal/cli/agent/display_test.go     (-45 lines)
  client-apps/cli/internal/cli/workflow/display.go       (-29 lines)
  client-apps/cli/internal/cli/workflow/display_test.go  (-45 lines)
  client-apps/cli/internal/cli/mcpserver/display.go      (-27 lines)
  client-apps/cli/internal/cli/project/display.go        (-28 lines)
  client-apps/cli/internal/cli/project/display_test.go   (-26 lines)
  client-apps/cli/internal/cli/skill/display.go          (-33 lines)
  client-apps/cli/internal/cli/execution/display.go      (-14, +3: removed DisplayCancelResult, exported FormatPhase)
```

## Next Steps

1. **Design Decision: get/list output format coexistence** (Required before Phase 3.2)
   - `--output table/yaml/json` on get/list = data serialization format
   - `clioutput.OutputFormat` = CLI chrome format (human/json/quiet)
   - Need to decide how these coexist before migrating get/list commands

2. **Phase 3.2: Migrate server/backend/config commands** (Medium effort)
   - `handleBackendStatus()`, `handleServerStatus()`, `handleConfigList/Set/Get()`
   - These have no `--output` conflict (no existing format flag)

3. **Phase 3.3: Migrate apply commands** (Medium effort)
   - Has mid-stream progress updates that need special handling

4. **Phase 4: Consolidate Display Files** (Medium effort)
   - Design `Displayable` interface based on actual migration patterns from Phase 3
   - Eliminate 8 duplicate `display.go` files

5. **Phase 5: Cleanup & Polish** (Small effort)
   - Remove deprecated `cliprint` functions
   - Wire up `--output` flag end-to-end
   - Final icon/vocabulary audit

## Context for Resume

- The `clioutput` package is in `pkg/` (not `internal/`) - zero Stigmer-specific code, reusable
- Renderers take both `stdout` and `stderr` writers: human writes to stderr, JSON data to stdout
- The existing `cliprint` package remains untouched except where delete code no longer imports it
- `cliprint` is NOT imported by any delete file anymore (Phase 3.1 cleaned this up)
- Delete handlers now use `clioutput.Warning()`/`clioutput.Success()` + `dctx.renderer.Render()` exclusively
- `execution.FormatPhase()` was exported for cross-package use (previously `formatPhase`)
- Plan files: `.cursor/plans/phase_1_clioutput_package_6a41844c.plan.md`, `.cursor/plans/phase_2_delete_confirmation_bf3b2d04.plan.md`, `.cursor/plans/phase_3.1_delete_migration_38b0d475.plan.md`
- Task plan: `_projects/2026-02/20260226.01.cli-output-system-refactor/tasks/T01_0_plan.md`
- Branch: `feat/cli-output-system-foundation`

## Quick Commands

After loading context:
- "Resolve the get/list format question" - Design decision needed before Phase 3.2
- "Start Phase 3.2" - Migrate server/backend/config commands
- "Show project status" - Get overview of progress
- "Review Phase 3.1 code" - Check `delete.go`, `delete_handlers.go`, `delete_cancel.go`
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
