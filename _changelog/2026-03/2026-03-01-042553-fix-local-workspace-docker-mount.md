# Fix LocalPathSource Workspace Provisioning in Docker Agent-Runner

**Date**: March 1, 2026

## Summary

The `--workspace` flag on `stigmer draft` and `stigmer run` commands failed with "Path does not exist" when pointing to a host filesystem directory. The agent-runner Docker container was started without mounting the user's home directory, making host paths invisible inside the container.

## Problem Statement

Running `stigmer draft skill --workspace /path/to/project` always failed at workspace provisioning time, even though the CLI validated the path successfully on the host.

### Pain Points

- The CLI pre-flight check (`os.Stat`) passes because the path exists on the host, but the agent-runner runs inside a Docker container where the same path does not exist.
- The error message ("Path does not exist") is correct from the container's perspective but misleading to the user — the path clearly exists on their machine.
- `LocalPathSource` was architecturally designed for local mode (direct access to user files), but the container startup code never mounted host directories to make this possible.

## Solution

Bind-mount the user's home directory (`$HOME:$HOME`) into the agent-runner Docker container at startup. This preserves path identity — host-absolute paths work identically inside the container — and aligns with the local-mode trust boundary where the user is operating on their own machine.

## Implementation Details

Two startup paths create the agent-runner container:

1. **`supervisor.go`** (`startAgentRunner`) — used during normal `stigmer server` startup via the internal server's component supervisor.
2. **`daemon.go`** (`startAgentRunner`) — used by the daemon health monitor for container restarts.

Both paths now resolve `os.UserHomeDir()` and add `-v $HOME:$HOME` to the Docker `run` arguments. If the home directory cannot be resolved (edge case), a warning is logged and the container starts without the mount for graceful degradation.

## Benefits

- `stigmer draft skill --workspace .` and `stigmer run agent --workspace /path` work correctly in local mode.
- No path translation or rewriting required — host paths are valid inside the container.
- macOS compatible out of the box (Docker Desktop shares `/Users/` by default).
- Linux compatible (bind mounts work natively with the existing `--network host` configuration).

## Impact

- **Users**: Anyone using `--workspace` with a local path will now have a working experience.
- **Seedpack tools**: The `02_draft-agent-creator-skill.sh` script (and similar generation scripts) that pass `--workspace $REPO_ROOT` will no longer fail at provisioning.
- **No API or proto changes**: The fix is purely in container startup configuration.

## Related Work

- `LocalPathSource` provisioner: `backend/services/agent-runner/worker/workspace/sources/local_path.py`
- CLI workspace parsing: `client-apps/cli/cmd/stigmer/root/run_workspace.go`
- Workspace proto: `apis/ai/stigmer/agentic/session/v1/workspace.proto`

---

**Status**: ✅ Production Ready
