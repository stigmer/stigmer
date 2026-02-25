# CLI Output System Foundation - `clioutput` Package

**Date**: February 26, 2026

## Summary

Built the foundational `pkg/clioutput/` package for the Stigmer CLI, replacing the need for ad-hoc `fmt.Println` and `cliprint.PrintInfo` calls with a structured `CommandResult` domain model and pluggable renderers (Human, JSON, Quiet). This is Phase 1 of a 6-phase refactor to bring the CLI output layer to production quality with consistent formatting, proper confirmation prompts, and machine-readable output support.

## Problem Statement

The Stigmer CLI output system suffered from 9 identified violations including a critical delete-without-confirmation bug, 8 duplicate `display.go` files with copy-pasted code, 3 competing icon systems, and no structured output model. Every command hand-rolled its output with direct `fmt.Println` and `cliprint` calls, making it impossible to add machine-readable output (`--output json`) or enforce a consistent visual vocabulary.

### Pain Points

- `PrintInfo` used for 6+ distinct semantics (headers, key-value pairs, hints, labels) making all output look identical
- No `CommandResult` domain model; commands had no structured representation of their output
- Delete operations displayed a "confirmation" warning but proceeded unconditionally
- 3 different icon systems (`✓/✗/ℹ/⚠` vs `🚀/✅/💡` vs `✓/✗/○/↻/✗✗`) competing across the codebase
- `truncateString()` copy-pasted identically in 5 separate display files
- No stderr/stdout separation; decorative output mixed with data on stdout

## Solution

Created a clean, reusable `pkg/clioutput/` package with zero Stigmer-specific business logic. The package provides three core abstractions:

1. **CommandResult** - A structured value object with status, message, typed sections (key-value fields, bullet items), and hints
2. **Renderer** - An interface with Human/JSON/Quiet implementations that format CommandResult for different output targets
3. **Confirmer** - An interface for interactive y/N prompts with terminal safety (non-TTY auto-denies)

## Implementation Details

### Package: `client-apps/cli/pkg/clioutput/` (13 files)

**Source files (431 lines)**:
- `result.go` (123 lines) - `CommandResult`, `Section`, `KeyValue` types with ergonomic builder pattern
- `renderer.go` (37 lines) - `Renderer` interface, `OutputFormat` constants, `NewRenderer()` factory
- `human_renderer.go` (103 lines) - Colored output with strict `✓`/`⚠`/`✗` vocabulary, aligned key-value pairs
- `json_renderer.go` (61 lines) - Machine-readable JSON with string-typed status, `omitempty` for clean output
- `quiet_renderer.go` (33 lines) - Status line only, suppresses all sections and hints
- `confirm.go` (74 lines) - `Confirmer` interface, `InteractiveConfirmer` (TTY-safe), `AlwaysYesConfirmer`

**Test files (535 lines, 38 tests)**:
- Comprehensive coverage of builder construction, chaining, pointer stability
- Human renderer alignment verification with deterministic (color-disabled) output
- JSON structure validation including `omitempty` behavior
- Terminal safety testing via pipe-based file descriptors

**Build**: `BUILD.bazel` following existing Bazel conventions with public visibility

### Key Technical Decisions

- **`[]*Section` over `[]Section`**: Prevents dangling pointer bugs when Go reallocates the slice backing array on subsequent `AddSection()` calls
- **`InteractiveConfirmer.In` is `*os.File`**: Required for `term.IsTerminal()` which needs a file descriptor, not just an `io.Reader`
- **Non-terminal stdin defaults to deny**: Piped input returns `(false, nil)` without prompting, requiring `--force` for scripted destructive operations
- **Renderers take both `stdout` and `stderr`**: Enables proper output routing (human to stderr, JSON data to stdout)

## Benefits

- **Structured output**: Commands will express intent (`Success`, `Warning`, `Error`) instead of formatting strings
- **Machine-readable**: `--output json` becomes possible without per-command serialization logic
- **Consistent vocabulary**: Single icon set (`✓`/`⚠`/`✗`) enforced by the renderer, not by caller discipline
- **Testable**: All output captured via `io.Writer` injection; no global state
- **Safe deletes**: `Confirmer` interface makes real y/N prompts trivial to add (Phase 2)
- **Foundation for consolidation**: The 8 duplicate `display.go` files can be replaced by generic `CommandResult` construction (Phase 4)

## Impact

- **CLI package**: New `pkg/clioutput/` package, no existing code modified
- **Future phases**: Enables Phase 2 (delete confirmation), Phase 3 (command migration), Phase 4 (display consolidation), Phase 5 (cleanup)
- **Developer experience**: Clean builder API reduces boilerplate for any new CLI command

## Related Work

- Phase 2 (next): Fix critical delete-without-confirmation bug using `Confirmer`
- Phase 3: Migrate all 20+ command handlers to `CommandResult`
- Phase 4: Consolidate 8 duplicate `display.go` files
- Phase 5: Remove deprecated `cliprint` functions, wire `--output` flag
- Project plan: `_projects/2026-02/20260226.01.cli-output-system-refactor/tasks/T01_0_plan.md`

---

**Status**: ✅ Production Ready (Phase 1 complete, no existing code modified)
**Timeline**: Single session
