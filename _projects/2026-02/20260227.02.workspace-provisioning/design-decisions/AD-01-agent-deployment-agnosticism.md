# AD-01: Agent Is Deployment-Agnostic

**Date**: 2026-02-27
**Status**: Accepted
**Context**: Workspace provisioning architecture discussion

## Decision

The agent code must have ZERO deployment-mode conditionals. The agent receives a `root_dir` and works in it. It never asks "am I in cloud or local?" because that question is meaningless to the domain.

## Rationale

If agents behave differently in local vs cloud, then agent developers (or skill authors) need to think about deployment context. That's a failure of the platform. The whole point of Stigmer is that an agent definition is portable -- defined once, runs everywhere.

The divergence between local and cloud exists ONLY in:
1. **Provisioning layer** -- how the workspace is set up (infrastructure concern)
2. **Input delivery layer** -- how files arrive (storage download vs local path)
3. **Output delivery layer** -- how results reach the user (download URL vs direct file access)

None of these are agent concerns. They are platform plumbing hidden below the abstraction boundary.

## Consequences

- All `if worker_config.is_local_mode()` checks in agent execution code must be removed or pushed down into infrastructure modules.
- `FilesystemBackend` and `DaytonaBackend` provide the same interface to the agent.
- Skills, tools, and agent logic never branch on deployment mode.
- The `WorkspaceProvisioner` handles all mode-specific logic before the agent starts.
