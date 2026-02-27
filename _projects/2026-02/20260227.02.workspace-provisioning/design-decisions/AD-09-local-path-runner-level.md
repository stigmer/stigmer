# AD-09: Local Path Is a Runner-Level Concern, Not a Proto-Level Type

**Date**: 2026-02-27
**Revised**: 2026-02-28 (post architectural review)
**Status**: Accepted (Revised)
**Context**: Workspace provisioning architecture discussion

## Original Decision

`LocalPathSource` was a `oneof` variant in the `WorkspaceSource` proto message alongside `GitRepoSource`.

## Revised Decision

`local_path` does NOT appear in the proto schema. It is a runner-level configuration detail handled entirely within the agent-runner process.

## Rationale

`local_path` is ONLY valid in local mode -- it is physically impossible to provision in cloud mode (the cloud sandbox cannot access a path on the user's local machine). Putting it in the proto schema creates several problems:

1. **Schema advertises an impossible capability**: Any client reading the proto sees `LocalPathSource` and assumes it's a valid option. In cloud mode, it will always fail at runtime. This violates the principle that invalid states should be unrepresentable.

2. **Validation is deployment-dependent**: The same proto message is valid or invalid depending on which deployment mode the server is running in. Proto validation should be context-free.

3. **Proto pollution**: The wire protocol carries a type that only works for one deployment mode. Other clients (web UI, API consumers) would need to know about deployment modes to present the right options -- leaking infrastructure concerns into the API contract.

## Implementation

In local mode, the runner detects a `local_workspace_path` configuration:
- Via runner config environment variable: `STIGMER_LOCAL_WORKSPACE_PATH=/path/to/project`
- Or via CLI flag (future): `stigmer run agent my-agent --workspace /path/to/project`

The provisioner handles this as a special case:
```python
# In WorkspaceProvisioner.provision():
if runner_config.local_workspace_path:
    if not runner_config.is_local_mode():
        raise ConfigurationError(
            "local_workspace_path is only valid in local mode"
        )
    return ProvisionResult(
        root_dir=runner_config.local_workspace_path,
        consumed_keys=[],
        workspace_description="User's project directory",
        source_type="local_path",
        git_metadata=None,
    )
```

The proto `WorkspaceSource` only carries universally-valid concepts:
```protobuf
message WorkspaceSource {
  oneof source {
    GitRepoSource git_repo = 1;
  }
}
```

## Consequences

- Proto schema only contains deployment-agnostic workspace sources
- `local_path` support is entirely within the runner process (no network, no proto, no API)
- Clients (web UI, API consumers) never see `local_path` as an option
- The runner config handles validation (reject in cloud mode) at startup, not at request time
