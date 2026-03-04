---
name: Phase 5 Dead Code Cleanup
overview: Phase 5 removes the unreachable Bubbletea alt-screen TUI (~95KB), cleans dead exports across 6 packages, and consolidates overlapping terminal utilities — leaving the codebase with only the inline and JSON rendering paths that are actually exercised.
todos:
  - id: commit-phase4
    content: "Phase 5.0: Commit uncommitted Phase 4 changes (spinner + follow-up) as a clean boundary"
    status: completed
  - id: remove-tui-root
    content: "Phase 5.1: Remove TUI path from root package — delete run_tui.go, remove streamAgentInteractive, resumeSessionInteractive, OutputInteractive, dead switch branches"
    status: completed
  - id: remove-tui-executiontui
    content: "Phase 5.2: Remove TUI-only files from executiontui — delete 15 files (~95KB), keep events.go + followup.go, rewrite doc.go, update BUILD.bazel"
    status: completed
  - id: remove-dead-exports
    content: "Phase 5.3: Remove dead exports — toolrender (RenderWaitingApproval, RenderResultWithPreview, etc.), termctl (MoveUp, ClearDown, ClearLine), display/table.go (entire file), cliprint (PhaseReady)"
    status: completed
  - id: overlap-consolidation
    content: "Phase 5.4: Consolidate display.GetTerminalWidth callers to termctl.Width where appropriate"
    status: completed
  - id: verify-polish
    content: "Phase 5.5: Run go vet, go build, go test, fix any broken imports, update next-task.md"
    status: completed
isProject: false
---

# Phase 5: Dead Code Cleanup and TUI Removal

## Architectural Decision

The Bubbletea alt-screen TUI is unreachable from CLI flags (`resolveOutputMode` returns only `OutputInline` or `OutputJSON`). We remove it entirely. Git history preserves it. The shared event system (`events.go`) stays untouched — inline, JSON, and any future consumer all depend on it. `InteractivePrompter` (workflow approvals) and `cliprint/ProgressDisplay` (server start spinner) both use Bubbletea independently and are unaffected.

---

## Phase 5.0: Commit Phase 4 Changes (prerequisite)

Uncommitted files from Phase 4 (thinking spinner + follow-up input):

- `run_stream_inline_followup.go` (new)
- `run_stream_inline_followup_test.go` (new)
- `run_stream_inline_spinner.go` (new)
- `run_stream_inline_spinner_test.go` (new)
- `run_stream_inline.go` (modified)
- `run_stream.go` (modified)
- `run_session.go` (modified)
- `BUILD.bazel` (modified)

Commit these with a conventional commit message before any cleanup begins.

---

## Phase 5.1: Remove TUI Path from Root Package

**Files to delete:**

- `run_tui.go` (80 lines) — `runTUIWithProtection`, `restoreTerminal`
- `run_tui_test.go` (178 lines) — tests for dead helpers

**Code to remove from existing files:**

- `**run_stream.go`**: Remove `streamAgentInteractive` function (~70 lines), remove `tea` and `executiontui.New/Config/Model` imports, remove `default` branch in `streamAgentExecution` switch (replace with explicit `case OutputJSON`)
- `**run_session.go`**: Remove `resumeSessionInteractive` function (~50 lines), remove `tea` import, remove `default` branch in `resumeSession` switch
- `**output_mode.go**`: Remove `OutputInteractive` constant (line 14) and its `case` in `String()`
- `**output_mode_test.go**`: Remove `OutputInteractive` test case
- `**BUILD.bazel**`: Remove `run_tui.go`, `run_tui_test.go`, remove `@com_github_charmbracelet_bubbletea` dep if no longer needed in this package

**Switch statement pattern** — current:

```go
switch outputMode {
case OutputInline:
    return streamAgentInline(...)
case OutputJSON:
    return streamAgentJSON(...)
default:
    return streamAgentInteractive(...)  // dead
}
```

After:

```go
switch outputMode {
case OutputJSON:
    return streamAgentJSON(...)
default:
    return streamAgentInline(...)
}
```

This makes inline the explicit default, matching `resolveOutputMode` behavior.

---

## Phase 5.2: Remove TUI-Only Code from executiontui

**Files to delete** (TUI model, view, update, blocks, rendering — all internal to TUI):

- `model.go` (~400 lines) — Bubbletea Model, Config, New()
- `update.go` (~350 lines) — Main Update() implementation
- `handle_events.go` (~400 lines) — Event-to-model translation
- `view.go` (~200 lines) — View() implementation
- `blocks.go` (~280 lines) — Block types and construction
- `render_blocks.go` (~600 lines) — Block-to-string rendering
- `render_approval.go` (~300 lines) — TUI approval block rendering
- `approval.go` (~120 lines) — TUI approval state
- `help.go` (~90 lines) — Help overlay
- `input.go` (~130 lines) — TUI textarea input
- `focus.go` (~90 lines) — Tab/Enter focus logic
- `scroll.go` (~80 lines) — Viewport scroll logic
- `messages.go` (~100 lines) — tea.Msg types for event listener
- `doc.go` (~40 lines) — Package docs (rewrite for new scope)

