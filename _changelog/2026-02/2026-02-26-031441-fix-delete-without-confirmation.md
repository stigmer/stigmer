# Fix Critical Delete-Without-Confirmation Bug

**Date**: February 26, 2026

## Summary

Fixed a critical safety bug where `stigmer delete` proceeded to destroy resources without waiting for user confirmation. All 6 delete handlers (agent, workflow, mcpserver, project, skill, execution cancel) now block on a real y/N prompt before executing destructive operations. This is the first integration of the new `clioutput` package with existing command handlers.

## Problem Statement

Every delete handler in the Stigmer CLI showed a warning display but then unconditionally proceeded to delete the resource. The `--force` flag gated the display text, but deletion happened regardless of whether the user wanted to proceed.

### Pain Points

- Running `stigmer delete agent my-agent` would display a warning and then immediately delete -- no chance to abort
- No TTY safety: piped/scripted invocations could accidentally destroy resources
- The "confirmation" was purely visual theater -- it looked like it asked for confirmation but never actually waited for input
- Every one of the 6 delete paths had this same bug

## Solution

Wired the `clioutput.Confirmer` interface (built in Phase 1) into all delete handlers. `InteractiveConfirmer` reads a y/N answer from the terminal; `AlwaysYesConfirmer` auto-confirms when `--force` is set. Non-TTY stdin safely denies by default.

Introduced a `deleteContext` struct to bundle handler dependencies (ref, orgID, force, confirmer, conn), replacing flat parameter lists that were approaching 5+ arguments and needed extensibility for future phases.

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `client-apps/cli/cmd/stigmer/root/delete.go` | +99 lines, -48 lines |
| `client-apps/cli/cmd/stigmer/root/BUILD.bazel` | +1 line (clioutput dep) |

### Structural Changes

- **`deleteContext` struct**: Unexported struct bundling `ref`, `orgID`, `force`, `confirmer`, and `conn`. Created once in `executeDelete`, threaded through `routeDelete` to all handlers.
- **`routeDelete` signature**: Simplified from `(info, ref, orgID, force, conn)` to `(info, dctx)`.
- **5 resource handlers** (`deleteAgent`, `deleteWorkflow`, `deleteMcpServer`, `deleteProject`, `deleteSkill`): Signature changed to `(dctx *deleteContext)`. Each `!force` block now calls `dctx.confirmer.Confirm("Proceed with deletion? [y/N]")` and handles abort.
- **`executeCancelExecution`**: Separate flow (own connection setup), creates `NewInteractiveConfirmer` inline with `Confirm("Proceed with cancellation? [y/N]")`.

### Behavioral Changes

| Scenario | Before | After |
|----------|--------|-------|
| `stigmer delete agent foo` | Deletes unconditionally | Prompts y/N, deletes only on "y" |
| `stigmer delete agent foo --force` | Deletes silently | Deletes silently (unchanged) |
| User types "N" at prompt | N/A | Prints "Aborted.", exits cleanly |
| Piped/non-TTY stdin | Deletes unconditionally | Safely aborts (non-TTY returns false) |

## Benefits

- **Safety**: Destructive operations now require explicit user confirmation
- **Script safety**: Non-interactive environments default to deny; `--force` is required for automation
- **Clean architecture**: `deleteContext` struct provides a clean extensibility point for Phase 3 (adding `renderer`)
- **Zero regressions**: All existing tests pass; `go build` and `go vet` clean

## Impact

- **End users**: Delete operations now behave as expected -- they actually ask before destroying resources
- **Script/CI users**: Must add `--force` to automated delete commands (intentional breaking change for safety)
- **Codebase**: First integration of `clioutput` package with existing command handlers, establishing the pattern for Phase 3 migration

## Related Work

- Phase 1: Core `clioutput` package foundation (CommandResult, Renderer, Confirmer) -- completed in prior session
- Phase 3: Migrate all commands to CommandResult + renderer -- next phase
- Phase 4: Consolidate 8 duplicate display.go files -- future phase

---

**Status**: Production Ready
**Timeline**: Part of CLI Output System Refactor (Phase 2 of 6)
