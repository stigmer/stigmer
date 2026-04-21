# Runner Auth Migration: STIGMER_TOKEN

**Date**: April 21, 2026

## Summary

Migrated the agent-runner from the machine-account API key + on-behalf-of (OBO) impersonation model to a single user-owned credential (`STIGMER_TOKEN`). The runner now authenticates as the triggering user directly — no impersonation, no dual channels, no `can_impersonate` privilege. This is Phase 1 item 12 of the AgentRunner-as-resource project.

## Problem Statement

The agent-runner previously used a platform-wide machine account API key (`STIGMER_API_KEY`) with an `x-on-behalf-of` header for user-scoped operations. This created a security surface where the machine account had `can_impersonate` privileges — effectively a superuser key that could act as any user. The dual-channel architecture (system channel for status updates, OBO channel for user reads) added complexity to every activity.

## Solution

### Single Credential, Single Channel

- **`STIGMER_TOKEN`**: New canonical environment variable. Accepts any credential type (JWT or API key). `STIGMER_API_KEY` accepted as a convenience alias.
- **`ChannelProvider`**: Simplified from dual-channel (system + OBO) to a single authenticated channel. All operations use the same channel because the token IS the user's identity.
- **`AuthClientInterceptor`**: Renamed `api_key` -> `token`. Wire behavior unchanged (`Authorization: Bearer <token>`).
- **`OnBehalfOfInterceptor`**: Deleted. No impersonation needed when the runner authenticates as the user.

### Changes by Layer

**Auth Foundation:**
- Created `worker/auth.py` replacing `worker/token_manager.py`
- Clean API: `configure(token)` + `get_token()`

**Config:**
- `Config.stigmer_api_key` renamed to `Config.stigmer_token`
- Token resolution: `STIGMER_TOKEN || STIGMER_API_KEY || dummy (local mode)`
- `CheckpointerConfig` and `ArtifactStorageConfig` receive `auth_token` from parent `Config` instead of reading `STIGMER_API_KEY` directly

**gRPC Clients (7 files):**
- `api_key` parameter renamed to `token` in all client constructors

**Activities (3 files):**
- `execute_graphton`, `generate_session_subject`, `discover_mcp_server` simplified to `ChannelProvider(token)` — no `invoker_identity_account_id` passed to channel construction

**Setup Pipeline:**
- Removed `sys_ch`/`obo_ch` dual-channel pattern from `setup.py`
- Single `ch = grpc_provider.channel` for all clients
- Removed `invoker_identity_account_id` parameter from `perform_setup()` and `_perform_setup_core()`

**Java Launcher (stigmer-cloud):**
- `DaytonaSandboxRunnerLauncher.buildEnvVars()`: `STIGMER_USER_JWT` -> `STIGMER_TOKEN`

## Files Changed

### stigmer (Python agent-runner)

**Created:**
- `backend/services/agent-runner/worker/auth.py`

**Deleted:**
- `backend/services/agent-runner/worker/token_manager.py`
- `backend/services/agent-runner/grpc_client/auth/on_behalf_of_interceptor.py`

**Modified:**
- `backend/services/agent-runner/worker/config.py`
- `backend/services/agent-runner/worker/worker.py`
- `backend/services/agent-runner/worker/logging.yaml`
- `backend/services/agent-runner/worker/storage/__init__.py`
- `backend/services/agent-runner/grpc_client/channel.py`
- `backend/services/agent-runner/grpc_client/auth/client_interceptor.py`
- `backend/services/agent-runner/grpc_client/agent_execution_client.py`
- `backend/services/agent-runner/grpc_client/agent_client.py`
- `backend/services/agent-runner/grpc_client/agent_instance_client.py`
- `backend/services/agent-runner/grpc_client/session_client.py`
- `backend/services/agent-runner/grpc_client/skill_client.py`
- `backend/services/agent-runner/grpc_client/mcp_server_client.py`
- `backend/services/agent-runner/grpc_client/execution_context_client.py`
- `backend/services/agent-runner/worker/activities/execute_graphton.py`
- `backend/services/agent-runner/worker/activities/generate_session_subject.py`
- `backend/services/agent-runner/worker/activities/discover_mcp_server.py`
- `backend/services/agent-runner/worker/activities/graphton/setup.py`

### stigmer-cloud (Java launcher)

**Modified:**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/DaytonaSandboxRunnerLauncher.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentrunner/launcher/RunnerLauncher.java`

## Known Limitations

1. **JWT expiry**: Ephemeral runner JWTs are captured at execution-create time. Long-running executions (>1h) may hit `UNAUTHENTICATED`. TokenExchangeService (future) will mint short-lived runner-scoped tokens.
2. **Persistent runners should use API keys**: API keys (`stk_*`) have long/no expiry, making them suitable for always-on runners. The CLI `stigmer runner start` flow should default to the user's configured API key.
