# Next Task: 20260420.01.agent-runner-as-resource

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260420.01.agent-runner-as-resource

**Description**: Promote AgentRunner to a first-class API resource with orthogonal lifecycle/scope/placement axes; introduce a Stigmer Side-Channel Proxy that injects all platform secrets so runners carry only the user JWT; eliminate the can_impersonate machine-account model; unify per-execution sandbox and agent-runner into a single Daytona container; enable browser-launched local runners via stigmer:// URL scheme.
**Goal**: Eliminate the platform-wide can_impersonate superpower for agent execution by making every agent-runner authenticate as the triggering user and routing all infrastructure secrets through a Stigmer-hosted side-channel proxy that the runner never sees.
**Tech Stack**: Java/Spring Boot WebFlux (stigmer-service), Python (agent-runner), Protobuf, OpenBAO/Vault, Daytona, Temporal, Auth0, Tauri/Go (CLI/Desktop)
**Components**: apis/ai/stigmer/agentic/agentrunner/v1 (new proto resource); backend/services/stigmer-service (proxy endpoints, AgentRunner aggregate, dispatch logic, RunnerLauncher abstraction); backend/services/agent-runner (remove machine account, point clients at proxy, run inside Daytona); client-apps/cli and Stigmer Desktop (stigmer:// URL handler, register-as-AgentRunner flow); cloud frontend (AgentRunner UI for Persistent runners)

## Current State
- **Status**: Phase 0 code complete; Phase 1 complete; Phase 2 prep complete; Daytona removal complete; Proxy consolidated; Sandbox image slimmed; Bazel build fixed and validated
- **Last Session**: 2026-04-21 — Fix Bazel Build (Session 18)
- **Active Task**: All code changes committed. Next: Phase 0 deploy ops tasks (items 2, 4, 6, 7)

## Session Progress (2026-04-21, Session 18 — Fix Bazel Build)

### Accomplished
- Fixed Bazel build for stigmer-service — was completely broken due to Maven resolution failure
- Discovered Daytona Java SDK Maven Central coordinates mismatch: docs say `io.daytona:sdk-java:0.1.0` but actual artifact is `io.daytona:sdk` with Daytona release version numbers (0.161.0+)
- Fixed MODULE.bazel: `io.daytona:sdk-java:0.1.0` → `io.daytona:sdk:0.168.0`
- Fixed BUILD.bazel: updated Bazel label `@maven//:io_daytona_sdk_java` → `@maven//:io_daytona_sdk`
- Added two missing Bazel strict dependencies for Phase 0 proxy controllers:
  - `@maven//:org_apache_tomcat_embed_tomcat_embed_core` (provides `jakarta.servlet.http.HttpServletRequest`)
  - `@maven//:org_springframework_spring_webmvc` (provides `StreamingResponseBody`)
- Validated: library build (537 actions), fat JAR, container image, 25/25 tests pass — all green
- Committed in stigmer-cloud: `878db46a`

### Key Decisions Made
85. **Daytona SDK artifact is `io.daytona:sdk`, not `io.daytona:sdk-java`** — Daytona docs are misleading. The actual Maven Central artifact uses `sdk` as the artifact ID, with versions matching Daytona release numbers (0.161.0, 0.162.0, ..., 0.168.0). Version `0.1.0` was never published.
86. **Servlet API comes from `tomcat-embed-core`, not standalone `jakarta.servlet-api`** — Spring Boot bundles the servlet API inside Tomcat's embedded core JAR. The standalone `jakarta.servlet:jakarta.servlet-api` artifact is not in the resolved transitive graph.
87. **Use latest Daytona SDK `0.168.0`** — API-compatible with the code written against documented 0.1.0 (same package structure `io.daytona.sdk.*`, same classes). Latest release from April 21, 2026.

### Files Modified (this session)

**stigmer-cloud (2 modified):**
- `MODULE.bazel` — Daytona SDK coordinates: `io.daytona:sdk-java:0.1.0` → `io.daytona:sdk:0.168.0`
- `backend/services/stigmer-service/BUILD.bazel` — Fixed Daytona label, added tomcat-embed-core and spring-webmvc strict deps

### Files Created (this session)

**stigmer-cloud (1 new file):**
- `_changelog/2026-04/2026-04-21-202111-fix-bazel-build-daytona-sdk-strict-deps.md`

## Session Progress (2026-04-21, Session 17 — Slim Sandbox Image + On-Demand MCP Bootstrap)

### Accomplished
- Brainstormed sandbox image strategy: analyzed per-agent image building, Daytona snapshots, and user-provided custom images
- Designed three-tier strategy: Tier 1 (slim base + bootstrap), Tier 2 (Daytona per-agent snapshots), Tier 3 (user custom images)
- Implemented Tier 1: removed 12 npm + 6 pip pre-installed MCP packages from Dockerfile.sandbox.full
- Retained Go toolchain (206 MB) — core MCP servers (Stigmer, Planton, GitHub) are Go-based
- Created `bootstrap.sh` script: installs agent-specific MCP packages at sandbox startup from env vars
- Created `McpBootstrapResolver` service (stigmer-cloud): traces session → agent → MCP servers, extracts npm/pip package names
- Updated `AgentRunnerDispatchService`: resolves bootstrap packages and sets them as labels on ephemeral runners
- Updated `DaytonaSandboxRunnerLauncher`: reads bootstrap labels from runner, passes as sandbox env vars
- Updated runner-start-command: runs `bootstrap.sh` before runner process
- Estimated image reduction: ~995 MB → ~800 MB (pre-installed MCP packages removed, Go retained)

### Key Decisions Made
79. **Go toolchain stays in base image** — Stigmer, Planton, and GitHub MCP servers are all Go-based. On-demand Go installation is too heavy (entire toolchain download, not just a package). The 206 MB cost is justified.
80. **MCP packages are NOT baked into the image** — They are installed on-demand at sandbox startup by `bootstrap.sh`, reading `STIGMER_BOOTSTRAP_NPM_PACKAGES` and `STIGMER_BOOTSTRAP_PIP_PACKAGES` env vars. This keeps the image agent-agnostic.
81. **Bootstrap info flows via runner labels** — `AgentRunnerDispatchService` resolves packages and stores them as labels on the runner proto. `DaytonaSandboxRunnerLauncher` reads labels and sets env vars. No interface changes to `RunnerLauncher`.
82. **Heuristic package extraction** — `npx -y <pkg>` → npm package; `uvx <pkg>` → pip package. Custom commands (node, python) are skipped — those servers install on-demand at first invocation via npx/uvx.
83. **Tier 2 (Daytona per-agent snapshots) deferred** — Will revisit when bootstrap latency (5-15s) becomes a measurable pain point for high-frequency agents. Daytona's declarative builder + snapshot API is the intended mechanism.
84. **User-provided custom images (Tier 3) rejected for now** — Opens registry auth, security scanning, and agent-runner version mismatch concerns. Custom packages are better served via MCP server definitions + bootstrap.

### Files Created (this session)

**stigmer (2 new files):**
- `backend/services/agent-runner/sandbox/bootstrap.sh`
- `_changelog/2026-04/2026-04-21-slim-sandbox-image-on-demand-mcp-bootstrap.md`

**stigmer-cloud (1 new file):**
- `backend/services/stigmer-service/.../agentrunner/launcher/McpBootstrapResolver.java`

### Files Modified (this session)

**stigmer (4 modified):**
- `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full` — Removed pre-installed npm/pip MCP packages, added bootstrap.sh COPY, updated header comments
- `backend/services/agent-runner/sandbox/PERFORMANCE.md` — Updated image size, added bootstrap latency section
- `backend/services/agent-runner/docs/sandbox/execution-modes.md` — Replaced "MCP Packages in Docker Image" with "MCP Package Bootstrap" section
- `.github/workflows/release.sandbox-cloud.yaml` — Added bootstrap.sh to path triggers

**stigmer-cloud (4 modified):**
- `backend/services/stigmer-service/.../dispatch/AgentRunnerDispatchService.java` — Injected McpBootstrapResolver, set bootstrap labels on ephemeral runners
- `backend/services/stigmer-service/.../launcher/DaytonaSandboxRunnerLauncher.java` — Read bootstrap labels from runner, add to sandbox env vars
- `backend/services/stigmer-service/.../launcher/RunnerLauncherConfig.java` — Updated runner-start-command default to run bootstrap.sh first
- `backend/services/stigmer-service/src/main/resources/application-runner-launcher.yaml` — Updated runner-start-command default and comment

## Session Progress (2026-04-21, Session 16 — Consolidate Proxy Under api.stigmer.ai)

### Accomplished
- Consolidated Side-Channel Proxy from separate `proxy.stigmer.ai` hostname to path-based routing on existing `api.stigmer.ai`
- Analyzed OpenMCF KubernetesDeployment Pulumi module to confirm port handling, Gateway naming, and path-routing limitations
- Deleted 4 proxy-specific infra resources (Gateway, Certificate, 2 HTTPRoutes, CORS EnvoyFilter) — never applied to cluster
- Created 1 supplementary HTTPRoute: `api.stigmer.ai/v1/proxy` → `stigmer-service:8081`
- Added `x-api-key` to `stigmer-service-gateway-cors.yaml` allowed headers for Anthropic SDK compatibility
- Updated `STIGMER_PROXY_ENDPOINT` from `https://proxy.stigmer.ai` to `https://api.stigmer.ai` in agent-runner kustomize
- Updated all `proxy.stigmer.ai` references across both repos (changelogs, docs, code comments, project files)
- Revised Phase 0 deploy task list: items 3 (DNS setup) and 5 (Planton secrets group) eliminated

### Key Decisions Made
75. **Proxy endpoints belong under api.stigmer.ai** — They're API endpoints served by the same pod, authenticated by the same pipeline. A separate hostname for a different port of the same service leaks an implementation detail into the public DNS surface.
76. **Supplementary HTTPRoute pattern** — The OpenMCF KubernetesDeployment module doesn't support path-based routing (hardcoded `PathPrefix /` with single backend). A manually-managed HTTPRoute alongside the module-managed Gateway follows the established pattern used by CORS EnvoyFilters.
77. **Gateway API longest-prefix-match** — `/v1/proxy` is more specific than `/`, guaranteeing proxy traffic routes to port 8081 while everything else continues to port 80 (gRPC). Standard Gateway API semantics, well-tested in Istio.
78. **`isIngressPort: false` is correct for http-proxy** — The module creates the Service port (for cluster-internal access and HTTPRoute backend), while external routing is handled by the supplementary resource.

### Files Created (this session)

**stigmer (1 new file):**
- `_changelog/2026-04/2026-04-21-195319-consolidate-proxy-under-api-stigmer-ai.md`

**stigmer-cloud (1 new file):**
- `_ops/planton/infra-hub/kubernetes/stigmer-proxy-path-route.yaml`

### Files Deleted (this session)

**stigmer-cloud (4 deleted):**
- `_ops/planton/infra-hub/kubernetes/stigmer-proxy-gateway.yaml`
- `_ops/planton/infra-hub/kubernetes/stigmer-proxy-httproute.yaml`
- `_ops/planton/infra-hub/kubernetes/stigmer-proxy-certificate.yaml`
- `_ops/planton/infra-hub/kubernetes/stigmer-proxy-gateway-cors.yaml`

### Files Modified (this session)

**stigmer (7 modified):**
- `_kustomize/overlays/prod/service.yaml` — STIGMER_PROXY_ENDPOINT → https://api.stigmer.ai
- `worker/config.py` — updated 2 docstring references
- `worker/storage/proxy.py` — updated module docstring
- `worker/checkpointer/http_saver.py` — updated module docstring
- `_changelog/2026-04/2026-04-20-191935-llm-proxy-base-url-wiring.md` — updated proxy reference
- `_projects/.../README.md` — updated proxy reference
- `_projects/.../checkpoints/2026-04-20-session-1.md` — updated proxy reference
- `_projects/.../next-task.md` — updated Phase 0 tasks and current state

**stigmer-cloud (3 modified):**
- `_ops/planton/infra-hub/kubernetes/stigmer-service-gateway-cors.yaml` — added x-api-key to allowed headers
- `_changelog/2026-04/2026-04-20-185017-side-channel-proxy-phase-0.md` — updated 6 proxy.stigmer.ai references
- `backend/services/stigmer-service/.../LlmProxyController.java` — updated Javadoc example URL

## Session Progress (2026-04-21, Session 15 — Remove Daytona from Agent-Runner)

### Accomplished
- Eliminated Daytona Python SDK from agent-runner entirely (item 17)
- Deleted 8 Daytona modules (~2,200 lines): sandbox_manager, snapshot_resolver, DaytonaWorkspaceBackend, DaytonaMCPClient, daytona_transport, cleanup_sandbox, build_mcp_snapshot, backup file
- Baked 12 npm + 6 pip seedpack MCP server packages into Dockerfile.sandbox.full (replacing MCP snapshot pipeline)
- Simplified config: `sandbox_type`/`sandbox_root_dir` → `workspace_root_dir`; `get_sandbox_config()` → `get_workspace_config()`
- Simplified workspace init: always uses `LocalWorkspaceBackend` (no more cloud/local branching)
- Simplified MCP connect: always uses `MultiServerMCPClient` (no more DaytonaMCPClient/ephemeral sandbox)
- Simplified graphton/setup.py: removed sandbox parameter threading and DaytonaMCPClient
- Removed `daytona` from pyproject.toml and regenerated poetry.lock
- Deleted MCP snapshot pipeline from stigmer-cloud (13 Java files): McpSnapshotScheduleRegistrar, BuildMcpSnapshotWorkflowImpl, ResolveSnapshotPackagesActivityImpl, all models/configs/types
- Deleted CleanupSandbox pipeline from stigmer-cloud (8 Java files, 3 edited): removed from session deletion and execution completion; DeprovisionInfrastructureStep is the replacement
- Updated DaytonaSandboxRunnerLauncher: `CreateSandboxFromSnapshotParams` → `CreateSandboxFromImageParams` (GHCR image directly); snapshot resolution removed; `WORKSPACE_ROOT_DIR=/workspace` added to runner env vars
- Added Daytona cache-warming step to release.sandbox-cloud.yaml: creates throwaway sandbox after GHCR push to pre-warm image cache
- Benchmarked sandbox creation: cold pull 53.47s, warm 1.63s (vs snapshot 1.81s — image-based is equivalent)
- Deleted 7 Daytona test files, rewrote test_config_session_scoping.py
- Updated execution-modes.md and mcp/__init__.py docs

### Key Decisions Made
69. **Eliminate MCP snapshot pipeline entirely** — The polyglot snapshot build system (Java schedule + Java activity + Python activity + Daytona snapshot API + resolver cache + rotation) solved a 3-10 second first-run download. Baking packages into the Dockerfile is simpler, has zero staleness gap, and requires no Daytona snapshot API.
70. **Bake seedpack stdio packages into Dockerfile** — 12 npm + 6 pip packages from the seedpack. Go packages skipped (terraform-mcp-server has `replace` directives preventing `go install`). @playwright/mcp skipped (heavy browser binaries). Image grew from 995 MB to 2.49 GB (uncompressed).
71. **Image-based sandbox creation (not snapshot-based)** — `CreateSandboxFromImageParams` with the GHCR image reference. Warm creation is 1.63s (vs 1.81s for snapshot). Single pipeline: push → GHCR → production sandboxes.
72. **CI cache-warming step** — After GHCR push, creates and deletes a throwaway sandbox to force Daytona to pull/cache the new image. The 53s cold pull happens in CI, never in production. `continue-on-error: true` so pipeline succeeds even if Daytona is unreachable.
73. **Runner always uses LocalWorkspaceBackend** — Whether on a dev laptop or inside a Daytona sandbox, the runner treats everything as local. The cloud/local distinction collapses: MODE only gates auth requirements and endpoint defaults, not workspace backend selection.
74. **`workspace_root_dir` replaces `sandbox_type`/`sandbox_root_dir`** — Single field, sourced from `WORKSPACE_ROOT_DIR` env var. Defaults to `./workspace` (local) or `/workspace` (cloud, set by launcher).

### Files Created (this session)

**stigmer (1 new file):**
- `_changelog/2026-04/2026-04-21-185938-remove-daytona-from-agent-runner.md`

### Files Deleted (this session)

**stigmer (8 deleted modules + 7 deleted test files):**
- `worker/sandbox_manager.py`
- `worker/snapshot_resolver.py`
- `worker/workspace/daytona.py`
- `worker/mcp/daytona_mcp_client.py`
- `worker/mcp/daytona_transport.py`
- `worker/activities/cleanup_sandbox.py`
- `worker/activities/build_mcp_snapshot.py`
- `worker/sandbox_manager_daytona_only.py.backup`
- `tests/test_sandbox_manager_volume.py`
- `tests/integration/benchmark_sandbox_lifecycle.py`
- `tests/integration/test_daytona_mcp_relay.py`
- `tests/integration/test_inline_publisher_daytona.py`
- `tests/integration/test_snapshot_lifecycle.py`
- `tests/mcp/test_daytona_transport.py`
- `tests/mcp/test_discover_mcp_sandbox.py`

**stigmer-cloud (21 deleted Java files):**
- MCP snapshot pipeline: McpSnapshotScheduleRegistrar, BuildMcpSnapshotWorkflowImpl, ResolveSnapshotPackagesActivityImpl, ResolveSnapshotPackagesActivity, BuildMcpSnapshotActivity, BuildMcpSnapshotInput, BuildMcpSnapshotOutput, SnapshotPackages, McpSnapshotTemporalConfig, McpSnapshotTemporalWorkflowTypes, McpServerTemporalConfig, McpServerTemporalWorkerConfig, BuildMcpSnapshotWorkflow
- CleanupSandbox pipeline: CleanupSandboxActivity, CleanupSandboxWorkflow, CleanupSandboxWorkflowImpl, CleanupSandboxWorkflowCreator, CleanupSandboxStep, SessionTemporalWorkflowTypes, FetchSessionSandboxIdActivity, FetchSessionSandboxIdActivityImpl

### Files Modified (this session)

**stigmer (11 modified):**
- `.github/workflows/release.sandbox-cloud.yaml` — Added Daytona cache-warming step
- `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full` — Baked MCP packages, updated comments
- `backend/services/agent-runner/pyproject.toml` — Removed `daytona` dependency
- `backend/services/agent-runner/poetry.lock` — Regenerated
- `backend/services/agent-runner/worker/config.py` — workspace_root_dir, get_workspace_config()
- `backend/services/agent-runner/worker/workspace/__init__.py` — Always LocalWorkspaceBackend
- `backend/services/agent-runner/worker/worker.py` — Removed snapshot init, unregistered activities
- `backend/services/agent-runner/worker/mcp/__init__.py` — Updated docstring
- `backend/services/agent-runner/worker/activities/discover_mcp_server.py` — Removed sandbox creation
- `backend/services/agent-runner/worker/activities/graphton/setup.py` — Removed DaytonaMCPClient
- `backend/services/agent-runner/docs/sandbox/execution-modes.md` — Rewrote for Daytona-free architecture

**stigmer (2 modified tests):**
- `tests/test_config_session_scoping.py` — Rewritten for get_workspace_config()
- `tests/test_workspace_integrity_check.py` — Removed Daytona test class

**stigmer-cloud (8 modified):**
- `backend/services/stigmer-service/.../DaytonaSandboxRunnerLauncher.java` — Image-based creation, WORKSPACE_ROOT_DIR
- `backend/services/stigmer-service/.../RunnerLauncherConfig.java` — sandboxImage property, removed snapshot config
- `backend/services/stigmer-service/.../application-runner-launcher.yaml` — sandbox-image, removed snapshot entries
- `backend/services/stigmer-service/.../application-temporal.yaml` — Removed mcp-server queue and snapshot config
- `backend/services/stigmer-service/.../AgentExecutionTemporalWorkerConfig.java` — Removed cleanup registrations
- `backend/services/stigmer-service/.../InvokeAgentExecutionWorkflowImpl.java` — Removed sandbox cleanup in finally
- `backend/services/stigmer-service/.../SessionDeleteHandler.java` — Removed CleanupSandboxStep
- `backend/services/stigmer-service/.../HttpSecurityConfig.java` — Pre-existing proxy change (separate)

## Session Progress (2026-04-21, Session 14 — Unified Sandbox Image + Optimization)

### Accomplished
- Baked agent-runner into Dockerfile.sandbox.full per DD01 (item 15)
- Updated release.sandbox-cloud.yaml with repo-root build context and widened path triggers (item 16)
- Fixed latent runner-start-command bug: `python -m worker.main` → `nohup /app/.venv/bin/python /app/main.py` (no such module existed)
- Optimized sandbox image from 5.32 GB to 995 MB (81% reduction)
- Removed all 10 cloud CLIs (2.58 GB): gcloud, az, aws, pulumi, terraform, docker, tkn, kubectl, helm, gh
- Fixed root .dockerignore to exclude Python dev artifacts (.venv, .mypy_cache, build, dist) — saved 1.18 GB
- Added runner-builder multi-stage build with debian:bookworm-slim base (matching sandbox runtime for virtualenv path compatibility)
- Pinned Poetry to 2.1.2 in builder for reproducible builds
- Regenerated stale poetry.lock (pre-existing issue)
- Ran Daytona lifecycle benchmark: create_from_snapshot 1.03s (consistent with DD01 baseline)
- Created PERFORMANCE.md with image size breakdown and benchmark results

### Key Decisions Made
64. **debian:bookworm-slim as builder base (not python:3.11-slim)** — The sandbox runtime installs Python via apt at `/usr/bin/python3`. Using the same base for the builder means virtualenv symlinks and `pyvenv.cfg` paths are valid in the final image without post-copy fixups. The alternative (python:3.11-slim at `/usr/local/bin/python3.11` + fixup) is fragile.
65. **Runner layout at /app/ (not /app/agent-runner/)** — Matches the standalone Dockerfile's layout. Poetry's editable installs create `.egg-link` files with absolute paths from the builder; these must match at runtime. /workspace is free (Daytona convention for user code).
66. **All cloud CLIs removed** — 2.58 GB of tools most agents never use. Agents install on-demand or use MCP snapshots that layer additional tools. The image's purpose is MCP server runtimes + agent runner, not a cloud CLI toolkit.
67. **Root .dockerignore expanded** — Both Dockerfiles build from repo root. The root .dockerignore was minimal (only .git, .next, node_modules). Python dev artifacts (.venv, .mypy_cache, build, dist) were being COPY'd into images. Agent-runner COPY went from 815 MB to 3.2 MB.
68. **Poetry pinned to 2.1.2** — The poetry.lock was generated by 2.1.2. The `install.python-poetry.org` installer fetches latest, which may compute content hashes differently. Pinning ensures reproducible builds.

### Files Created (this session)

**stigmer (2 new files):**
- `backend/services/agent-runner/sandbox/PERFORMANCE.md`
- `_changelog/2026-04/2026-04-21-174839-unified-sandbox-image-optimization.md`

### Files Modified (this session)

**stigmer (4 modified):**
- `.dockerignore` — Added Python dev artifact exclusions
- `.github/workflows/release.sandbox-cloud.yaml` — Build context → repo root, path triggers widened
- `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full` — Runner builder stage, cloud CLIs removed, verification updated
- `backend/services/agent-runner/poetry.lock` — Regenerated (pre-existing stale lock)

**stigmer-cloud (2 modified, committed in Session 13):**
- `RunnerLauncherConfig.java` — Fixed start command default
- `application-runner-launcher.yaml` — Fixed start command YAML default

## Session Progress (2026-04-21, Session 13 — Daytona Auto-Stop Safety Net)

### Accomplished
- Re-enabled Daytona `autoStopInterval` at 120 minutes (2 hours) as a last-resort safety net
- Previously disabled (0) in Session 12 due to the toolbox API interaction timing issue
- At 2 hours, the risk of killing active runners is negligible — no legitimate execution runs 2h without Daytona API interaction
- Updated Javadoc and YAML comments to describe the safety-net role

### Key Decisions Made
64. **Daytona auto-stop at 2h as safety net** — The Python idle watchdog (5 min) is the primary mechanism. Daytona's 2h auto-stop is a last-resort backstop for hung processes or watchdog failures. This partially reverses decision 58 (which disabled auto-stop entirely) while keeping the timeout far enough from normal operations to be safe.

### Files Modified (this session)

**stigmer-cloud (2 modified):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/RunnerLauncherConfig.java` — autoStopIntervalMinutes default 0→120, updated Javadoc
- `backend/services/stigmer-service/src/main/resources/application-runner-launcher.yaml` — auto-stop-interval-minutes default 0→120, updated comment

## Session Progress (2026-04-21, Session 12 — Idle Self-Termination + Sandbox Cleanup)

### Accomplished
- Implemented Python-side idle watchdog (item 14 from Phase 1)
- Discovered and fixed latent Daytona auto-stop bug via empirical testing
- Added server-side sandbox cleanup triggered by STOPPED heartbeats
- Created `IdleWatchdog` class: asyncio task that polls `execution_tracker` every 30s
- Extended `execution_tracker` with `last_activity_at` monotonic timestamp for accurate idle detection
- Added `idle_timeout_seconds` to `Config` (from `STIGMER_IDLE_TIMEOUT_SECONDS` env var, opt-in)
- Idle watchdog fires SIGTERM to self, reusing existing signal handler for graceful shutdown (final STOPPED heartbeat, Temporal drain, clean exit)
- Disabled Daytona `autoStopInterval` (changed default from 5 to 0) — see key decision 58
- Added `idleTimeoutSeconds` config to launcher, passed as `STIGMER_IDLE_TIMEOUT_SECONDS` env var
- Extended `RunnerLauncher` interface with `deprovisionAsync(AgentRunner)` for sandbox cleanup
- Implemented `DaytonaSandboxRunnerLauncher.deprovisionAsync()`: loads sandbox by ID and deletes it
- Created `DeprovisionInfrastructureStep`: pipeline step wired into heartbeat handler, fires on STOPPED phase for ephemeral runners with a sandbox_id
- Wired `DeprovisionInfrastructureStep` into `AgentRunnerHeartbeatHandler` pipeline (after persist, before sendResponse)

### Key Decisions Made
58. **Daytona auto-stop disabled (empirically validated)** — Daytona's `autoStopInterval` measures time since the last toolbox API interaction (exec, SSH), NOT whether processes are running. A backgrounded `nohup` worker is invisible to this timer. With `autoStopIntervalMinutes: 5`, Daytona would kill active runners 5 minutes after the `executeCommand` that starts the worker. Fix: set to 0 (disabled), rely on Python idle watchdog for application-level idle detection.
59. **Python idle watchdog as primary, Daytona as archive-only** — The Python watchdog provides application-level idle awareness (knows about Temporal activities) and triggers graceful shutdown with a final STOPPED heartbeat. Daytona's auto-archive remains at 5 minutes to clean up stopped sandboxes.
60. **Idle watchdog disabled by default** — `STIGMER_IDLE_TIMEOUT_SECONDS` absent or 0 = no watchdog. The launcher passes the env var for ephemeral runners. Persistent runners and local dev never self-terminate.
61. **SIGTERM to self (not sys.exit)** — Reuses the existing signal handler infrastructure: sends final STOPPED heartbeat for immediate dispatch feedback, properly drains Temporal worker, closes gRPC channels. `sys.exit(0)` would skip all of this.
62. **Server-side sandbox cleanup via heartbeat** — When the heartbeat handler receives STOPPED phase for an ephemeral runner with a sandbox_id, `DeprovisionInfrastructureStep` fires `deprovisionAsync`. This is the mirror of `ProvisionInfrastructureStep` on create.
63. **`last_activity_at` on both increment and decrement** — The idle watchdog polls periodically (30s). Without a timestamp, a short-lived activity that starts and finishes between polls would be missed. Updating on both events means "last time any activity event happened" — a runner that just started an activity is not idle.

### Files Created (this session)

**stigmer (1 new file):**
- `backend/services/agent-runner/worker/idle_watchdog.py`

**stigmer-cloud (1 new file):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/DeprovisionInfrastructureStep.java`

### Files Modified (this session)

**stigmer (3 modified):**
- `backend/services/agent-runner/worker/execution_tracker.py` — added `last_activity_at` monotonic timestamp, `from time import monotonic`
- `backend/services/agent-runner/worker/config.py` — added `idle_timeout_seconds` field, env var parsing
- `backend/services/agent-runner/worker/worker.py` — IdleWatchdog lifecycle (create, start, stop)

**stigmer-cloud (5 modified):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/RunnerLauncherConfig.java` — disabled autoStopInterval (5→0), added `idleTimeoutSeconds` property
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/DaytonaSandboxRunnerLauncher.java` — added `STIGMER_IDLE_TIMEOUT_SECONDS` env var, `deprovisionAsync` implementation
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/RunnerLauncher.java` — added `deprovisionAsync` to interface
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/NoopRunnerLauncher.java` — no-op `deprovisionAsync`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerHeartbeatHandler.java` — wired `DeprovisionInfrastructureStep`, updated Javadoc
- `backend/services/stigmer-service/src/main/resources/application-runner-launcher.yaml` — disabled auto-stop default, added `idle-timeout-seconds`

## Session Progress (2026-04-21, Session 11 — Runner Heartbeat Client)

### Accomplished
- Implemented Python-side heartbeat emitter (item 13 from Phase 1)
- Created `HeartbeatEmitter` class: asyncio task that sends heartbeat RPC every 30s
- Created `AgentRunnerClient` gRPC client following existing client patterns
- Created `execution_tracker` module for process-wide active execution counting
- Integrated heartbeat lifecycle into `AgentRunner` worker: start after Temporal, stop before shutdown
- Final STOPPED heartbeat sent on graceful shutdown for immediate dispatch feedback (vs 90s timeout)
- Fixed env var mismatch: Python `Config` now reads `STIGMER_TASK_QUEUE` (what the launcher passes), falling back to `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE` and then global default
- Added `STIGMER_AGENT_RUNNER_ID` env var to `DaytonaSandboxRunnerLauncher.buildEnvVars()` so the runner process knows its resource identity
- Added `agent_runner_id` field to `Config` (from `STIGMER_AGENT_RUNNER_ID` env var, optional)
- Instrumented all 7 activity functions with `execution_tracker.increment()`/`decrement()` for accurate phase reporting (READY vs BUSY)
- Heartbeat is opt-in: no `STIGMER_AGENT_RUNNER_ID` = no heartbeat loop (backward compatible)

### Key Decisions Made
51. **Task queue env var cascade: `STIGMER_TASK_QUEUE` > `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE` > default** — The launcher passes `STIGMER_TASK_QUEUE` with per-runner queue names. The legacy env var is retained for backward compatibility. Without this fix, per-runner queues from the launcher were silently ignored.
52. **Final STOPPED heartbeat on shutdown** — Faster dispatch feedback (immediate vs 90s server timeout). The 90s timeout remains as the safety net for crashes.
53. **Heartbeat opt-in via `STIGMER_AGENT_RUNNER_ID`** — When the env var is absent, no heartbeat emitter is created. Existing local/legacy deployments are unaffected.
54. **All activities tracked, not just `execute_graphton`** — `max_concurrent_activities` governs all registered activities. Any at-capacity state should be reflected in the heartbeat phase.
55. **Connection info gathered once at init** — Hostname, OS, arch, and runner version are static for the process lifetime. No need to re-gather on every tick.
56. **NOT_FOUND stops heartbeat loop** — If the runner resource was deleted, heartbeating is pointless. The worker continues processing activities on its queue (Temporal doesn't care about AgentRunner state).
57. **`STIGMER_AGENT_RUNNER_ID` as env var, not derived from task queue** — The runner ID and task queue are separate concerns. The launcher knows both and passes both explicitly. Deriving one from the other would be fragile coupling.

### Files Created (this session)

**stigmer (3 new files):**
- `backend/services/agent-runner/grpc_client/agent_runner_client.py`
- `backend/services/agent-runner/worker/heartbeat.py`
- `backend/services/agent-runner/worker/execution_tracker.py`

### Files Modified (this session)

**stigmer (9 modified):**
- `backend/services/agent-runner/worker/config.py` — added `agent_runner_id` field, fixed task queue env var cascade
- `backend/services/agent-runner/worker/worker.py` — HeartbeatEmitter lifecycle (create, start, stop)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — execution_tracker instrumentation
- `backend/services/agent-runner/worker/activities/ensure_thread.py` — execution_tracker instrumentation
- `backend/services/agent-runner/worker/activities/build_mcp_snapshot.py` — execution_tracker instrumentation
- `backend/services/agent-runner/worker/activities/cleanup_sandbox.py` — execution_tracker instrumentation
- `backend/services/agent-runner/worker/activities/discover_mcp_server.py` — execution_tracker instrumentation
- `backend/services/agent-runner/worker/activities/generate_session_subject.py` — execution_tracker instrumentation
- `backend/services/agent-runner/worker/activities/classify_tool_approvals.py` — execution_tracker instrumentation

**stigmer-cloud (1 modified):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/DaytonaSandboxRunnerLauncher.java` — added `STIGMER_AGENT_RUNNER_ID` env var, refactored `buildEnvVars` signature

## Session Progress (2026-04-21, Session 10 — Runner Auth Migration)

### Accomplished
- Migrated agent-runner from machine-account API key + OBO impersonation to single user-owned credential (item 12 from Phase 1)
- Introduced `STIGMER_TOKEN` as the canonical auth env var (`STIGMER_API_KEY` accepted as convenience alias)
- Simplified `ChannelProvider` from dual-channel (system + OBO) to single-channel architecture
- Deleted `OnBehalfOfInterceptor` entirely — no impersonation needed when the runner IS the user
- Created `worker/auth.py` replacing `worker/token_manager.py` with clean `configure()`/`get_token()` API
- Renamed `api_key` to `token` across all gRPC client constructors (7 files) and `AuthClientInterceptor`
- Removed `invoker_identity_account_id` from `ChannelProvider`, `perform_setup()`, and `_perform_setup_core()` signatures
- Replaced `sys_ch`/`obo_ch` dual-channel pattern in `setup.py` with single `ch` variable
- Centralized proxy auth: `CheckpointerConfig` and `ArtifactStorageConfig` now receive `auth_token` from parent `Config` instead of reading `STIGMER_API_KEY` independently
- Updated `DaytonaSandboxRunnerLauncher.buildEnvVars()` in stigmer-cloud: `STIGMER_USER_JWT` → `STIGMER_TOKEN`
- Fixed all downstream references: `classify_tool_approvals.py`, `sub_agent.py` handler, test files

### Key Decisions Made
46. **`STIGMER_TOKEN` over `STIGMER_USER_JWT`** — the env var name should be credential-agnostic since the server's auth chain handles both JWTs and API keys (`stk_*`) transparently via the same `Authorization: Bearer` header. One variable, one concept, one code path.
47. **No backward compatibility with OBO** — clean cut since nobody is using the OBO model in production yet. Simpler than maintaining a detection gate and two code paths.
48. **`STIGMER_API_KEY` as convenience alias** — existing `.env` files and kustomize overlays continue to work. Both resolve to the same `stigmer_token` field, same single-channel path.
49. **`invoker_identity_account_id` retained in Temporal activity signatures** — it's part of the Temporal contract with the Java workflow. Removing it from the activity signature would require a coordinated deploy. It's simply ignored by `ChannelProvider` construction now.
50. **Sub-config auth centralization** — `CheckpointerConfig` and `ArtifactStorageConfig` no longer read `STIGMER_API_KEY` from the environment independently. They receive `auth_token` as a parameter from the parent `Config`, ensuring a single source of truth for the credential.

### Files Created (this session)

**stigmer (1 new file + 1 changelog):**
- `backend/services/agent-runner/worker/auth.py`
- `_changelog/2026-04/2026-04-21-151029-runner-auth-migration-stigmer-token.md`

### Files Deleted (this session)

**stigmer (2 deleted):**
- `backend/services/agent-runner/worker/token_manager.py`
- `backend/services/agent-runner/grpc_client/auth/on_behalf_of_interceptor.py`

### Files Modified (this session)

**stigmer (17 modified):**
- `backend/services/agent-runner/worker/config.py` — renamed `stigmer_api_key` to `stigmer_token`, new `STIGMER_TOKEN` resolution, centralized auth for sub-configs
- `backend/services/agent-runner/worker/worker.py` — import `configure_auth` from `worker.auth`
- `backend/services/agent-runner/worker/logging.yaml` — updated logger from `grpc_client.auth.token_manager` to `worker.auth`
- `backend/services/agent-runner/worker/storage/__init__.py` — `ArtifactStorageConfig.load_from_env()` accepts `auth_token` param
- `backend/services/agent-runner/grpc_client/channel.py` — single-channel `ChannelProvider`, removed OBO
- `backend/services/agent-runner/grpc_client/auth/client_interceptor.py` — `api_key` → `token`
- `backend/services/agent-runner/grpc_client/agent_execution_client.py` — `api_key` → `token`
- `backend/services/agent-runner/grpc_client/agent_client.py` — `api_key` → `token`
- `backend/services/agent-runner/grpc_client/agent_instance_client.py` — `api_key` → `token`
- `backend/services/agent-runner/grpc_client/session_client.py` — `api_key` → `token`
- `backend/services/agent-runner/grpc_client/skill_client.py` — `api_key` → `token`
- `backend/services/agent-runner/grpc_client/mcp_server_client.py` — `api_key` → `token`
- `backend/services/agent-runner/grpc_client/execution_context_client.py` — `api_key` → `token`
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — single channel, `get_token()`
- `backend/services/agent-runner/worker/activities/generate_session_subject.py` — single channel, `get_token()`
- `backend/services/agent-runner/worker/activities/discover_mcp_server.py` — single channel, `get_token()`
- `backend/services/agent-runner/worker/activities/graphton/setup.py` — removed dual-channel, `api_key` → `token`

**stigmer (2 modified — production code referenced by tests):**
- `backend/services/agent-runner/worker/activities/classify_tool_approvals.py` — `stigmer_api_key` → `stigmer_token`
- `backend/services/agent-runner/worker/activities/graphton/handlers/sub_agent.py` — `stigmer_api_key` → `stigmer_token`

**stigmer (2 modified — tests):**
- `backend/services/agent-runner/tests/test_worker_mongodb_validation.py` — updated mock target
- `backend/services/agent-runner/tests/test_config_session_scoping.py` — updated field name

**stigmer-cloud (2 modified):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/DaytonaSandboxRunnerLauncher.java` — `STIGMER_USER_JWT` → `STIGMER_TOKEN`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/RunnerLauncher.java` — updated Javadoc

## Session Progress (2026-04-21, Session 9 — RunnerLauncher Daytona Abstraction)

### Accomplished
- Implemented RunnerLauncher strategy interface with DaytonaSandboxRunnerLauncher (item 11 from Phase 1)
- Created complete launcher subsystem in stigmer-cloud: interface, noop impl, Daytona impl, config, pipeline step
- Created downstream gRPC pattern for AgentRunner (AgentRunnerGrpcRepo) following SessionGrpcRepo convention
- Extended AgentRunnerDispatchService with resolveOrProvision() — ephemeral runner creation via downstream gRPC
- Wired StartWorkflowStep to use resolveOrProvision() instead of resolveTaskQueue()
- Added Daytona Java SDK (io.daytona:sdk-java:0.1.0) as first Java-side Daytona integration
- Implemented dynamic MCP snapshot resolution mirroring Python SnapshotResolver (stigmer-mcp-* discovery)
- Added @EnableAsync to Application.java for fire-and-forget sandbox provisioning
- Full kustomize prod overlay with public endpoints (STIGMER_BACKEND_ENDPOINT, Temporal external), DAYTONA_API_KEY, fallback snapshot
- All config flows through Spring @ConfigurationProperties — zero System.getenv() calls
- Startup validation: missing endpoints or DAYTONA_API_KEY fail the Spring context with clear error messages
- Feature-flagged via stigmer.runner-launcher.type: noop (default) or daytona

### Key Decisions Made
39. **Daytona-only launcher (challenging T01 K8s fallback)** — K8s operational gates not needed; Daytona gates passed. Zero K8s client code in codebase. Interface stays extensible for future launchers.
40. **Domain boundary: AgentRunner owns provisioning** — Original plan had EphemeralRunnerFactory inside AgentExecution. Revised: AgentExecution calls AgentRunner's create API via downstream gRPC. Provisioning is a side effect of creation with ephemeral labels.
41. **Spring @Async over Temporal for provisioning** — JWT stays in-memory (never in durable workflow history). Forward-compatible with item 12 TokenExchangeService. Temporal queue durability handles the worker-not-yet-ready gap.
42. **Snapshot-only sandbox creation** — No CreateSandboxFromImageParams path. Dynamic snapshot resolution always resolves (stigmer-mcp-* → daytona-small fallback).
43. **Endpoints at launcher level, not Daytona level** — backend-endpoint and temporal-address are launcher-agnostic. Any future launcher needs the same public endpoints.
44. **No silent localhost fallbacks** — Missing required endpoints or DAYTONA_API_KEY fail Spring context startup with clear errors. Misconfiguration is caught before any execution reaches the launcher.
45. **Prod overlay defaults to type=daytona** — Application default is noop (protects local dev/CI). Prod overlay declares what prod runs.

### Files Created (this session)

**stigmer-cloud (7 new Java files + 2 config files + 1 changelog):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/RunnerLauncher.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/NoopRunnerLauncher.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/DaytonaSandboxRunnerLauncher.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/RunnerLauncherConfig.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/ProvisionInfrastructureStep.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/downstream/agentic/agentrunner/AgentRunnerGrpcRepo.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/downstream/agentic/agentrunner/AgentRunnerGrpcRepoImpl.java`
- `backend/services/stigmer-service/src/main/resources/application-runner-launcher.yaml`
- `_changelog/2026-04/2026-04-21-151219-runner-launcher-daytona-abstraction.md`

### Files Modified (this session)

**stigmer-cloud (7 modified):**
- `MODULE.bazel` — added io.daytona:sdk-java:0.1.0
- `backend/services/stigmer-service/BUILD.bazel` — added @maven//:io_daytona_sdk_java dep
- `backend/services/stigmer-service/src/main/java/ai/stigmer/Application.java` — added @EnableAsync
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerCreateHandler.java` — added ProvisionInfrastructureStep to pipeline
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/dispatch/AgentRunnerDispatchService.java` — added resolveOrProvision() with downstream gRPC
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionCreateHandler.java` — StartWorkflowStep uses resolveOrProvision()
- `backend/services/stigmer-service/src/main/resources/application.yaml` — added runner-launcher to active profiles
- `backend/services/stigmer-service/_kustomize/overlays/prod/service.yaml` — Daytona env vars, public endpoints, API key

## Session Progress (2026-04-21, Session 8 — Dispatch Integration)

### Accomplished
- Implemented complete dispatch integration in both stigmer and stigmer-cloud (item 10 from Phase 1)
- Created `AgentRunnerDispatchService` in stigmer-cloud: resolves session → agent_runner_id → runner phase → task queue
- Created `DispatchResult` record and `RunnerUnavailableException` for fail-fast error semantics
- Modified `InvokeAgentExecutionWorkflowCreator` (both Java and Go) to accept dispatch result and route to per-runner queue
- Modified `StartWorkflowStep` in both editions to call dispatch before starting the workflow
- Added `agentRunnerId` to `InvokeAgentExecutionWorkflowInput` (both Java record and Go struct)
- Backward-compatible: no runner binding → global queue (identical to pre-dispatch behavior)
- `go build ./...` passes cleanly; `go vet` passes cleanly
- Bazel build: only 2 pre-existing strict-dep errors (HttpSecurityConfig, LlmProxyController — Phase 0 work, unrelated)

### Key Decisions Made
34. **BUSY runners accept routed work** — the session was bound when the runner was READY; by execution time it might be BUSY. Temporal handles queuing. Session-runner binding is intentional and should not be silently overridden.
35. **Fail fast on unavailable runner** — when a session explicitly references a runner in FAILED/STOPPED/PENDING/deleted state, the execution fails with FAILED_PRECONDITION. The user chose this runner; silently falling back to global would be surprising.
36. **agentRunnerId on workflow input, not pipeline DB write** — recording runner ID via the workflow (Option B from plan) keeps status updates in the workflow's domain. No extra DB write in the create pipeline.
37. **No FGA check in dispatch** — session authorization happened at creation time. If the user could bind a runner to their session, they can dispatch to it.
38. **RunnerUnavailableException as separate type** — distinct from generic exceptions so StartWorkflowStep maps it to FAILED_PRECONDITION (not INTERNAL).

### Files Created (this session)

**stigmer-cloud (3 new files):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/dispatch/AgentRunnerDispatchService.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/dispatch/DispatchResult.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/dispatch/RunnerUnavailableException.java`

**stigmer (1 new file):**
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/dispatch.go`

### Files Modified (this session)

**stigmer-cloud (3 modified):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowCreator.java` — added dispatch-aware `create(input, dispatch)` overload
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowInput.java` — added `agentRunnerId` field, backward-compatible factory overload
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionCreateHandler.java` — `StartWorkflowStep` now injects `AgentRunnerDispatchService`, resolves queue, catches `RunnerUnavailableException`

**stigmer (3 modified):**
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflow_creator.go` — `Create` now accepts `*DispatchResult`, added `FallbackRunnerQueue()` accessor
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/workflow_input.go` — added `AgentRunnerID` field
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go` — `startWorkflowStep` now calls `ResolveActivityTaskQueue` before starting workflow

## Session Progress (2026-04-21, Session 7 — Go AgentRunner Controller Implementation)

### Accomplished
- Implemented complete AgentRunner controller in stigmer OSS (item 9 from Phase 1)
- Created `AgentRunnerController` struct implementing both `AgentRunnerCommandControllerServer` and `AgentRunnerQueryControllerServer`
- Implemented 5 command handlers using the pipeline framework:
  - `Create` with custom `initializeRunnerStatusStep` (sets task_queue + PENDING phase)
  - `Update` with custom `preserveRunnerStatusStep` (status is heartbeat-only)
  - `Delete` (standard delete pipeline)
  - `Apply` (idempotent create-or-update, primary CLI registration path)
  - `Heartbeat` (fully custom: atomic read-modify-write via `store.UpdateResource`, FAILED gate, phase transitions, reactivation timestamps)
- Implemented 3 query handlers:
  - `Get` (standard get by ID via `LoadTargetStep`)
  - `GetByReference` (org+slug resolution via `LoadByReferenceStep`)
  - `List` (custom `listRunnersByOrgAndLabelsStep` with org filtering + AND-semantics label matching)
- Registered AgentRunner controllers in `server.go` (both command + query)
- `go build ./...` passes cleanly; `go vet` passes cleanly
- Dual-edition behavioral consistency verified against Java aggregate (Session 6)

### Key Decisions Made
29. **No search indexing for AgentRunner** — runners are infrastructure, not user-authored content like Agents or Workflows. Consistent with the domain model: search indexes surface blueprints, not runtime infrastructure.
30. **Heartbeat uses `store.UpdateResource` atomic RMW** — not a pipeline. The heartbeat is a single atomic operation: load, validate phase, mutate status, persist. The pipeline framework's step-by-step pattern doesn't fit because the input type (`AgentRunnerHeartbeatInput`) differs from the resource type (`AgentRunner`).
31. **Error handling in heartbeat distinguishes store.ErrNotFound from domain errors** — `UpdateResource` returns `store.ErrNotFound` when the runner doesn't exist, but the `modify` callback returns gRPC status errors (e.g., `FAILED_PRECONDITION`). The handler uses `errors.Is` and `status.FromError` to route correctly.
32. **No FGA/IAM in OSS heartbeat** — consistent with all other OSS handlers. Cloud has `VerifyCallerOwnership` via FGA `can_edit`; OSS skips it.
33. **List handler does not paginate** — consistent with Session list and AgentExecution list in OSS. Proto supports `page_info` for cloud use; OSS returns all matching results.

### Files Created (this session)

**stigmer (9 new files):**
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/agentrunner_controller.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/create.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/update.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/delete.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/apply.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/heartbeat.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/get.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/get_by_reference.go`
- `backend/services/stigmer-server/pkg/domain/agentrunner/controller/list.go`

### Files Modified (this session)

**stigmer (1 modified):**
- `backend/services/stigmer-server/pkg/server/server.go` — added import for `agentrunnerv1` and `agentrunnercontroller`, registered both command and query controllers

## Session Progress (2026-04-21, Session 6 — AgentRunner Java Aggregate Implementation)

### Accomplished
- Implemented complete AgentRunner domain aggregate in stigmer-cloud (item 8 from Phase 1)
- Generated Java stubs from OSS protos via `make protos` — all AgentRunner types available in stigmer-cloud
- Created FGA authorization model: `agent_runner.fga` type with org/owner/viewer relations
- Added `can_create_agent_runner: member` to organization.fga (any org member can register a runner)
- Registered `agent_runner.fga` in `fga.mod`
- Created `AgentRunnerRepo` (MongoDB, collection `agent_runner`) with label-filtered queries using `$getField`
- Created `AgentRunnerGrpcAutoController` (annotation-processor marker)
- Implemented 5 command handlers:
  - `AgentRunnerCreateHandler` with custom `InitializeRunnerStatus` step (sets task_queue + PENDING phase)
  - `AgentRunnerUpdateHandler` with custom `PreserveRunnerStatus` step (status is heartbeat-only)
  - `AgentRunnerDeleteHandler` (standard delete pipeline)
  - `AgentRunnerApplyHandler` (idempotent create-or-update, primary CLI registration path)
  - `AgentRunnerHeartbeatHandler` (custom: load, FGA ownership check, phase transition, persist)
- Implemented 3 query handlers:
  - `AgentRunnerGetHandler` (standard get with FGA can_view)
  - `AgentRunnerGetByReferenceHandler` (org+slug resolution, custom auth)
  - `AgentRunnerListHandler` (FGA-filtered query pattern with label AND semantics)
- Created MongoDB index migration: unique (org,slug), unique (id), compound (org,phase)
- Added AgentRunner descriptors to `ProtoFgaSchemaConsistencyTest`
- Bazel build passes for all new AgentRunner code (pre-existing proxy strict dep errors are separate)
- Committed: `fbafc288` on `feat/secrets-vault-migration` branch

### Key Decisions Made
24. **`can_create_agent_runner: member`** — runners are user-managed infrastructure, not admin-controlled resources. Any org member should be able to register their laptop as a runner.
25. **Heartbeat ownership via FGA `can_edit` check** — not metadata comparison, because FGA is the single source of truth for authorization.
26. **FAILED phase blocks heartbeat transitions** — a runner in FAILED phase requires explicit investigation; heartbeat cannot automatically recover it.
27. **Status preservation on update** — the framework's `buildNewState` clears status from input; a custom `PreserveRunnerStatus` step restores status from the existing resource. Status is exclusively managed by heartbeat and server-side transitions.
28. **Audit timestamps not manually set in InitializeRunnerStatus** — the framework's `setAudit` step handles audit info; the custom step only sets domain-specific fields (task_queue, phase).

### Files Created (this session)

**stigmer-cloud (12 new files):**
- `backend/services/stigmer-service/src/main/resources/fga/model/agentic/agent_runner.fga`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/repo/AgentRunnerRepo.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/controller/AgentRunnerGrpcAutoController.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerCreateHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerUpdateHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerDeleteHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerApplyHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerHeartbeatHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerGetHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerGetByReferenceHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/request/handler/AgentRunnerListHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/migrations/U20260421_AgentRunnerIndexes.java`

### Files Modified (this session)

**stigmer-cloud (3 modified + 128 total with stubs):**
- `backend/services/stigmer-service/src/main/resources/fga/model/fga.mod` — added agent_runner.fga
- `backend/services/stigmer-service/src/main/resources/fga/model/tenancy/organization.fga` — added can_create_agent_runner: member
- `backend/services/stigmer-service/src/test/java/ai/stigmer/schema/ProtoFgaSchemaConsistencyTest.java` — added AgentRunner descriptors
- All generated stubs across Go, Java, Python, TypeScript, Dart (synced from OSS protos via `make protos`)

## Previous Sessions

### Session 5 (2026-04-20) — AgentRunner Proto Definition

### Accomplished
- Extensive design brainstorm with principal architect and backend engineer roles
- Challenged and refined the original T01 design: dropped lifecycle/placement/runtime enums, dropped max_concurrent_executions spec field, adopted Kubernetes Node pattern (thin spec, rich status)
- Key insight from brainstorm: AgentRunner IS a resource (not just infrastructure) because persistent runners need user-facing CRUD, appear in session composer, and are addressable by name
- Queue is per-runner (`agent-runner:{runner-id}`), not per-user or per-execution
- Both ephemeral (cloud) and persistent (user-created) runners are saved as AgentRunner resources; ephemeral ones labeled `stigmer.ai/system-managed` and hidden from UI
- Created 6 new proto files under `apis/ai/stigmer/agentic/agentrunner/v1/`: api.proto, spec.proto, enum.proto, io.proto, command.proto, query.proto
- Modified 4 existing proto files: ApiResourceKind (agent_runner=46), IamPermission (can_create_agent_runner=25), SessionSpec (agent_runner_id=9), AgentExecutionStatus (agent_runner_id=19)
- Ran `make codegen` — stubs generated across Go, Java, Python, TypeScript, plus SDK clients, MCP server, docs, and schemas (154 files changed)
- `buf lint` passes, `buf breaking` passes (all changes purely additive)

### Key Decisions Made
16. **AgentRunner IS a domain resource, not just infrastructure** — the session composer dropdown, CLI `stigmer runner start`, and platform-for-platforms framing all demand a first-class API resource with CRUD, identity persistence, and per-runner queues.
17. **No lifecycle/placement/runtime enums** — the runner is a process with a name, a queue, and connection info. Cloud vs local is metadata the runner reports via heartbeat, not a spec distinction.
18. **Kubernetes Node pattern** — thin spec (only `description`), rich status (phase, task_queue, heartbeat, capacity, sandbox_id, connection_info). The user declares almost nothing; the runner self-reports everything.
19. **Runner identity persists across restarts** — CLI stores runner ID in `~/.stigmer/runner.json`. On restart, calls `apply` to reactivate. Same resource, same queue, same identity.
20. **`agent_runner_id` on SessionSpec** — replaces the role of `sandbox_id` as session's execution context binding. Sandbox becomes a property of the runner (status), not the session.
21. **`agent_runner_id` on AgentExecutionStatus** — observability: which runner handled this execution.
22. **Heartbeat RPC on command controller** — dedicated lightweight RPC (not a full update), called every 30s, 90s timeout for STOPPED transition.
23. **`apply` RPC for CLI registration** — idempotent create-or-update. If runner exists (from yesterday), reactivates. If not, creates. This is the "match a restarted runner" pattern.

### Files Created (this session)

**stigmer (6 new proto files):**
- `apis/ai/stigmer/agentic/agentrunner/v1/api.proto` — AgentRunner resource, AgentRunnerStatus, AgentRunnerConnectionInfo
- `apis/ai/stigmer/agentic/agentrunner/v1/spec.proto` — AgentRunnerSpec (thin: description only)
- `apis/ai/stigmer/agentic/agentrunner/v1/enum.proto` — AgentRunnerPhase (Pending, Ready, Busy, Stopped, Failed)
- `apis/ai/stigmer/agentic/agentrunner/v1/io.proto` — AgentRunnerId, AgentRunnerHeartbeatInput, ListAgentRunnersRequest, AgentRunnerList
- `apis/ai/stigmer/agentic/agentrunner/v1/command.proto` — AgentRunnerCommandController (apply, create, update, delete, heartbeat)
- `apis/ai/stigmer/agentic/agentrunner/v1/query.proto` — AgentRunnerQueryController (get, getByReference, list)

### Files Modified (this session)

**stigmer (4 modified proto files + all generated stubs):**
- `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto` — added `agent_runner = 46`
- `apis/ai/stigmer/iam/v1/enum.proto` — added `can_create_agent_runner = 25`
- `apis/ai/stigmer/agentic/session/v1/spec.proto` — added `agent_runner_id = 9` to SessionSpec
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` — added `agent_runner_id = 19` to AgentExecutionStatus
- All generated stubs across Go, Java, Python, TypeScript (154 files total via `make codegen`)

### Session 4 (2026-04-20) — Side-Channel Proxy FGA Authorization
- Implemented FGA-based authorization for all proxy endpoints
- Created `ProxyAuthorizationService` with 5-minute cache
- Checkpoints authorized via session, artifacts via execution, LLM is auth-only

### Session 3 (2026-04-20) — Daytona Operational Gate Validation
- All 3 Phase 2 operational gates PASSED
- Decision: bake runner into `Dockerfile.sandbox.full` (sub-second cold start)

### Session 2 (2026-04-20) — LLM Proxy Wiring
- Wired all 6 LLM client construction paths through Side-Channel Proxy
- Centralized `llm_kwargs` into `LLMConfig.build_llm_kwargs()`
- Fixed Anthropic SDK auth header mismatch with custom BearerTokenResolver

### Session 1 (2026-04-20) — Phase 0 Proxy
- Implemented complete Side-Channel Proxy: LLM passthrough, checkpointer API, artifact presigned URLs, Redis removal
- Committed in both repos

## Next Steps

### Phase 0 Deploy (remaining ops tasks)
1. ~~**Validate Bazel build**~~ — DONE (Session 18, commit 878db46a): fixed Daytona SDK coordinates + strict deps, 25/25 tests pass
2. **Deploy proxy to staging** — verify `/health` on port 8081
3. ~~**DNS setup**~~ — ELIMINATED: proxy consolidated under `api.stigmer.ai` via path-based routing (Session 16)
4. **Apply supplementary HTTPRoute** — `kubectl apply -f stigmer-proxy-path-route.yaml` (routes `api.stigmer.ai/v1/proxy` to port 8081)
5. ~~**Create Planton secrets group**~~ — ELIMINATED: LLM provider API keys already on stigmer-service pod via base kustomize
6. **End-to-end test** — trigger execution, verify all calls route through proxy
7. **Commit stigmer-cloud HttpSecurityConfig.java change** — BearerTokenResolver still uncommitted

### Phase 1 Implementation (next coding work)
8. ~~**stigmer-cloud: AgentRunner aggregate + handlers**~~ — DONE (Session 6, commit fbafc288)
9. ~~**stigmer (Go): AgentRunner store + handlers**~~ — DONE (Session 7)
10. ~~**stigmer-cloud: Dispatch integration**~~ — DONE (Session 8)
11. ~~**stigmer-cloud: RunnerLauncher abstraction**~~ — DONE (Session 9, DaytonaSandboxRunnerLauncher only — K8s deferred)
12. ~~**stigmer: Runner auth migration**~~ — DONE (Session 10, STIGMER_TOKEN env var, single-channel ChannelProvider, OBO deleted)
13. ~~**stigmer: Runner heartbeat client**~~ — DONE (Session 11, HeartbeatEmitter, execution_tracker, task queue fix, STIGMER_AGENT_RUNNER_ID)
14. ~~**stigmer: Idle self-termination**~~ — DONE (Session 12, IdleWatchdog, Daytona auto-stop fix, DeprovisionInfrastructureStep)

### Phase 2 Prep (can start in parallel)
15. ~~**Build unified sandbox image**~~ — DONE (Session 14, runner-builder stage, 995 MB optimized image)
16. ~~**Update release pipeline**~~ — DONE (Session 14, repo-root build context, widened path triggers)

### Daytona Removal (Session 15)
17. ~~**Remove Daytona SDK from agent-runner**~~ — DONE (Session 15, 8 modules deleted, ~2,200 lines removed, daytona dependency removed)
18. ~~**Delete MCP snapshot pipeline**~~ — DONE (Session 15, 13 Java files deleted from stigmer-cloud, baked packages into Dockerfile)
19. ~~**Delete CleanupSandbox pipeline**~~ — DONE (Session 15, 8 Java files deleted, DeprovisionInfrastructureStep is replacement)
20. ~~**Switch launcher to image-based creation**~~ — DONE (Session 15, CreateSandboxFromImageParams, WORKSPACE_ROOT_DIR)
21. ~~**Add CI cache-warming step**~~ — DONE (Session 15, throwaway sandbox after GHCR push, 53s absorbed by CI)

## Context for Resume
- Both repos are on the `feat/secrets-vault-migration` branch
- The stigmer-cloud repo has additional uncommitted vault-migration files — separate project
- Phase 1 coding is complete (Sessions 6-12). Phase 2 prep is complete (Session 14). All 21 implementation items are done.
- Bazel build is fully green (Session 18): library, fat JAR, container image, 25/25 tests pass
- Agent-runner is Daytona-free: no `daytona` Python dependency, no Daytona SDK imports
- The sandbox image is ~800 MB (uncompressed, post-slim) with on-demand MCP bootstrap
- Sandbox creation: image-based via `CreateSandboxFromImageParams` with GHCR image reference. Warm: 1.63s, cold: 53s (absorbed by CI cache-warming step).
- Runner config: `workspace_root_dir` (from `WORKSPACE_ROOT_DIR` env var). Defaults: `./workspace` (local), `/workspace` (cloud).
- Runner start command uses absolute paths: `nohup /app/.venv/bin/python /app/main.py > /var/log/runner.log 2>&1 &`
- Poetry pinned to 2.1.2 in sandbox Dockerfile for reproducible builds
- Daytona auto-stop re-enabled at 120 min as safety net (Session 13); Python idle watchdog (5 min) is primary
- Stale runner timeout detection (90s heartbeat timeout -> STOPPED + cleanup) is deferred as a follow-up item
- The T01 design doc is at `_projects/2026-04/20260420.01.agent-runner-as-resource/tasks/T01_0_plan.md`
- `DAYTONA_API_KEY` is needed as a GitHub Actions secret for the cache-warming step (prod key)
- Daytona Java SDK Maven coordinates: `io.daytona:sdk:0.168.0` (NOT `io.daytona:sdk-java:0.1.0` as docs claim)
- All previous session context preserved in earlier sections of this file

## Blockers
- None blocking. Phase 1, Phase 2 prep, and Daytona removal are all complete. Next: Phase 0 deploy (ops tasks).

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-04/20260420.01.agent-runner-as-resource/next-task.md`

## Quick Commands
- "Continue with Phase 0 deploy" - ops tasks (Bazel build, staging deploy, DNS, e2e test)
- "Show project status" - Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
