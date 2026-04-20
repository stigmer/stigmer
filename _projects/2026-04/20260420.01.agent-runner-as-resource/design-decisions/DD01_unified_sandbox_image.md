# DD01: Bake Agent-Runner into Sandbox Image

**Date**: 2026-04-20
**Status**: Decided
**Context**: Phase 2 — Unified Daytona Runtime

## Decision

Bake the agent-runner (Python virtualenv + source + dependencies) directly into `Dockerfile.sandbox.full` instead of pulling a separate agent-runner Docker image at sandbox creation time.

## Context

The original Phase 2 plan assumed the agent-runner would be pulled as a separate Docker image into the Daytona sandbox at execution time, with an operational gate of "cold start < 30s for ~500MB image." This created an unnecessary runtime dependency and latency.

The sandbox image (`ghcr.io/stigmer/agent-sandbox-full`) is already used as the base for Daytona snapshots. Daytona creates sandboxes from snapshots, not from raw images. If the runner is baked into the image, every snapshot derived from it already has the runner installed.

## Why This Is Right

1. **Eliminates cold start entirely.** `create_from_snapshot` takes 0.84-1.09s regardless of data size. No image pull means no network dependency at execution time.

2. **Python version is already compatible.** `Dockerfile.sandbox.full` uses `debian:bookworm-slim` which ships Python 3.11 — the same version the agent-runner targets. The virtualenv is binary-compatible.

3. **Aligns with "the runner IS the sandbox."** Phase 2's principle is one process + one filesystem. The sandbox image should contain everything the sandbox needs.

4. **Snapshot pipeline inherits it automatically.** The `SnapshotResolver` + `CreateSnapshotParams` pipeline builds snapshots on top of this image (adding MCP servers). Every snapshot automatically includes the runner.

5. **No runtime image pull dependency.** The runner's availability doesn't depend on GHCR being reachable at execution time.

## Implementation

- `Dockerfile.sandbox.full` gets a multi-stage builder: Poetry + virtualenv build → copy virtualenv + source + graphton + proto stubs to `/app/agent-runner/` in the final image.
- Image CMD stays `/bin/bash` (Daytona convention). stigmer-service starts the runner process via `sandbox.process.exec()`.
- `release.sandbox-cloud.yaml` widens build context to repo root (needs `backend/libs/python/graphton` and `apis/stubs/python`). Path triggers include agent-runner code changes.
- The standalone `Dockerfile` (agent-runner) stays for K8s pod deployment, local/OSS mode, and CI testing.

## Tradeoffs

- **Sandbox image grows by ~500MB-1GB** (Python packages). Acceptable: baked into snapshot once, reused for every sandbox creation.
- **Agent-runner updates require sandbox image rebuild.** Acceptable: the `release.sandbox-cloud.yaml` CI pipeline triggers on agent-runner code changes.
- **Two Dockerfiles to maintain** (sandbox + standalone). Acceptable: they serve different deployment modes (Daytona vs K8s pod).

## Evidence (Benchmark Data, 2026-04-20)

| Metric | 0 MB | 100 MB | 500 MB |
|--------|------|--------|--------|
| create_from_snapshot | 0.84s | 1.02s | 1.09s |
| stop | 1.68s | 1.59s | 1.79s |
| start_from_stopped | 1.34s | 1.37s | 1.35s |
| archive (to cold storage) | 33.53s | 50.68s | 61.34s |
| start_from_archived | 3.78s | 3.88s | 20.97s |

Archiving race condition: `start()` while ARCHIVING succeeds in ~1s, data survives.
