# Docker Placement for CLI Runner

**Date**: April 23, 2026

## Summary

Added Docker container placement to the Stigmer CLI runner. Users can now run `stigmer up runner --runtime docker` to start the agent-runner inside a Docker container instead of as a native Python process. This gives teams an isolated, reproducible runtime without requiring Python installed on the host machine.

## Problem Statement

The CLI runner (`stigmer up runner`) bootstraps a full Python virtual environment and runs the agent-runner as a local process. This works well but has limitations for some deployment scenarios.

### Pain Points

- Host machine must have Python installed and compatible with the agent-runner's dependencies
- Python venv bootstrap adds 1-2 minutes to the first startup
- No process isolation — the agent-runner shares the host's filesystem and network namespace
- Difficult to pin exact runtime versions in CI/CD or multi-machine environments

## Solution

Added a `--runtime docker` flag that starts the agent-runner inside a Docker container. The Docker lifecycle (run, inspect, stop, rm) is managed through a `DockerClient` interface backed by `exec.Command("docker", ...)` calls. The native Python path remains the default and is completely unchanged.

## Implementation Details

### DockerClient Interface (`docker.go`)

A clean `DockerClient` interface abstracts all Docker operations:

- `IsAvailable()` — validates Docker daemon is reachable (called upfront before registration)
- `Run()` — `docker run -d` with container naming (`stigmer-runner-<slug>`), env vars, and image
- `Inspect()` — parses `docker inspect --format` for running state and exit code
- `Stop()` / `Remove()` — graceful container lifecycle with configurable grace period
- `Wait()` — blocks until container exits (used for foreground lifecycle management)

Backed by `execDockerClient` that shells out to the `docker` binary. This avoids the Docker Go SDK's massive dependency tree and enables Podman/nerdctl compatibility.

### Strategy Pattern in `start.go`

The monolithic `Start()` function was refactored into a shared registration phase (`registeredRunner`) followed by runtime dispatch:

- `startNativeRunner()` — extracted existing Python bootstrap + subprocess path (zero behavior change)
- `startDockerRunner()` — new Docker container lifecycle with health polling, bidi stream, and signal-aware shutdown

Both paths share: slug resolution, backend resolution, runner registration (Apply), state persistence, bidi stream management, and shutdown signal handling.

### State Extension (`state.go`)

`RunnerState` gains two new fields: `Runtime` (string: `"native"` or `"docker"`) and `ContainerID` (string). Both use `omitempty` for backward compatibility — existing state files without these fields deserialize as native runners.

Liveness checks (`IsActive`, `ReapStaleRunners`, `ListActiveRunners`, `ListAllRunnerStates`) now dispatch to either PID probe or container inspect based on the runtime type.

### Docker-Aware Stop (`stop.go`)

`StopRunner` dispatches to `stopNativeRunner` (SIGTERM/SIGKILL) or `stopDockerRunner` (docker stop + docker rm) based on state runtime. Container cleanup always removes the container to prevent stale Docker resources.

### CLI Flags (`up.go`)

`--runtime` (values: `native`, `docker`; default: `native`) and `--image` (override for Docker image) added to both `stigmer up` and `stigmer up runner` commands.

## Benefits

- **Reproducible runtime**: Docker containers use a pinned image version, eliminating host dependency issues
- **Zero Python dependency**: Users with Docker but no Python can run agents
- **Process isolation**: Agent-runner runs in its own container namespace
- **Podman/nerdctl compatible**: Uses the `docker` CLI binary, compatible with any Docker-compatible runtime
- **No new Go dependencies**: All Docker operations via `exec.Command` — binary size unchanged
- **Backward compatible**: Existing native runners are completely unaffected

## Impact

- **CLI users**: New `--runtime docker` option available on `stigmer up` and `stigmer up runner`
- **CI/CD pipelines**: Docker placement is ideal for containerized build environments
- **Existing users**: Zero impact — native runtime remains the default, state files are backward compatible

## Related Work

- Phase 3 project: `20260423.02.phase3-persistent-runners-browser-launch`
- T02 (complete): Server-side launch token endpoints
- T06 (next): Runner stop via command stream
- T07 (next): SDK runner action hooks

---

**Status**: Production Ready
**Timeline**: 1 session
