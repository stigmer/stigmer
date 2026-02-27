# AD-09: Local Path Is a Proto-Level Workspace Source with Deployment Validation

**Date**: 2026-02-27
**Revised**: 2026-02-28 (v3 — restored to proto after multi-invocation analysis)
**Status**: Accepted (Revised v3)
**Context**: Workspace provisioning architecture discussion

## Decision History

| Version | Decision | Date |
|---------|----------|------|
| v1 | `LocalPathSource` as `oneof` variant in proto | 2026-02-27 |
| v2 | Removed from proto. Runner-level config only. | 2026-02-28 |
| v3 | **Restored to proto as `oneof` variant.** Deployment validation at runtime. | 2026-02-28 |

## Current Decision (v3)

`LocalPathSource` is a `oneof` variant in `WorkspaceSource`, alongside `GitRepoSource`. Cloud runners reject it at provisioning time with a clear error. This is a normal deployment-specific validation constraint, analogous to `GitRepoSource` rejecting SSH URLs via CEL validation.

```protobuf
message WorkspaceSource {
  oneof source {
    option (buf.validate.oneof).required = true;
    GitRepoSource git_repo = 1;
    LocalPathSource local_path = 2;
  }
}

message LocalPathSource {
  string path = 1 [(buf.validate.field).string.min_len = 1];
}
```

## Why v2 Was Wrong

The v2 approach placed `local_path` in runner-level config (environment variable or CLI flag), making it a single static value for the entire runner process. This breaks in real-world scenarios:

1. **Multiple CLI invocations**: User runs `stigmer run` from `/project-a` in one terminal and `/project-b` in another. Both hit the same runner. A single config can't handle two different paths.

2. **Mixed workspace sources**: Session A wants `local_path=/my-project`, Session B wants `git_repo=https://github.com/acme/other`. Per-session source selection requires the proto.

3. **Daemon runner architecture**: A long-lived runner serving multiple clients cannot have its workspace path fixed at startup.

4. **Valid domain states became inexpressible**: The per-session workspace path — a legitimate domain concept — had no way to be communicated from client to runner.

## Why v3 Is Correct

The v2 rationale was: "invalid states should be unrepresentable." This principle was applied too broadly. There are two distinct categories:

- **Schema constraint**: The message structure itself prevents invalid combinations (e.g., `oneof` prevents selecting two sources simultaneously). These belong in the proto.

- **Deployment validation**: A structurally valid message is rejected by a specific deployment mode (e.g., cloud can't access local paths, `GitRepoSource` rejects SSH URLs). These belong in runtime validation.

`LocalPathSource` on a cloud runner is the same category as an SSH URL in `GitRepoSource` — a valid proto message rejected by deployment-specific validation. The proto already uses this pattern.

## Implementation

The provisioner validates deployment mode at provisioning time:

```python
# In WorkspaceProvisioner.provision():
if workspace_source.HasField("local_path"):
    if not is_local_mode:
        raise WorkspaceProvisionError(
            "LocalPathSource is only supported in local mode. "
            "Use git_repo for cloud deployments."
        )
    path = workspace_source.local_path.path
    # validate exists, is directory, is absolute
    return ProvisionResult(
        root_dir=path,
        consumed_keys=[],
        source_type="local_path",
        ...
    )
```

## Consequences

- Each session specifies its own workspace source (local path, git repo, or empty)
- Multiple concurrent CLI invocations with different local paths work correctly
- Cloud runners reject `local_path` with a clear error at provisioning time
- The proto is self-documenting about all supported workspace sources
- Clients (web UI, API consumers) can conditionally show/hide `local_path` based on deployment context
