# Phase 3: Integration Wire-Up — Workspace Provisioning

**Date**: February 28, 2026

## Summary

Wired the workspace provisioner into the agent execution flow, completing the critical integration between the provisioner module (Phase 2) and `execute_graphton.py`. The entire provisioning path is gated behind a feature flag, with idempotent git provisioning, credential stripping, and post-execution git diff artifact generation. 97 tests passing with zero regressions.

## Problem Statement

The workspace provisioner module (Phase 2) was complete but not connected to the execution flow. The agent runner still used the old workspace initialization path. The provisioner needed to be called at the right point in the execution lifecycle, with credentials available before provisioning and stripped after, and the results (root_dir, consumed_keys, git_metadata) properly consumed by downstream steps.

### Pain Points

- Environment merge happened too late in the execution flow — after skills and attachments, but the provisioner needs `GITHUB_TOKEN` from the merged environment
- No idempotent handling: subsequent executions in the same session would fail when encountering an already-cloned workspace
- No mechanism to strip provisioning credentials (`GITHUB_TOKEN`) from the agent's runtime environment
- Default input file path (`inputs/`) could collide with user project directories
- No way to capture the agent's code changes as a downloadable patch artifact

## Solution

Seven coordinated changes to the execution flow, each independently testable:

1. **Idempotent git provisioning** — Detect existing `.git`, recover corrupted partial state, setup platform-file excludes
2. **Sync/async alignment** — Fix latent bug where `provision()` was `async def` but all operations were synchronous
3. **Environment merge reorder** — Move environment merge before provisioning so credentials are available
4. **Provisioner wire-up** — Feature-flagged integration with backend re-creation for local_path
5. **Credential stripping** — Remove consumed keys from agent environment before MCP config and status tracking
6. **Input file path** — Default path changed from `inputs/` to `.stigmer-inputs/` (namespaced, collision-free)
7. **Git diff artifact** — Post-execution patch generation excluding platform directories

## Implementation Details

### Idempotent Provisioning (`git.py`)
Three workspace states detected: empty (fresh clone), `.git` exists (reuse metadata), non-empty without `.git` (clean and re-clone). Platform directories added to `.git/info/exclude` after every provisioning operation.

### Execution Flow Reorder (`execute_graphton.py`)
Environment merge moved from Step 4 to Step 2.8, immediately after `initialize_workspace`. Safety analysis confirmed nothing between the old and new positions depends on `merged_env_vars`.

### Feature Flag
`STIGMER_WORKSPACE_PROVISIONING_ENABLED` environment variable. When OFF (default), zero behavior change to existing executions. The entire provisioning path — credential stripping, backend re-creation, git diff artifact — is skipped.

### Git Diff Artifact
`_generate_git_diff_artifact()` runs `git diff -- ':!.stigmer-inputs' ':!bin/skills'` and uploads the output as `{execution_id}.patch`. Non-fatal: failures are logged and execution continues.

## Benefits

- **Zero-risk deployment**: Feature flag means existing production behavior is completely unchanged until explicitly enabled
- **Self-healing workspaces**: Idempotent provisioning handles resume, crash recovery, and re-provisioning without external state
- **Credential security**: `GITHUB_TOKEN` used for git clone is never leaked to MCP config placeholders or status reporting
- **Clean patches**: Git diff artifacts capture only meaningful agent changes, excluding platform noise

## Impact

- `execute_graphton.py`: Major restructuring of the setup flow (+359/-147 lines)
- `sources/git.py`: Extended with idempotent provisioning (+141 lines)
- `provisioner.py`: Sync fix (5 lines)
- Test suite: 97 passing (9 new idempotent tests, 8 async→sync test updates)

## Related Work

- Phase 0: WorkspaceBackend extraction (foundation)
- Phase 1: Proto definitions for WorkspaceSource
- Phase 2: Provisioner module implementation
- **Phase 4 (next)**: Platform-file isolation — addresses the architectural gap where platform files pollute `local_path` workspaces

---

**Status**: ✅ Production Ready (behind feature flag)
**Timeline**: Single session
