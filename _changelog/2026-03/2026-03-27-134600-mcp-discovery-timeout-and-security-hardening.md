# MCP Server Discovery Timeout Fix and Security Hardening

**Date**: March 27, 2026

## Summary

Fixed MCP server discovery timeouts caused by `go run` cold-start compilation exceeding the 45-second workflow timeout. Simultaneously hardened the MCP subprocess security model by filtering environment variables to only declared keys and removing Docker CLI from the agent-runner image.

## Problem Statement

MCP server discovery was failing with `asyncio.exceptions.CancelledError` when stdio servers required runtime compilation (e.g., `go run` downloading Go modules). The root cause was a layered timeout mismatch: the Java WorkflowRunTimeout (45s) was tighter than the Python activity timeout (60s), so the workflow was killed before the activity could report a meaningful error.

A security audit during investigation revealed two additional issues: MCP server subprocesses received the entire merged environment (including LLM keys, DB URIs, and other secrets not relevant to them), and the Docker CLI was present in the agent-runner image despite no active docker-based MCP servers.

### Pain Points

- Discovery failed on any MCP server requiring >45s cold start (Go compilation, npx install)
- The `CancelledError` provided no actionable diagnostic information
- Every MCP subprocess received all secrets from `merged_env_vars`, not just its declared needs
- Docker CLI in the image created an unnecessary container-escape attack surface

## Solution

Three coordinated changes across stigmer and stigmer-cloud repos:

1. **Layered timeout architecture** with configurable values: session init (270s) < activity (300s) < workflow run (330s)
2. **Env var filtering** in `config_transformer.py` to restrict subprocess env to declared `env_spec` keys
3. **Docker CLI removal** from the agent-runner Dockerfile

## Implementation Details

### Discovery Timeout (stigmer + stigmer-cloud)

- Added `discoveryWorkflowRunTimeoutSeconds` to `AgentExecutionTemporalConfig` (default: 330s, env-configurable)
- Replaced hardcoded `Duration.ofSeconds(45)` in `McpServerDiscoverCapabilitiesHandler` with the configurable value
- Increased Python `start_to_close_timeout` from 60s to 300s in `DiscoverMcpServerWorkflow`
- Added `asyncio.wait_for` with 270s timeout around session initialization with a descriptive error message

### Env Var Filtering (stigmer)

- Added `_filter_env_to_declared_keys()` in `config_transformer.py` that intersects `env_vars` with `spec.env_spec.data` keys
- Servers with no `env_spec` receive an empty dict (previously received everything)
- Logs filtered/dropped counts at INFO level and warns on missing declared keys

### Docker CLI Removal (stigmer)

- Removed `COPY --from=docker:27-cli` from the Dockerfile runtime stage
- Updated verification step and comments to reflect three supported runtimes (npx, uvx, go run)

## Benefits

- Discovery tolerates Go/Node cold starts up to 4.5 minutes (covers `go run`, `npx`, `uvx`, `docker run` scenarios)
- Clear, actionable timeout error message instead of generic `CancelledError`
- Timeout is configurable via `TEMPORAL_AGENT_EXECUTION_DISCOVERY_WORKFLOW_RUN_TIMEOUT_SECONDS` without redeployment
- MCP subprocesses can no longer see secrets they don't declare (principle of least privilege)
- Reduced container attack surface by removing Docker CLI

## Impact

- **Agent-runner**: Dockerfile smaller, no Docker CLI binary; MCP subprocess env scoped to declared keys
- **stigmer-cloud**: Discovery workflow timeout configurable, default raised from 45s to 330s
- **All MCP servers**: Only receive env vars matching their `env_spec.data` declarations

## Related Work

- Discovery credential security via ExecutionContext (2026-03-27-094850, 2026-03-27-102916)
- MCP server discovery and approval policy generation (2026-03-27-092434)
- Heartbeat timeout fix during workspace provisioning (2026-03-26-165233)

---

**Status**: ✅ Production Ready
