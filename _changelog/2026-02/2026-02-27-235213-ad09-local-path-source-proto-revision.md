# AD-09 v3: LocalPathSource Restored to Proto Schema

**Date**: February 27, 2026

## Summary

Revised architectural decision AD-09 to restore `LocalPathSource` as a proper `oneof` variant in the `WorkspaceSource` proto message. The previous approach (runner-level config) was fundamentally incompatible with multiple concurrent CLI invocations targeting different project directories. This change enables per-session workspace path specification through the wire protocol.

## Problem Statement

AD-09 v2 placed local workspace paths in runner-level configuration (environment variable or CLI flag), making it a single static value per runner process. This created an architectural dead end.

### Pain Points

- Multiple CLI invocations (e.g., `stigmer run` from `/project-a` and `/project-b` simultaneously) cannot work when the runner has a single static workspace path
- A shared daemon runner serving multiple clients cannot have its workspace path fixed at startup
- Mixed workspace modes (local path for session A, git clone for session B) are inexpressible
- Valid domain states (per-session workspace paths) had no representation in the API contract

## Solution

Restored `LocalPathSource` as a `oneof` variant in `WorkspaceSource`, alongside `GitRepoSource`. Cloud runners reject it at provisioning time with a clear error — the same deployment-validation pattern already used by `GitRepoSource` for SSH URL rejection.

The key insight: "invalid states should be unrepresentable" is a schema-level constraint (structural), not a deployment-level constraint. Deployment-mode validation belongs at runtime, not in the proto schema.

## Implementation Details

Proto change (`workspace.proto`):
```protobuf
message WorkspaceSource {
  oneof source {
    option (buf.validate.oneof).required = true;
    GitRepoSource git_repo = 1;
    LocalPathSource local_path = 2;  // NEW
  }
}

message LocalPathSource {
  string path = 1 [(buf.validate.field).string.min_len = 1];
}
```

Supporting updates:
- Go and Python stubs regenerated
- Project plan (T01_0_plan.md) updated: AD-09 rewrite, Phase 1 proto section, Phase 2 provisioner section, tests, backward compatibility
- Design decisions document rewritten with full v1/v2/v3 decision history
- Phase 0 code reviewed — no changes needed (already workspace-source-agnostic)

## Benefits

- **Multi-invocation support**: Each session specifies its own workspace source independently
- **Domain accuracy**: The proto accurately models all supported workspace sources
- **Self-documenting API**: Clients see all valid workspace options in the schema
- **Consistent validation pattern**: Deployment constraints handled uniformly at runtime
- **Backward compatible**: Additive change, `buf breaking` passes clean

## Impact

- **Proto schema**: One new message (`LocalPathSource`), one new `oneof` field — additive
- **Phase 2 provisioner**: Now reads from `WorkspaceSource.local_path` per-session instead of runner config
- **CLI (future)**: Can pass `--workspace /path` which maps directly to `LocalPathSource.path` on session creation
- **Cloud deployment**: Unaffected — cloud runners reject `LocalPathSource` with clear error

## Related Work

- Phase 0: WorkspaceBackend Extraction (completed, unaffected by this change)
- Phase 1: Proto Changes (this revision completes Phase 1)
- Phase 2: Workspace Provisioner Module (next — benefits from per-session workspace source)

---

**Status**: Production Ready
**Timeline**: ~2 hours (architectural analysis + implementation + validation)
