---
name: Phase 3.1 Delete Migration
overview: Migrate the delete command from ad-hoc cliprint/fmt calls to structured CommandResult + Renderer, split delete.go to comply with the 250-line guideline, and remove the now-unused display functions from resource packages.
todos:
  - id: add-renderer-to-deletecontext
    content: Add `renderer` field to `deleteContext` struct and wire it in `executeDelete()`
    status: completed
  - id: split-delete-file
    content: Split delete.go into delete.go, delete_handlers.go, delete_cancel.go (all under 250 lines)
    status: completed
  - id: migrate-delete-confirmation
    content: Replace all 5 `DisplayDeleteConfirmation` calls with `CommandResult` + `dctx.renderer.Render()`
    status: completed
  - id: migrate-delete-result
    content: Replace all 5 `DisplayDeleteResult` calls with `CommandResult` + `dctx.renderer.Render()`
    status: completed
  - id: migrate-cancel-execution
    content: Replace `executeCancelExecution` cliprint/fmt calls and `DisplayCancelResult` with CommandResult
    status: completed
  - id: remove-dead-display-funcs
    content: Remove unused DisplayDeleteConfirmation, DisplayDeleteResult, DisplayCancelResult from 6 display.go files
    status: completed
  - id: update-build-files
    content: Update BUILD.bazel for root package (new source files) and resource packages (if imports change)
    status: completed
  - id: verify-build-test
    content: Run go build, go vet, go test on all affected packages; confirm zero cliprint in delete files
    status: completed
isProject: false
---

# Phase 3.1: Migrate Delete Command to CommandResult

## Scope

Migrate `delete.go` (401 lines) to use `clioutput.CommandResult` + `Renderer` for all output, split the file per the 250-line coding guideline, and clean up the now-unused `DisplayDeleteConfirmation` / `DisplayDeleteResult` functions in the resource display.go files.

**Explicitly out of scope**: get, list, apply, search commands (deferred pending resolution of the `--output table/yaml/json` vs `clioutput.OutputFormat` design tension).

## What Changes

### 1. Add `renderer` field to `deleteContext`

In [delete.go](client-apps/cli/cmd/stigmer/root/delete.go), the `deleteContext` struct gains a `renderer clioutput.Renderer` field, created alongside the confirmer in `executeDelete()`:

```go
dctx := &deleteContext{
    ref:       opts.Reference,
    orgID:     orgID,
    force:     opts.Force,
    confirmer: clioutput.NewConfirmer(opts.Force, os.Stderr),
    renderer:  clioutput.NewRenderer(clioutput.FormatHuman, os.Stdout, os.Stderr),
    conn:      conn,
}
```

The format is hardcoded to `FormatHuman` for now because delete has no `--output` flag. When the global `--output` flag lands in Phase 5, this becomes a one-line change.

### 2. Replace `DisplayDeleteConfirmation` calls with `CommandResult`

Each handler currently does:

```go
agent.DisplayDeleteConfirmation(agentRes)
```

This becomes a `CommandResult` built inline, rendered through `dctx.renderer`:

```go
result := clioutput.Warning("You are about to delete the following agent:")
result.AddSection("").
    Field("ID", agentRes.Metadata.Id).
    Field("Name", agentRes.Metadata.Name).
    Field("Slug", agentRes.Metadata.Slug).
    Field("Org", agentRes.Metadata.Org)
result.Hint("This action cannot be undone.")
dctx.renderer.Render(result)
```

Applied identically across all 5 handlers (agent, workflow, mcpserver, project, skill), with the resource-specific field extraction inlined. Each handler knows its own proto type, so the field extraction stays type-safe.

### 3. Replace `DisplayDeleteResult` calls with `CommandResult`

Each handler currently does:

```go
agent.DisplayDeleteResult(result)
```

This becomes:

```go
out := clioutput.Success("Agent deleted successfully")
out.AddSection("Deleted Agent").
    Field("ID", result.AgentID).
    Field("Name", result.Name).
    Field("Slug", result.Slug)
dctx.renderer.Render(out)
```

### 4. Migrate `executeCancelExecution` to use `CommandResult`

This function currently uses inline `cliprint.PrintWarning` / `cliprint.PrintInfo` / `fmt.Println`. It will create its own renderer (same pattern as the inline confirmer it already creates) and use `CommandResult` for both the confirmation display and the cancel result display.

The existing `execution.DisplayCancelResult` call will also be replaced.

### 5. Split `delete.go` into three files

Current: 1 file, 401 lines. Target: 3 files, each well under 250 lines.


| New file             | Contents                                                                             | Est. lines |
| -------------------- | ------------------------------------------------------------------------------------ | ---------- |
| `delete.go`          | `NewDeleteCommand`, `deleteOptions`, `deleteContext`, `executeDelete`, `routeDelete` | ~100       |
| `delete_handlers.go` | `deleteAgent`, `deleteWorkflow`, `deleteMcpServer`, `deleteProject`, `deleteSkill`   | ~150       |
| `delete_cancel.go`   | `isDeleteExecutionType`, `executeCancelExecution`                                    | ~70        |


All files remain in `package root`. No new packages. BUILD.bazel updated to list the new source files.

### 6. Remove unused display functions

After migration, these functions become dead code. Remove them from the resource display.go files:

- `agent.DisplayDeleteConfirmation`, `agent.DisplayDeleteResult`
- `workflow.DisplayDeleteConfirmation`, `workflow.DisplayDeleteResult`
- `mcpserver.DisplayDeleteConfirmation`, `mcpserver.DisplayDeleteResult`
- `project.DisplayDeleteConfirmation`, `project.DisplayDeleteResult`
- `skill.DisplayDeleteConfirmation`, `skill.DisplayDeleteResult`
- `execution.DisplayCancelResult`

Each display.go file will shrink. Their BUILD.bazel files may need updating if any imports become unused.

### 7. Remove `cliprint` import from delete files

After migration, delete files should have zero `cliprint` imports. The `fmt.Fprintln(os.Stderr, "Aborted.")` calls remain (they're a single line, not worth a CommandResult). The `cliprint` import is removed from the package if no other code in the file uses it.

## Key Design Decisions to Preserve

- **Abort returns `nil`**: When user types "N" at confirmation, handler returns `nil` (not error). This stays.
- **Non-terminal stdin denies**: `InteractiveConfirmer` returns false on non-TTY. This stays.
- `**deleteContext` pattern**: Proven in Phase 2, extended with `renderer` field.
- **Hardcoded `FormatHuman`**: Delete has no `--output` flag. No speculative abstraction until Phase 5 needs it.

## Verification

- `go build ./client-apps/cli/cmd/stigmer/...` clean
- `go vet ./client-apps/cli/cmd/stigmer/root/` clean
- `go test ./client-apps/cli/pkg/clioutput/...` all pass
- `go test ./client-apps/cli/cmd/stigmer/root/...` all pass
- No file over 250 lines in the changed set
- Zero `cliprint` imports in delete files
- Zero `DisplayDeleteConfirmation` / `DisplayDeleteResult` callers remain

## Design Surprise (Logged for Future)

The existing `--output table/yaml/json` on get/list is a **data serialization format** (raw resource YAML/JSON), fundamentally different from `clioutput.OutputFormat` (`human/json/quiet`) which is **CLI chrome format**. These two concepts must not be conflated. Phase 3.2 (get/list migration) requires a separate design decision on how they coexist.