# T04: Add `--workspace` Flag to CLI for Workspace Provisioning

**Status**: PENDING
**Created**: 2026-02-28

## Objective

Add `--workspace` flag to `stigmer run` so users can specify a workspace source when running agents. This unlocks the entire workspace provisioning pipeline that's already implemented in the backend.

## Current State

- **Proto**: `SessionSpec.workspace_source` field exists (position 6 in `session/v1/spec.proto`)
- **Proto**: `WorkspaceSource` with `GitRepoSource` and `LocalPathSource` defined in `session/v1/workspace.proto`
- **Backend**: `WorkspaceProvisioner` fully wired in `execute_graphton.py`
- **Backend**: Feature flag `STIGMER_WORKSPACE_PROVISIONING_ENABLED` gates the path (default: disabled)
- **CLI**: No `--workspace` flag, `workspace_source` never set on session creation

## Tasks

### 4.1 Add `--workspace` flag to `stigmer run`

**File**: `client-apps/cli/cmd/stigmer/root/run.go`

Add flag:
```go
cmd.Flags().StringVar(&workspaceFlag, "workspace", "", 
    "Workspace source: git URL (git://repo#branch) or local path (/path/to/dir)")
```

### 4.2 Parse workspace flag into proto

**File**: `client-apps/cli/cmd/stigmer/root/run_create.go` (or new file `run_workspace.go`)

Parse the `--workspace` value:
- If starts with `git://` or `https://` or ends with `.git` → `GitRepoSource`
  - Extract URL, optional `#branch` suffix, optional `@commit` suffix
  - Example: `--workspace https://github.com/user/repo#main`
- If starts with `/` or `./` or `~` → `LocalPathSource`
  - Resolve to absolute path
  - Example: `--workspace /Users/me/project`
- If empty → no workspace source (existing behavior)

### 4.3 Wire to session creation

Set `workspace_source` on the session creation request. Currently sessions are created implicitly via the execution flow. Need to verify where `SessionSpec` is populated and add the workspace source there.

**Key files to check**:
- `run_create.go` — `createAgentExecution()` function
- Proto: `AgentExecutionSpec` vs `SessionSpec` — workspace is session-level, not execution-level

### 4.4 Enable feature flag for testing

Document how to enable:
```bash
export STIGMER_WORKSPACE_PROVISIONING_ENABLED=1
stigmer server start
```

Or add to stigmer server configuration.

### 4.5 End-to-end verification

Test matrix:

| Scenario | Command | Expected |
|----------|---------|----------|
| Empty workspace (default) | `stigmer run agent my-agent -m "hello"` | Works as before |
| Git workspace | `stigmer run agent my-agent --workspace https://github.com/user/repo -m "review this"` | Clones repo, agent sees files |
| Local path | `stigmer run agent my-agent --workspace ./my-project -m "review this"` | Uses local dir, platform files isolated |
| Invalid git URL | `stigmer run agent my-agent --workspace git://nonexistent -m "..."` | Clear error message |
| Local path in cloud | (cloud mode) `--workspace /local/path` | Rejected with clear error |

## Dependencies

- Workspace provisioning backend: **DONE** (merged to main)
- Platform file isolation: **DONE** (merged to main)
- Feature flag: exists, just needs enabling

## Architecture Notes

### Session vs Execution

`workspace_source` is on `SessionSpec`, not `AgentExecutionSpec`. This means:
- Workspace persists across executions within a session
- First execution provisions the workspace; subsequent reuse it
- The CLI's auto-create-session flow needs to pass workspace source

### Credential Flow

When using git workspaces, the `GITHUB_TOKEN` (or equivalent) must be:
1. Available in the merged environment (agent env vars + runtime env)
2. Consumed by the provisioner for git clone
3. Stripped from the agent's environment (credential scoping)

This is already handled in the backend — the CLI just needs to pass the workspace source.

## Files to Create/Modify

| Action | File |
|--------|------|
| MODIFY | `client-apps/cli/cmd/stigmer/root/run.go` (add flag) |
| CREATE | `client-apps/cli/cmd/stigmer/root/run_workspace.go` (parsing + validation) |
| MODIFY | `client-apps/cli/cmd/stigmer/root/run_create.go` (wire workspace_source) |
| CREATE | `client-apps/cli/cmd/stigmer/root/run_workspace_test.go` (tests) |

## Success Criteria

- `--workspace` flag appears in `stigmer run --help`
- Git workspace: repo cloned, agent executes with files visible
- Local path: agent executes, platform files isolated in `~/.stigmer/sessions/`
- Empty workspace: no regression, works as before
- Git diff artifact generated for git workspaces
- Clear error messages for invalid inputs
