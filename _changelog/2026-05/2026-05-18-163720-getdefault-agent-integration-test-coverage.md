# Integration Test Coverage for `getDefault` Agent RPC

**Date**: May 18, 2026

## Summary

Added integration tests that exercise the `AgentQueryController.getDefault` RPC — the exact code path the desktop app calls when loading the default agent on startup. Previously, the test suite (423 tests) never called this endpoint directly, leaving a gap where the desktop app could show "Failed to load default agent" without any test catching it.

## Problem Statement

The desktop app calls `getDefault` when a user opens the app or starts a new conversation. If this RPC fails, the user sees "Failed to load default agent. Please try again." — a first-impression failure. The integration test suite did not exercise this RPC at all.

### Pain Points

- The `Clients` struct in the test harness had `AgentCommand` but no `AgentQuery` — making it structurally impossible for any test to call `getDefault`
- The only "default agent" test coverage was indirect, via `AgentExecutionCreateHandler`'s internal resolution logic — a completely different code path from what the frontend hits
- The `AgentGetDefaultHandler` pipeline (validate → load by label → authorize → respond) was untested end-to-end

## Solution

Two-part fix: wire the missing gRPC client into the test harness, then add targeted integration tests that replicate the desktop app's startup flow.

## Implementation Details

### 1. Test harness client (`test/integration/harness/clients.go`)

Added `AgentQuery agentv1.AgentQueryControllerClient` to the `Clients` struct and wired `agentv1.NewAgentQueryControllerClient(conn)` in `NewClients()`. No new imports needed — `agentv1` was already imported for `AgentCommand`.

### 2. Integration tests (`test/integration/agent_query_test.go`)

Three tests covering the `getDefault` RPC contract:

- **`TestAgentQuery_GetDefault_ReturnsSeededAgent`** — Calls `getDefault` with the test org. Asserts the response has the `stigmer.ai/default-agent=true` label, `visibility_public`, and a populated `status.default_instance_id` (which the desktop app needs to create sessions).

- **`TestAgentQuery_GetDefault_EmptyOrg_Rejected`** — Validates proto-level input validation: empty `org` returns `INVALID_ARGUMENT`.

- **`TestAgentQuery_GetDefault_ResponseShape`** — Validates the full response structure that frontend clients depend on: `api_version`, `kind`, `metadata.id`, `metadata.name`, `metadata.org`, `spec.description`, `spec.instructions`, and `status.default_instance_id`.

## Benefits

- The exact RPC the desktop app calls on startup is now tested end-to-end
- Input validation, label resolution, authorization, and response shape are all verified
- The `AgentQuery` client is now available in the harness for future agent query tests (`get`, `getByReference`)

## Impact

- **Files changed**: 2 (1 modified, 1 new)
- **Test count**: 296 pass (+3 new), 0 fail, 134 skip
- **Coverage gap closed**: `AgentGetDefaultHandler` pipeline now has direct integration test coverage

## Related Work

- Builds on `2026-05-18-160824-integration-test-remaining-five-failures-fixed.md` which added the `seedDefaultAgent()` fixture
- The seeded default agent from `TestMain` serves as the fixture for these tests

---

**Status**: Production Ready
**Timeline**: Single session
