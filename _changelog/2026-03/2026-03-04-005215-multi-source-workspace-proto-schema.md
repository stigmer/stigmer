# Multi-Source Workspace Proto Schema

**Date**: March 4, 2026

## Summary

Added the `WorkspaceEntry` proto message and replaced the singular `workspace_source` field on `SessionSpec` with a repeated `workspace_entries` field. This is the foundational schema change that enables sessions to support multiple workspace sources (local paths and git repos) treated as a single unified workspace, mirroring VS Code's multi-root workspace model.

## Problem Statement

Sessions supported exactly one `WorkspaceSource` — a single git repo OR a single local path. This singular assumption was embedded across 6 architectural layers and approximately 33 code locations. Users need to operate across multiple directories or repositories in a single session (e.g., a frontend and backend repo together).

### Pain Points

- Cannot run `stigmer run agent reviewer --workspace ./frontend --workspace ./backend` to review across repos
- No way to provide an agent with context spanning multiple codebases
- Cloud mode has no mechanism for cloning multiple repos into named subdirectories

## Solution

Introduced a two-type composition in the proto schema:

- `WorkspaceEntry` — a new message that pairs a human-readable `name` with a `WorkspaceSource`, forming an addressable unit within a session's workspace
- `SessionSpec.workspace_entries` — a repeated field of `WorkspaceEntry`, replacing the singular `workspace_source` field

The existing `WorkspaceSource` message (oneof `GitRepoSource` | `LocalPathSource`) is unchanged. It remains a clean source-definition type; `WorkspaceEntry` adds identity on top.

## Implementation Details

### New proto message (`workspace.proto`)

```protobuf
message WorkspaceEntry {
  string name = 1 [(buf.validate.field).string.min_len = 1];
  WorkspaceSource source = 2 [(buf.validate.field).required = true];
}
```

- `name`: Required identifier, auto-derived by CLI from repo name or directory basename. Used in system prompt headings and as the clone subdirectory name in cloud mode.
- `source`: Required, reuses the existing `WorkspaceSource` oneof.

### Updated `SessionSpec` (`spec.proto`)

- Removed `WorkspaceSource workspace_source = 6`
- Added `reserved 6` and `reserved "workspace_source"` for wire-format safety
- Added `repeated WorkspaceEntry workspace_entries = 7`
- An empty list means no workspace (existing default behavior)

### Field naming decision

Chose `workspace_entries` over `workspace_sources` because the field holds `WorkspaceEntry` objects (name + source pairs), not raw `WorkspaceSource` objects. This avoids a naming mismatch that would propagate to every language stub (Go, Python, Java, TypeScript, Dart) and become increasingly misleading as entries gain more fields in the future.

### Stub regeneration

Ran `make protos` to regenerate Go and Python stubs. Verified:
- Go: `WorkspaceEntry` struct, `GetWorkspaceEntries() []*WorkspaceEntry` on `SessionSpec`
- Python: `WorkspaceEntry` class, `workspace_entries: RepeatedCompositeFieldContainer[WorkspaceEntry]` on `SessionSpec`

## Benefits

- Enables the entire multi-source workspace feature across all downstream layers (CLI, backend, system prompt)
- Clean type composition: `WorkspaceSource` stays pure, `WorkspaceEntry` adds identity
- Field naming (`workspace_entries`) is precise and future-proof across all 5 language stubs
- Reserved field 6 prevents wire-format conflicts with any residual serialized data

## Impact

- **Proto schema** (session/v1): Breaking change — `workspace_source` removed, `workspace_entries` added
- **Go CLI**: Intentionally broken until Phase 2 updates consumer code
- **Python backend**: Intentionally broken until Phase 3 updates consumer code
- **stigmer-cloud stubs**: Not yet regenerated; deferred until needed
- **No runtime impact yet** — this is a schema-only change; all downstream consumers need updates before the feature is functional

## Related Work

- Phase 2 (CLI): Will add repeatable `--workspace` flag and update all CLI plumbing
- Phase 3 (Backend Local): Will update provisioner for multiple local paths and system prompt generation
- Phase 4 (Backend Git): Will add subdirectory cloning for multiple git repos
- Phase 5 (Tests): Will add multi-workspace test coverage

---

**Status**: In Progress (Phase 1 of 5 complete)
**Timeline**: Phase 1 completed in one session
