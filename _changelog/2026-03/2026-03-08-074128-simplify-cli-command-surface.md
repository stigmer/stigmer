# Simplify CLI Command Surface: 21 Commands to 16

**Date**: March 8, 2026

## Summary

Reduced the Stigmer CLI from 21 visible commands to 16 by merging `backend` and `context` into `config`, removing the speculative `doctor` and `fix` commands, and folding the standalone `resources` command into `list types`. The "Configuration" group shrinks from 7 top-level commands to 2, eliminating a junk-drawer effect that confused new users.

## Problem Statement

The CLI's Configuration group had become a dumping ground for unrelated commands: terminal repair (`fix`), diagnostics (`doctor`), shell completions (`completion`), meta-help (`resources`), and three separate configuration surfaces (`backend`, `config`, `context`) that all wrote to the same `~/.stigmer/config.yaml` file.

### Pain Points

- **Three config surfaces for one file**: `backend`, `config`, and `context` each managed a slice of the same YAML configuration. Users had to learn the semantic difference between "backend configuration", "CLI configuration", and "CLI context" — unnecessary cognitive load.
- **`fix` advertised crashes as normal**: A top-level terminal-repair command signaled to every user that TUI crashes were expected. The proper fix belongs in the TUI's exit/signal handlers, not a dedicated escape hatch.
- **`doctor` was mostly stubs**: MCP health was "not yet implemented", auth validation was "not yet available". The command was speculatively added without concrete use cases.
- **`resources` was miscategorized**: It listed available resource types — pure introspection that belongs alongside `list agents`, `list workflows`, etc., not in the Configuration group.

## Solution

1. **Merge `backend` and `context` into `config`** — one command, one mental model: "all my CLI configuration lives under `config`".
2. **Remove `fix`** — dead weight; terminal restoration should be handled by TUI exit handlers.
3. **Remove `doctor`** — bring it back when there are concrete, non-stub checks with real value.
4. **Fold `resources` into `list types`** — `stigmer list types` is unambiguous (unlike `list resources` which could mean "list all resource instances across types") and consistent with the existing pattern of `stigmer list agents`, `stigmer list workflows`.

## Implementation Details

### Phase 1: Merge `backend` + `context` into `config`

- Added `NewBackendCommand()` and `NewContextCommand()` as subcommands of `NewConfigCommand()` in `config.go`.
- Removed their standalone registrations from `root.go`.
- `backend.go` and `context.go` files unchanged — command constructors simply registered under a different parent.

### Phase 2: Remove `fix`

- Deleted `fix.go` (52 lines — ANSI sequences + `stty sane`).
- Removed registration from `root.go`.

### Phase 3: Remove `doctor`

- Deleted `doctor.go`, `doctor_checks.go`, `doctor_checks_runtime.go`, `doctor_test.go` (887 lines total).
- Removed registration from `root.go`.

### Phase 4: Fold `resources` into `list types`

- Added `isTypesType()` check in `list.go` matching "types" / "type" as a special-case pseudo-type.
- Added `--verb` flag to the list command (only meaningful for `list types`).
- Removed `NewResourcesCommand()` cobra constructor from `resources.go`; kept all implementation functions (`collectResources`, `displayResources`, `ResourceInfo`).
- These functions now back the new `executeListTypes()` entry point called by `list.go`.

### Phase 5: Reference updates

Updated hint strings and error messages in 7 source files + 1 test:

| File | Old reference | New reference |
|------|--------------|---------------|
| `run_resolve.go` | `stigmer context set` | `stigmer config context set` |
| `draft_handler.go` | `stigmer context show` | `stigmer config context show` |
| `verb_helpers.go` | `stigmer context set` | `stigmer config context set` |
| `server.go` | `stigmer context set` | `stigmer config context set` |
| `apply.go` | `stigmer context set` | `stigmer config context set` |
| `apply_org_test.go` | assertion string | updated to match new path |
| `context.go` | example strings | `stigmer config context set` |
| `mcp_server.go` | comment: `stigmer backend` | `stigmer config backend` |

Updated 13 documentation files: `COMMANDS.md`, `README.md`, `IMPLEMENTATION_SUMMARY.md`, `Makefile`, and 9 files under `docs/`.

## Benefits

- **Simpler onboarding**: New users see 16 commands instead of 21. The Configuration group has 2 entries instead of 7.
- **Single config mental model**: `stigmer config` is the one place for all CLI configuration — backend, context, key-value settings.
- **Cleaner introspection**: `stigmer list types` sits naturally alongside `stigmer list agents` instead of hiding in Configuration.
- **Reduced dead code**: 1,072 lines removed (net -982 with additions), eliminating stub-heavy doctor checks and a terminal repair hack.

## Impact

- **CLI users**: Command paths change for `backend` and `context` (now under `config`). `doctor`, `fix`, and standalone `resources` are gone.
- **Documentation**: 13 files updated to reference new paths.
- **Tests**: `apply_org_test.go` assertion updated. Doctor tests deleted. All remaining tests pass.

## Related Work

- [Split `stigmer run` and `stigmer resume` into dedicated commands](2026-03-08-021252-split-run-and-resume-commands.md) — recent command restructuring
- [CLI inline streaming UX polish](2026-03-04-082218-cli-inline-streaming-ux-polish.md) — TUI improvements that make `fix` unnecessary
- [Proto-driven CLI type registry](../../_changelog/2026-02/2026-02-07-141710-proto-driven-cli-type-registry.md) — created the `resources` command now folded into `list types`

---

**Status**: Production Ready
**Timeline**: Single session
