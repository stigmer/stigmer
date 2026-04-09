# Task T03: Java Handlers + Auth Wiring

**Created**: 2026-04-08
**Status**: PENDING (blocked on T01)
**Scope**: stigmer-cloud — `backend/services/stigmer-service/`
**Estimated effort**: Moderate — handler renames with auth model changes, wiring updates

## Objective

Rename and rewire the Java request handlers for the MCP server Connect and ObserveStatus RPCs, updating authorization checks to use the new FGA permissions.

## Detailed Changes

### 1. Rename: DiscoverCapabilitiesHandler → ConnectHandler

**File**: Rename `McpServerDiscoverCapabilitiesHandler.java` → `McpServerConnectHandler.java`

Location: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/mcpserver/request/handler/`

Changes from the existing handler:

| Aspect | Before | After |
|--------|--------|-------|
| Class name | `McpServerDiscoverCapabilitiesHandler` | `McpServerConnectHandler` |
| Auth | `can_edit` on `mcp_server` resource | `can_connect` on `mcp_server` resource |
| Temporal workflow | `stigmer/mcp-server/discover` | `stigmer/mcp-server/connect` |
| Workflow output | `DiscoverMcpServerOutput` (tools + resource_templates) | `ConnectMcpServerOutput` (tools + resource_templates + tool_approvals) |
| Persistence | `status.discovered_capabilities` only | `status.discovered_capabilities` + `status.tool_approvals` |

The handler flow remains the same pattern:
1. Validate input
2. Load McpServer from repo
3. Authorize (`can_connect` instead of `can_edit`)
4. Create ephemeral ExecutionContext with resolved env vars
5. Start Temporal workflow `stigmer/mcp-server/connect` on runner queue
6. Block on result
7. Map workflow output to proto fields
8. Persist `status.discovered_capabilities` + `status.tool_approvals`
9. Cleanup ExecutionContext in `finally`
10. Return updated McpServer

### 2. Rename: UpdateDiscoveredCapabilitiesHandler → ObserveStatusHandler

**File**: Rename `McpServerUpdateDiscoveredCapabilitiesHandler.java` → `McpServerObserveStatusHandler.java`

Changes:

| Aspect | Before | After |
|--------|--------|-------|
| Class name | `McpServerUpdateDiscoveredCapabilitiesHandler` | `McpServerObserveStatusHandler` |
| Auth | `can_edit` on `mcp_server` resource (via RPC annotation) | Platform `can_update_mcp_server_status` (manual check) |
| Input | `UpdateDiscoveredCapabilitiesInput` (mcp_server_id + discovered_capabilities) | `ObserveMcpServerStatusInput` (mcp_server_id + discovered_capabilities + tool_approvals) |
| Persistence | `status.discovered_capabilities` only | `status.discovered_capabilities` + `status.tool_approvals` |

For the platform-level auth check, follow the pattern used by execution status update handlers — the RPC is marked `is_skip_authorization = true` in the proto, and the handler manually checks `can_update_mcp_server_status` against `platform:stigmer`.

### 3. Update Handler Registration / Request Routing

Find where handlers are registered (likely a Spring `@Configuration` class or handler registry) and update:
- Class name references
- Any explicit method/RPC name mappings

### 4. Update Temporal Workflow Type References

The Java handler starts the Temporal workflow by name string. Update:
- `"stigmer/mcp-server/discover"` → `"stigmer/mcp-server/connect"` in the Connect handler
- The ObserveStatus handler does NOT start a Temporal workflow — it's a direct status write

### 5. Update gRPC Service Registration

The proto-generated gRPC service interface will have new method names (`connect` instead of `discoverCapabilities`, `observeMcpServerStatus` instead of `updateDiscoveredCapabilities`). The handler implementations need to match the new interface.

## Key References

| File | Role |
|------|------|
| `McpServerDiscoverCapabilitiesHandler.java` | Current discover handler (rename target) |
| `McpServerUpdateDiscoveredCapabilitiesHandler.java` | Current update handler (rename target) |
| `platform.fga` | Platform auth model (`can_update_mcp_server_status`) |
| `mcp_server.fga` | Resource auth model (`can_connect`) |
| Execution status handlers | Pattern for platform-level auth checks |

## Success Criteria

- [ ] `McpServerConnectHandler` starts `stigmer/mcp-server/connect` workflow
- [ ] `McpServerConnectHandler` checks `can_connect` permission
- [ ] `McpServerConnectHandler` persists both `status.discovered_capabilities` and `status.tool_approvals`
- [ ] `McpServerObserveStatusHandler` checks `can_update_mcp_server_status` on `platform:stigmer`
- [ ] `McpServerObserveStatusHandler` accepts and persists both capabilities + tool_approvals
- [ ] Handler registration updated
- [ ] `make check` (Bazel build + tests) passes in stigmer-cloud

## Next Task

**T04**: React SDK + UI Redesign + Cleanup (stigmer OSS)
