# Cloud Sandbox Performance

Performance characteristics of the cloud sandbox image
(`Dockerfile.sandbox.full`) used by Daytona for agent execution.

## Image Size

**~800 MB** (estimated) as of 2026-04-21.

| Component | Size | Purpose |
|-----------|------|---------|
| Runner virtualenv | 350 MB | Agent-runner Python dependencies |
| Python3 + Node.js + npm | 240 MB | MCP server runtimes (npx, uvx) |
| Go toolchain | 206 MB | MCP server runtime (go run) |
| Base OS + utilities | 97 MB | debian:bookworm-slim + curl/git/jq |
| debian:bookworm-slim | 75 MB | Base image |
| uv / uvx | 59 MB | Python MCP server runtime |
| yq | 10 MB | YAML processor |
| Runner source + deps | 7 MB | worker/, grpc_client/, graphton, proto stubs |

MCP server packages (npm, pip, go modules) are **not** baked into the image.
They are installed on-demand by the agent-runner during execution setup,
derived from the merged (agent + session) MCP server specs. This keeps
the image slim and agent-specific.

Cloud CLIs (aws, gcloud, az, kubectl, terraform, pulumi, helm, etc.)
are NOT included. Agents install them on-demand.

## MCP Package Install Latency

MCP server packages are installed by the agent-runner during execution
setup (after fetching MCP server specs, before config transformation).
The user sees an "Installing tools..." status during this phase.
Typical install times:

| Packages | Estimated Time | Example |
|----------|---------------|---------|
| 0 (HTTP-only MCP servers) | 0s | No install needed |
| 1-2 npm packages | 3-8s | filesystem + git MCP servers |
| 3-5 npm + 1-2 pip packages | 8-15s | Typical agent with mixed MCP servers |

This cost is paid on the first execution per sandbox. Packages persist
in the sandbox across the session, so subsequent executions see
near-instant startup.

## Daytona Sandbox Lifecycle

Measured via `benchmark_sandbox_lifecycle.py` against the Daytona API.
Sandboxes are created from **snapshots** (pre-computed from this image),
not from the Docker image directly. Snapshot creation is a one-time
operation performed by the CI pipeline.

### Baseline (daytona-small snapshot, 0 MB workspace)

| Operation | Time | Notes |
|-----------|------|-------|
| create_from_snapshot | **1.03s** | Snapshot-to-running sandbox |
| stop | 1.94s | Running to stopped |
| start_from_stopped | 1.11s | Stopped to running |
| archive | 45.44s | Stopped to cold storage |
| start_from_archived | 3.12s | Cold storage to running |
| delete | 0.68s | Remove sandbox |

### DD01 Reference (2026-04-20, daytona-small snapshot)

| Operation | 0 MB | 100 MB | 500 MB |
|-----------|------|--------|--------|
| create_from_snapshot | 0.84s | 1.02s | 1.09s |
| stop | 1.68s | 1.59s | 1.79s |
| start_from_stopped | 1.34s | 1.37s | 1.35s |
| archive | 33.53s | 50.68s | 61.34s |
| start_from_archived | 3.78s | 3.88s | 20.97s |

### Key Observations

- **create_from_snapshot is sub-second to ~1s** regardless of image size.
  Daytona creates sandboxes from pre-computed snapshots, not from Docker
  image pulls. Image size affects initial snapshot build time (CI) and
  GHCR transfer, not runtime sandbox creation.

- **Archive time scales with workspace data**, not image size. The 0 MB
  baseline takes 33-45s; 500 MB takes ~61s.

- **start_from_archived scales with workspace data** at larger sizes
  (3s for 0-100 MB, 21s for 500 MB).

- **HITL race condition is safe.** Calling `start()` while a sandbox is
  mid-archive (`ARCHIVING` state) succeeds in ~1s. Data survives.
  Daytona handles this gracefully.

## Running Benchmarks

```bash
cd backend/services/agent-runner
DAYTONA_API_KEY=<key> python -m pytest \
  tests/integration/benchmark_sandbox_lifecycle.py -v -s
```

Requires a valid Daytona API key. Tests create real sandboxes and
exercise the full lifecycle. The test suite is normally skipped in CI.
