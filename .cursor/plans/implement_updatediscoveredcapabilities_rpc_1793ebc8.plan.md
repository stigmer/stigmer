---
name: Implement updateDiscoveredCapabilities RPC
overview: Implement the updateDiscoveredCapabilities RPC handler in both Go (stigmer OSS) and Java (stigmer-cloud), plus the Go downstream client method. No bootstrap wiring, no CLI command, no discovery library in this scope.
todos:
  - id: go-rpc-handler
    content: Implement UpdateDiscoveredCapabilities in Go mcpserver controller with custom pipeline (validate, load by ID, set capabilities + audit, persist)
    status: completed
  - id: go-downstream-client
    content: Add UpdateDiscoveredCapabilities method to Go downstream mcpserver client
    status: completed
  - id: go-build
    content: Update BUILD.bazel files and verify Go compilation
    status: completed
  - id: java-handler
    content: Implement McpServerUpdateDiscoveredCapabilitiesHandler in Java with CustomOperationHandlerV2, FGA authorization, and pipeline
    status: completed
  - id: java-build
    content: Verify Java compilation (auto-controller picks up new handler)
    status: completed
isProject: false
---

# Implement updateDiscoveredCapabilities RPC (Go + Java)

## Scope

Implement the `updateDiscoveredCapabilities` RPC handler in both repos:

- **Go (stigmer)**: Controller handler + downstream client method
- **Java (stigmer-cloud)**: Handler with authorization (FGA)

Out of scope: bootstrap wiring, CLI discover command, Go MCP SDK discovery library.

---

## Part 1: Go (stigmer repo)

### 1a. RPC Handler

**New file:** `backend/services/stigmer-server/pkg/domain/mcpserver/controller/update_discovered_capabilities.go`

This is a custom RPC (not standard CRUD), following the `push.go` pattern from the skill controller. Takes `UpdateDiscoveredCapabilitiesInput`, returns `McpServer`.

**Pipeline:**

1. `ValidateProto` — validate `UpdateDiscoveredCapabilitiesInput` (buf.validate: `mcp_server_id` required, `discovered_capabilities` required)
2. `LoadMcpServerById` — custom step: load existing MCP server from store using `input.mcp_server_id`
3. `SetDiscoveredCapabilities` — custom step: set `status.discovered_capabilities` from input, update audit fields
4. `Persist` — save updated MCP server using `store.SaveResource`

Key references:

- [backend/services/stigmer-server/pkg/domain/skill/controller/push.go](backend/services/stigmer-server/pkg/domain/skill/controller/push.go) — custom pipeline pattern (lines 47-65 show the `Push` method, lines 69-80 show `buildPushPipeline`)
- [backend/services/stigmer-server/pkg/domain/mcpserver/controller/mcpserver_controller.go](backend/services/stigmer-server/pkg/domain/mcpserver/controller/mcpserver_controller.go) — controller struct to add the method to

The handler implements `McpServerCommandControllerServer.UpdateDiscoveredCapabilities(ctx, *UpdateDiscoveredCapabilitiesInput) (*McpServer, error)` which is currently returning "unimplemented" from the embedded `UnimplementedMcpServerCommandControllerServer`.

### 1b. Downstream Client

**Edit:** [backend/services/stigmer-server/pkg/downstream/mcpserver/client.go](backend/services/stigmer-server/pkg/downstream/mcpserver/client.go)

Add `UpdateDiscoveredCapabilities` method:

```go
func (c *Client) UpdateDiscoveredCapabilities(ctx context.Context, input *mcpserverv1.UpdateDiscoveredCapabilitiesInput) (*mcpserverv1.McpServer, error)
```

Follows the same pattern as existing `Apply`, `Create`, `Update` methods (lines 96-126).

### 1c. BUILD.bazel Updates

- `backend/services/stigmer-server/pkg/domain/mcpserver/controller/BUILD.bazel` — add new `.go` file
- `backend/services/stigmer-server/pkg/downstream/mcpserver/BUILD.bazel` — add any new deps if needed

---

## Part 2: Java (stigmer-cloud repo)

### 2a. Handler

**New file:** `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/mcpserver/request/handler/McpServerUpdateDiscoveredCapabilitiesHandler.java`

Extends `CustomOperationHandlerV2<UpdateDiscoveredCapabilitiesInput, McpServer>` — the same base class used by `McpServerGetByReferenceHandler` and `SearchHandler` for non-CRUD operations.

**Pipeline:**

1. `ValidateFieldConstraints` — common step, validates proto field constraints
2. `LoadFromRepo` — custom step: load MCP server by `input.getMcpServerId()` using `McpServerRepo.findById()`
3. `Authorize` — custom step: FGA check for `can_edit` permission on the loaded MCP server (matches proto-level `rpc_authorization` config)
4. `SetDiscoveredCapabilities` — custom step: build new `McpServer` with `status.discovered_capabilities` set from input, update audit timestamps
5. `Persist` — custom step: save via `McpServerRepo.save()`
6. `Publish` — common step: publish resource update event
7. `TransformResponse` — common step
8. `SendResponse` — common step

**Routing annotation:**

```java
@RequestRoute(controller = McpServerCommandControllerGrpc.class,
        method = McpServerCommandController.Method.updateDiscoveredCapabilities)
```

Key references:

- [McpServerGetByReferenceHandler.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/mcpserver/request/handler/McpServerGetByReferenceHandler.java) — `CustomOperationHandlerV2` pattern with custom load + authorize steps
- [McpServerUpdateHandler.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/mcpserver/request/handler/McpServerUpdateHandler.java) — pipeline with authorize step using `can_edit`
- [McpServerRepo.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/mcpserver/repo/McpServerRepo.java) — repo for `findById` and `save`

### 2b. Auto-Controller

The `@AutoGrpcRouterController` on [McpServerGrpcAutoController.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/mcpserver/request/controller/McpServerGrpcAutoController.java) should automatically pick up the new handler via the `@RequestRoute` annotation at compile time. The annotation processor generates the routing, so no manual wiring is needed. The generated `McpServerCommandController.Method` enum should already include `updateDiscoveredCapabilities` from the proto stubs.

---

## Files Summary

**stigmer (Go):**

- New: `backend/services/stigmer-server/pkg/domain/mcpserver/controller/update_discovered_capabilities.go`
- Edit: `backend/services/stigmer-server/pkg/downstream/mcpserver/client.go`
- Edit: `backend/services/stigmer-server/pkg/domain/mcpserver/controller/BUILD.bazel`
- Edit: `backend/services/stigmer-server/pkg/downstream/mcpserver/BUILD.bazel` (if needed)

**stigmer-cloud (Java):**

- New: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/mcpserver/request/handler/McpServerUpdateDiscoveredCapabilitiesHandler.java`

