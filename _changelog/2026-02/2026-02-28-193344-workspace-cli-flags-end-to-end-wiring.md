# Workspace CLI Flags: End-to-End Provisioning Wiring

**Date**: February 28, 2026

## Summary

Added `--workspace`, `--branch`, and `--commit` flags to `stigmer run agent`, completing the last mile of workspace provisioning from CLI to backend. Users can now run agents against git repositories or local directories with a single command. The implementation required zero proto or backend changes by having the CLI explicitly create sessions with workspace configuration.

## Problem Statement

The workspace provisioning pipeline was fully implemented in the backend (WorkspaceProvisioner, git clone, local path mounting, credential scoping) but had no CLI surface. Users had no way to specify a workspace source when running agents. The `workspace_source` field on `SessionSpec` was defined but never populated.

### Pain Points

- Backend workspace provisioning existed but was unreachable from the CLI
- No `--workspace` flag on `stigmer run`
- The backend's auto-create-session flow had no mechanism to forward workspace configuration from execution requests
- Users couldn't run agents against git repos or local directories

## Solution

Three new CLI flags that map cleanly to the `WorkspaceSource` proto:

```
stigmer run agent code-reviewer --workspace https://github.com/acme/app -m "Review"
stigmer run agent code-reviewer --workspace https://github.com/acme/app --branch feature/auth
stigmer run agent refactorer --workspace . -m "Refactor the auth module"
```

When `--workspace` is provided, the CLI creates the Session explicitly via `SessionCommandController.Create()` with `workspace_source` set on the `SessionSpec`, then creates the AgentExecution referencing that session. Without `--workspace`, the existing auto-create flow is unchanged.

## Implementation Details

### Architecture Decision

`workspace_source` lives on `SessionSpec`, not `AgentExecutionSpec`. The backend's `createSessionIfNeededStep` auto-creates sessions with a hardcoded spec and has no workspace passthrough. Rather than adding a pass-through field to the execution proto (domain leakage), the CLI creates the session explicitly when workspace is needed. This required zero proto or backend changes.

### New Files

- **`run_workspace.go`** (104 lines): Pure parsing logic converting CLI flags to `WorkspaceSource` proto. Handles git URL detection, SSH rejection with helpful error, local path resolution (~ expansion, absolute path, directory validation).

- **`run_workspace_test.go`** (184 lines): 11 test cases covering empty workspace (backward compat), HTTPS URLs with/without branch/commit, SSH rejection, local paths, relative path resolution, and all error conditions.

### Modified Files

- **`run.go`**: Added `--workspace`, `--branch`, `--commit` flags and their `runOptions` fields. Added workspace parsing as a step in `executeRun()`. Updated `routeRun()` to thread `WorkspaceSource` to `runAgent()`. Added clear error when `--workspace` is used with workflows.

- **`run_handlers.go`**: Updated `runAgent()` with an explicit session creation branch. When workspace is provided, reads `agent.Status.DefaultInstanceId`, calls `createSessionForAgent()`, then creates execution with `session_id`.

- **`run_create.go`**: Added `createSessionForAgent()` that builds a `Session` proto matching the backend's auto-create pattern (same subject sentinel) with `workspace_source`, calls `SessionCommandController.Create()`.

### Data Flow

```
Without --workspace (unchanged):
  resolveAgent -> createAgentExecution(agentID) -> backend auto-creates session -> stream

With --workspace (new):
  resolveAgent -> parseWorkspaceSource -> createSessionForAgent(instanceID, workspaceSource) -> createAgentExecution(sessionID) -> stream
```

## Benefits

- Users can run agents against git repos with a single command
- Users can run agents against local directories for immediate file operations
- Zero backend changes required — the existing provisioner reads `session.spec.workspace_source` unchanged
- Clean separation: workspace is a session concept, expressed at session creation time
- Full backward compatibility — omitting `--workspace` preserves existing behavior
- Validation catches SSH URLs, nonexistent paths, and flag misuse with clear messages

## Impact

- **CLI users**: Can now specify workspace sources when running agents
- **End-to-end flow**: Completes the pipeline from CLI -> Session -> Backend Provisioner
- **Backend**: No changes needed — existing `WorkspaceProvisioner` and feature flag work unchanged
- **Proto**: No changes needed — existing `WorkspaceSource` oneof is used as-is

## Related Work

- Workspace provisioning backend (Phase 3): `WorkspaceProvisioner`, git clone, local path support
- Platform file isolation: virtual mount, session-scoped workspace directories
- Seedpack root migration (T03): CLI-driven bootstrap, `stigmer apply` subprocess
- Credential scoping (AD-05): GITHUB_TOKEN consumed by provisioner, stripped from agent env

---

**Status**: Production Ready
**Timeline**: T04 of the e2e-declarative-workspace project
