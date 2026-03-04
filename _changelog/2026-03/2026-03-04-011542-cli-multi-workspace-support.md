# CLI Multi-Workspace Support (Phase 2)

**Date**: March 4, 2026

## Summary

Migrated the entire CLI pipeline from singular `--workspace` to repeatable `--workspace` / `-w`, enabling users to pass multiple workspace sources (local paths and git repos) to a single agent session. This is the CLI layer of the multi-source workspace feature, threading `[]*WorkspaceEntry` through flag parsing, preparation, session creation, and attachment processing.

## Problem Statement

The CLI supported exactly one `--workspace` flag per invocation — one git repo OR one local path. Users working across multiple directories or repos (e.g., a frontend and backend side-by-side) had no way to give an agent access to both in a single session.

### Pain Points

- Single workspace forced users to choose one repo, losing cross-repo context
- No path toward the VS Code multi-root workspace model that the platform aims to support
- Phase 1 proto schema changes (`repeated WorkspaceEntry workspace_entries`) left the CLI with compile errors that needed resolving

## Solution

Implemented Phase 2 of the multi-source workspace plan: a complete CLI pipeline migration from singular `*WorkspaceSource` to plural `[]*WorkspaceEntry`, organized in four logical sections:

- **2a (Flag + Parsing)**: Repeatable `--workspace` / `-w` flag with `StringArrayVarP`, new `parseWorkspaceEntries` function with auto-name derivation and uniqueness validation
- **2b (Plumbing Structs)**: Migrated `preparedAgentExec` and `resolvedAgentExecInput` structs, updated all callers in `routeRun` and draft handler
- **2c (Session Creation)**: Updated `createSessionForAgent` to accept entries and set `SessionSpec.WorkspaceEntries`
- **2d (Attachments)**: Multi-root containment check in `ProcessFiles`, new `localWorkspaceRoots` function

## Implementation Details

### New Functions (`run_workspace.go`)

- `parseWorkspaceEntries(workspaces []string, branch, commit string)` — orchestrates multi-workspace parsing with branch/commit validation and name uniqueness checks
- `deriveEntryName(workspace string)` — auto-derives a short identifier from a workspace value (repo name from URL, directory basename from path)
- `deriveGitRepoName(rawURL string)` — extracts repo name from HTTPS URL (strips `.git`, trailing slashes)
- `deriveLocalDirName(path string)` — resolves path to absolute, returns `filepath.Base`

### Pipeline Migration

`--workspace string` / `StringVar` changed to `--workspace []string` / `StringArrayVarP` with `-w` shorthand, consistent with `--attach` and `--env` patterns. All structs and callers updated from `WorkspaceSource` to `WorkspaceEntries` with `len() > 0` nil-safety checks replacing pointer nil checks.

### Multi-Root Attachment Processing

`ProcessFiles` now accepts `[]string` workspace roots. Extracted `matchWorkspaceRoot` method that iterates roots (first match wins) for workspace-relative file reference detection. The `workspaceRelativePath` function is unchanged — it's called per (path, root) pair.

### Validation Rules

- `--branch` / `--commit` with zero workspaces → error
- `--branch` / `--commit` with >1 workspace → error (applies only to single git workspace)
- Duplicate derived names → error with clear message showing both conflicting values
- SSH URLs → rejected with HTTPS guidance (unchanged from single-workspace)

## Benefits

- Users can now pass `stigmer run agent code-reviewer -w ./frontend -w ./backend -m "Review both"`
- Clean foundation for Phase 3 (backend provisioner multi-path support) and Phase 4 (multi-repo cloud cloning)
- Resolves all CLI compile errors introduced by Phase 1 proto migration
- 11 new tests covering multi-workspace parsing and name derivation, all existing tests preserved

## Impact

- **CLI users**: New repeatable `-w` flag for multi-workspace sessions
- **Backend**: No backend changes — `SessionSpec.WorkspaceEntries` is populated, backend provisioning is Phase 3
- **API contract**: `SessionSpec` now receives `repeated WorkspaceEntry` instead of singular `WorkspaceSource` (Phase 1 proto change)

## Files Changed

| File | Change |
|------|--------|
| `run_workspace.go` | +107 lines: 4 new functions (parsing + name derivation) |
| `run_workspace_test.go` | +176 lines: 11 new tests |
| `run_agent_exec.go` | Struct migration + caller updates |
| `run.go` | `localWorkspaceRoots`, `routeRun`, help text + examples |
| `run_create.go` | Session creation signature |
| `run_attachments.go` | Multi-root `ProcessFiles` + `matchWorkspaceRoot` |
| `run_attachments_test.go` | Updated for `[]string` signature |
| `draft_handler.go` | Pass-through update |

## Related Work

- [Multi-Source Workspace Proto Schema](2026-03-04-005215-multi-source-workspace-proto-schema.md) — Phase 1 (proto layer)
- Phase 3 (backend provisioner for multiple local paths) — next milestone
- Phase 4 (backend provisioner for multiple git repos) — future
- Phase 5 (tests + polish) — future

---

**Status**: ✅ Production Ready
**Timeline**: Phase 2 of 5 in the multi-source workspace feature