**All test files for deleted code:**

- `update_test.go`, `render_blocks_test.go`, `approval_test.go`, `help_test.go`, `scroll_test.go`

**Files to KEEP:**

- `events.go` — All event types, `ApprovalResponse`, `TodoItem` (shared by inline + JSON)
- `followup.go` — `FollowUpFn`, `FollowUpResult` (shared by inline follow-up loop)

**After cleanup**, `executiontui` becomes a pure event/type definition package (~350 lines). Consider renaming to `executionevents` for clarity, but this is optional — it can be done later without behavioral change.

**Update `BUILD.bazel`**: Remove deleted source files, remove Bubbletea/bubbles/lipgloss deps, remove test files.

**Rewrite `doc.go`**: Update package documentation to reflect its new role as event type definitions.

---

## Phase 5.3: Remove Dead Exports Across Packages

`**pkg/toolrender/`:**

- Remove `RenderWaitingApproval` — zero callers after TUI removal
- Remove `RenderResultWithPreview` — only caller was `executiontui/render_blocks.go` (deleted)
- Assess `RenderExpanded`, `RenderExpandedWithBadge`, `HasDisplayableContent`, `DisplayLabel` — if only consumed by deleted TUI code, remove them too

`**pkg/termctl/`:**

- Unexport or remove `MoveUp`, `ClearDown`, `ClearLine` — zero callers anywhere. These were built speculatively in Phase 3.0. Keep them only if there's a concrete near-term use case; otherwise remove to avoid "just in case" code.

`**pkg/display/table.go`** (~200 lines):

- Remove entire file — `ApplyResultTable`, `NewApplyResultTable`, `AddResource`, `Render`, `RenderDryRun`, `ResourceType`, `ApplyStatus`, `AppliedResource`, `GetStatusIcon`, `TruncateID` have zero callers
- Update `BUILD.bazel`

`**internal/cli/cliprint/`:**

- Remove `PhaseReady` constant — zero callers

---

## Phase 5.4: Overlap Consolidation

`**display.GetTerminalWidth` vs `termctl.Width`:**

- `display.GetTerminalWidth()` is hardcoded to stdout fd
- `termctl.Width(w, defaultWidth)` works with any `io.Writer` (DI-compliant)
- Audit callers of `display.GetTerminalWidth()` — found in `run_display.go` and `run_display_summary.go`
- Migrate these callers to `termctl.Width(os.Stderr, defaultWidth)` if they write to stderr, or keep stdout version where appropriate
- If `display.GetTerminalWidth` has zero remaining callers after migration, remove it from `display/terminal.go`

`**display.IsTerminal` vs `termctl.IsSupported`:**

- `display.IsTerminal()` checks stdout
- `termctl.IsSupported(w)` checks any writer + TERM!=dumb
- `display.IsTerminal()` is used by `approval/interactive.go` — this stays because InteractivePrompter needs stdout TTY check specifically
- No migration needed here; different semantics

---

## Phase 5.5: Verify and Polish

- Run `go vet ./client-apps/cli/...` to catch any broken imports or unused variables
- Run `go build ./client-apps/cli/cmd/stigmer/` to verify compilation
- Run `go test ./client-apps/cli/cmd/stigmer/root/` and `go test ./client-apps/cli/pkg/...` to verify no test regressions
- Check for any orphaned Bazel deps that reference deleted packages
- Update `next-task.md` with Phase 5 session progress

---

## Risk Assessment

- **Low risk**: Dead export removal and `display/table.go` deletion — zero callers confirmed
- **Medium risk**: TUI path removal from `run_stream.go` and `run_session.go` — need to verify the switch statement refactoring doesn't alter behavior for the JSON path
- **Medium risk**: `executiontui` file deletion — must verify no transitive import pulls in deleted symbols

## Out of Scope

- **Pre-existing compile error in `run_create.go:114`** (`WorkspaceSource` reference from multi-source-workspace project) — this predates our project and belongs to that project's cleanup
- **Package rename** (`executiontui` to `executionevents`) — optional cosmetic change, can be done separately
- **climsg vs clioutput unification** — semantic overlap exists but both are actively used in different patterns; unifying them is a separate design effort
- **Remaining UX hardening phases** (3.1 stdout/stderr, 3.2 TUI epilogue) — both are moot with TUI removal

