# Fix Desktop Dev Pipeline: Replace Dead CLI Sidecar with Runner Build

**Date**: May 23, 2026

## Summary

Fixed the desktop app dev pipeline so `make desktop-dev` rebuilds the TypeScript runner before launching, ensuring code changes in `backend/services/runner/` are immediately available. Removed the orphaned Go CLI sidecar that was being built but never invoked since the May 2026 unified runner migration. Added diagnostic logging to the `CallAgent` activity's env forwarding chain and a new integration test covering the MCP-server-env workflow scenario.

## Problem Statement

When a workflow `agent_call` task failed with "MCP server 'postgres' requires environment variable 'POSTGRES_CONNECTION_URL' which is not provided," the env forwarding fix (commit `0dfd3de7a`) had been correctly implemented and committed — but the error persisted because the desktop app never picked up the fix.

### Pain Points

- `make desktop-dev` built the Go CLI sidecar (dead code) but never built the TypeScript runner that actually executes workflow activities
- The runner runs as a local Node.js child process inside the Tauri app, spawned from `resources/runner/dist/main.js` — but this pre-built artifact was stale
- No diagnostic logging existed in the env forwarding chain, making it impossible to trace where env vars were being lost without code changes
- The integration test for env forwarding created agents with explicit env declarations, missing the production scenario where declarations come from MCP server references via `MergeMcpServerEnvSpecsStep`
- The Go CLI sidecar (`setup-sidecar-dev.sh`, `externalBin`, `tauri-plugin-shell`) was orphaned since the unified runner migration but still consumed build time and added dead dependencies

## Solution

### 1. Fix Desktop Dev Pipeline

Replaced the sidecar build in `launch-desktop` and `release-desktop-local` with:

```makefile
$(MAKE) build-runner                              # compile runner from latest source
client-apps/desktop/scripts/setup-runner-dev.sh   # verify runner symlink
```

The existing `resources/runner` symlink already pointed to `backend/services/runner/`. The new script (`setup-runner-dev.sh`) verifies the symlink is correct and recreates it if needed.

### 2. Remove Dead CLI Sidecar

Removed all artifacts from the May 2026 unified runner migration that were no longer invoked:

- **Deleted**: `setup-sidecar-dev.sh`, `src-tauri/binaries/` directory
- **Cleaned**: `externalBin` from `tauri.conf.json`, shell permissions from `capabilities/default.json`
- **Removed**: `tauri-plugin-shell` from Cargo.toml, lib.rs, and package.json

### 3. Diagnostic Logging

Added structured logging to `call-agent.ts` at three decision points:
- After agent fetch: logs agent env declarations vs workflow env keys
- After intersection: warns about declared keys missing from workflow env
- After task-config override: logs forwarding summary (intersection count, override count, final keys)

### 4. Integration Test

Added `TestWorkflowAgentCall_EnvVarsForwardedWithMcpServerRef` that covers the exact production scenario:
1. Creates an MCP server with `spec.env` declaring `TEST_MCP_CONN_URL`
2. Creates an agent referencing it via `mcp_server_usages` (no explicit env declaration)
3. Verifies `MergeMcpServerEnvSpecsStep` merged the MCP env into `agent.spec.env`
4. Runs a workflow with the var in `runtime_env` and verifies it reaches the child `ExecutionContext`

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `Makefile` | Replace `setup-sidecar-dev.sh` with `build-runner` + `setup-runner-dev.sh` in `launch-desktop` and `release-desktop-local` |
| `client-apps/desktop/scripts/setup-runner-dev.sh` | New: idempotent runner symlink verification |
| `client-apps/desktop/scripts/setup-sidecar-dev.sh` | Deleted |
| `client-apps/desktop/src-tauri/tauri.conf.json` | Replace `externalBin` with `resources` for runner |
| `client-apps/desktop/src-tauri/capabilities/default.json` | Remove stale shell:allow-spawn/execute permissions |
| `client-apps/desktop/src-tauri/Cargo.toml` | Remove `tauri-plugin-shell` |
| `client-apps/desktop/src-tauri/src/lib.rs` | Remove `tauri_plugin_shell::init()` |
| `client-apps/desktop/package.json` | Remove `@tauri-apps/plugin-shell` |
| `client-apps/desktop/src-tauri/binaries/.gitignore` | Deleted |
| `backend/services/runner/src/activities/call-agent.ts` | Add diagnostic logging, fix pre-existing TS2352 |
| `test/integration/workflow_agent_call_env_forwarding_test.go` | Add MCP-env-from-workflow test, fix pre-existing `RecoverWorkflowExecutionInput` field name |

## Benefits

- `make desktop-dev` now rebuilds the runner on every launch — code changes in `backend/services/runner/` are immediately deployed
- Dead CLI sidecar removed — smaller bundle, fewer dependencies, no wasted build time
- Env forwarding chain is observable via structured logging — no more guessing where vars are lost
- Integration test covers the realistic production scenario (MCP server env via `mcp_server_usages`)

## Impact

- **Desktop app**: Runner code changes take effect immediately on `make desktop-dev`
- **CI**: `tauri-plugin-shell` removal reduces Rust compile time and binary size
- **Debugging**: `[CallAgent]` log lines trace env forwarding decisions at runtime
- **Test coverage**: New integration test prevents regression on the MCP-env-from-workflow path

## Related Work

- Fix workflow agent_call env forwarding and ALREADY_EXISTS recovery (20260523-145540)
- Desktop embedded runner and execution target routing (20260520-215359)

---

**Status**: Production Ready
