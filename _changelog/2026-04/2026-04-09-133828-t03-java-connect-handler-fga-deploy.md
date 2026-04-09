# T03: Java Connect Handler + FGA Model Deployment

**Date**: April 9, 2026

## Summary

Completed the Java backend handlers for the MCP server connect flow in stigmer-cloud. Replaced the two old discovery handlers with a single `McpServerConnectHandler`, deployed the updated FGA authorization model to production, and fixed the registry sync activity to properly handle user-owned `pinned_tool_approvals`.

## Problem Statement

After T01 restructured the proto model (deleting `updateDiscoveredCapabilities` RPC, renaming `discoverCapabilities` to `connect`, replacing `default_tool_approvals` with `pinned_tool_approvals`), the Java backend in stigmer-cloud was out of sync with the generated protobuf stubs and would not compile. The FGA authorization model with the new `can_connect` permission had not been deployed to production.

### Pain Points

- `McpServerDiscoverCapabilitiesHandler` referenced deleted types (`DiscoverCapabilitiesInput`, `DiscoverySource`)
- `McpServerUpdateDiscoveredCapabilitiesHandler` referenced a deleted RPC (`updateDiscoveredCapabilities`)
- `UpsertMcpServerBatchActivityImpl` called `getDefaultToolApprovalsList()` on a field that no longer exists
- The FGA model in production lacked `can_connect` permission, blocking the new connect flow

## Solution

Replaced the two old handlers with a single `McpServerConnectHandler` that aligns with the new proto API surface. Deleted the update-discovered handler entirely rather than replacing it — a design decision that eliminated an unnecessary platform-level backdoor RPC. Applied the FGA model to production and fixed the registry sync to properly handle user-owned fields.

## Implementation Details

### McpServerConnectHandler (new)

Replaces `McpServerDiscoverCapabilitiesHandler` with updated routing, auth, and persistence:

- **Route**: `McpServerCommandController.Method.connect`
- **Auth**: `IamPermission.can_connect` (viewers and above can trigger connect)
- **Workflow**: Starts `"stigmer/mcp-server/discover"` Temporal workflow (name coordinated with Go + Python for T02)
- **Persistence**: New `StoreConnectResults` step persists both `status.discovered_capabilities` and `status.tool_approvals` from workflow output, forward-compatible with T02's LLM classifier

### McpServerUpdateDiscoveredCapabilitiesHandler (deleted)

The T03 plan originally called for renaming this to `McpServerObserveStatusHandler` with platform-level `can_update_mcp_server_status` auth. Instead, the handler was deleted entirely — the `connect` RPC is the single code path for all status writes, keeping `status` as purely system-derived.

### UpsertMcpServerBatchActivityImpl (fixed)

Changed from conditional `default_tool_approvals` merge to unconditional `pinned_tool_approvals` preservation. The registry sync has no business touching user-owned approval overrides — it unconditionally copies them from the existing record.

### FGA Model Deployment

Applied the authorization model (which already included `can_connect: viewer` from T01) to the production OpenFGA store. Updated the model ID in `openfga-config.yaml` and applied via Planton.

## Benefits

- **Compilation fixed**: stigmer-cloud backend compiles against the new proto stubs
- **Simpler API surface**: One handler (`connect`) instead of two (`discover` + `updateDiscovered`)
- **Correct ownership semantics**: Registry sync cannot accidentally overwrite user's pinned tool approvals
- **Production-ready auth**: `can_connect` permission is live in the FGA model — viewers can connect to MCP servers
- **Forward-compatible**: `StoreConnectResults` already handles `tool_approvals` from workflow output, ready for T02's classifier

## Impact

- **stigmer-cloud**: 2 handlers deleted, 1 created, 4 files modified, 1 config updated
- **Production FGA**: New model deployed (ID: `01KNRKV8VWQWD77KNJRCGHYVX7`)
- **Downstream**: T02 (Python classifier) and T04 (React SDK) are now fully unblocked

## Related Work

- **T01**: Proto model + FGA model file + codegen (prerequisite, same project)
- **T02**: Python classifier + connect workflow (next, unblocked)
- **T04**: React SDK UI redesign (unblocked, can parallelize with T02)
- Project: `_projects/2026-04/20260408.02.mcp-connect-flow`

---

**Status**: Production Ready
**Timeline**: ~1 hour (T03 execution)
