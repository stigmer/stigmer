# Fix Cloud Agent Execution Heartbeat Gaps and Environment Variable Alignment

**Date**: March 24, 2026

## Summary

Fixed cloud agent executions silently dying during Daytona sandbox creation due to missing Temporal heartbeats, and resolved environment variable misalignments between kustomize configurations and Python/Go code. Also added a GITHUB_TOKEN passthrough mechanism so agents with restrictive `env_spec` declarations can still clone private repositories during workspace provisioning.

## Problem Statement

Cloud-deployed agent executions were getting stuck with no visible response or logs. Even a simple question to the default assistant agent — with no workspace attachment — would hang for several minutes and then silently fail. The root cause was a combination of three issues that compounded in the cloud environment.

### Pain Points

- Every cloud execution (even trivial questions) creates a Daytona sandbox, which polls for readiness for up to 180 seconds via synchronous `time.sleep(2)` loops
- The Java workflow's `HeartbeatTimeout` was 2 minutes, but zero heartbeats were sent during the sandbox polling window — Temporal killed the activity before it could produce any output
- The Java workflow's `StartToCloseTimeout` was only 10 minutes (vs. 24 hours in the Go OSS workflow), prematurely killing long-running agent executions
- `MaximumAttempts` was set to 3, causing three identical timeout failures before permanent failure (~6 min total wall time of "stuck")
- `GITHUB_TOKEN` was silently filtered out by `env_spec` filtering when agents didn't explicitly declare it, breaking private repo cloning
- `STIGMER_LLM_BASE_URL` (set by kustomize) was ignored because Python config only read `OLLAMA_BASE_URL`
- CLI daemon set `TASK_QUEUE` but Python config expected `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE`

## Solution

### 1. Heartbeat Coverage During Sandbox Creation (Python)

Added a `heartbeat_fn` callback that threads through `execute_graphton.py` → `initialize_workspace()` → `SandboxManager.get_or_create_daytona_sandbox()` → `_create_daytona_sandbox()`. The callback fires immediately after sandbox creation and every ~30 seconds during the readiness polling loop.

### 2. Java Workflow Timeout Alignment (stigmer-cloud)

- `StartToCloseTimeout`: 10 min → 24 hours (matches Go OSS; HeartbeatTimeout is the real liveness check)
- `MaximumAttempts`: 3 → 1 (agent execution is not idempotent; retries cause duplicate side effects)

### 3. GITHUB_TOKEN Workspace Provisioning Passthrough

Added `injectWorkspaceProvisioningKeys()` in both Java (`CreateExecutionContextStep.java`) and Go (`create_execution_context_step.go`) that re-injects `GITHUB_TOKEN` from the pre-filtered merged env map when the session has `git_repo` workspace entries. This preserves least-privilege filtering while ensuring workspace provisioning always has the credentials it needs.

### 4. Environment Variable Name Alignment

- Python `config.py`: reads `STIGMER_LLM_BASE_URL` first, falls back to `OLLAMA_BASE_URL`
- Go `daemon_process.go`: uses `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE` instead of `TASK_QUEUE`

## Implementation Details

**Files changed (stigmer OSS — 6 files, +116/-8):**

- `backend/services/agent-runner/worker/activities/execute_graphton.py` — Added `heartbeat_during_setup("sandbox_init")` before workspace init, passed `heartbeat_fn` callback to `initialize_workspace()`, added `heartbeat_during_setup("workspace_ready")` after
- `backend/services/agent-runner/worker/workspace/__init__.py` — Added `heartbeat_fn` parameter, forwarded to `SandboxManager`
- `backend/services/agent-runner/worker/sandbox_manager.py` — Added `heartbeat_fn` parameter to `get_or_create_daytona_sandbox()` and `_create_daytona_sandbox()`, fires heartbeat on sandbox creation and every 15th poll iteration (~30s)
- `backend/services/agent-runner/worker/config.py` — `STIGMER_LLM_BASE_URL` with `OLLAMA_BASE_URL` fallback
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create_execution_context_step.go` — `injectWorkspaceProvisioningKeys()` re-injects `GITHUB_TOKEN` after `env_spec` filter when session has `git_repo` entries
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — `TASK_QUEUE` → `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE`

**Files changed (stigmer-cloud — 2 files, +55/-11):**

- `backend/services/stigmer-service/.../InvokeAgentExecutionWorkflowImpl.java` — `StartToCloseTimeout` 10m → 24h, `MaximumAttempts` 3 → 1
- `backend/services/stigmer-service/.../CreateExecutionContextStep.java` — Java mirror of `injectWorkspaceProvisioningKeys()`

## Benefits

- Cloud agent executions no longer silently die during sandbox creation
- Simple questions that previously hung for ~6 minutes now execute normally
- Private repo cloning works even when agents have restrictive `env_spec` declarations
- Kustomize-configured LLM base URL is properly picked up by the agent-runner
- CLI daemon correctly configures the task queue for the agent-runner subprocess

## Impact

- **Users**: Cloud agent executions that were 100% broken now work
- **Scope**: Agent-runner (Python), stigmer-server (Go), CLI (Go), stigmer-service (Java)
- **Risk**: Low — heartbeat callbacks are additive, timeout changes are relaxations, env var changes add fallback paths

## Related Work

- `2026-03-24-110635-fix-static-export-navigation-and-agent-runner-endpoint.md` — Fixed agent-runner gRPC endpoint to use internal k8s service
- `2026-03-19-184915-backend-env-spec-whitelist-filter.md` — Original env_spec filtering implementation
- `2026-03-19-190727-github-token-migration-to-personal-environment.md` — GITHUB_TOKEN storage in personal Environment

---

**Status**: ✅ Production Ready
