---
name: Phase 1 Proto Codegen
overview: Add proto messages for MCP server tool/resource discovery to the mcpserver/v1 domain, add the updateDiscoveredCapabilities RPC, and run codegen for Go + Python stubs.
todos:
  - id: status-proto
    content: "Edit status.proto: update McpServerStatus comment, add discovered_capabilities field, add DiscoveredCapabilities/DiscoveredTool/DiscoveredResourceTemplate messages, add DiscoverySource enum, add required imports"
    status: completed
  - id: io-proto
    content: "Edit io.proto: add UpdateDiscoveredCapabilitiesInput message, add import for status.proto"
    status: completed
  - id: command-proto
    content: "Edit command.proto: add updateDiscoveredCapabilities RPC with IAM authorization options, add import for io.proto"
    status: completed
  - id: codegen
    content: Run `make build` in apis/ to lint, format, and generate Go + Python stubs
    status: completed
  - id: verify-stubs
    content: Verify generated Go stubs compile (go build ./...) and key types exist
    status: completed
isProject: false
---

# Phase 1: Proto Changes + Codegen for MCP Tool Discovery

## Scope

Modify 3 existing proto files and run `make build` in `apis/`. No server code, no seedpack, no CLI in this phase.

## Architecture Context

The existing `McpServerStatus` (field 99 = audit) only tracks structural validation. We are expanding it to also hold **discovered capabilities** — the tools and resource templates an MCP server reports. This is populated by:

1. Static seedpack bootstrap (Phase 2)
2. CLI discovery: `stigmer discover mcp-server <name>` (Phase 4)
3. Future: agent-runner runtime cache

The existing comment in status.proto explicitly says "tool discovery happens at RUNTIME, not here." We will **update that comment** to reflect the new model where the CLI drives discovery from the developer's machine.

---

## File 1: [status.proto](apis/ai/stigmer/agentic/mcpserver/v1/status.proto)

### Changes

- **Update** the `McpServerStatus` comment block (lines 7-17) to reflect the new model
- **Add** `discovered_capabilities` field (field 3) to `McpServerStatus`
- **Add** 4 new messages: `DiscoveredCapabilities`, `DiscoveredTool`, `DiscoveredResourceTemplate`
- **Add** 1 new enum: `DiscoverySource`
- **Add** imports for `google/protobuf/timestamp.proto` and `google/protobuf/struct.proto`

### Design decisions embedded in the proto

`**discovered_by` as an enum, not a string.** The T01 plan used `string discovered_by` with values "seedpack" / "cli" / "agent-runner". I am proposing an enum (`DiscoverySource`) instead, because:

- The codebase consistently uses enums for known value sets (e.g., `ValidationState`)
- Prevents typos and enables exhaustive switch statements
- Forward-compatible: new sources get new enum values

`**input_schema` as `google.protobuf.Struct`, not `string`.** The T01 plan used `string input_schema_json`. I am proposing `google.protobuf.Struct` because:

- It is the canonical proto representation for arbitrary JSON (JSON Schema is JSON)
- It enables natural YAML representation in seedpack files (Phase 2) — no escaped JSON strings
- protojson handles Struct natively in both directions
- It allows inspection without string parsing

`**DiscoveredResourceTemplate` (not `DiscoveredResource`)** — the MCP spec distinguishes between fixed-URI resources and parameterized URI templates. The CLI will call `ListResourceTemplates()`. The message name should reflect what it contains. If we later need to capture static resources from `ListResources()`, we add a new field.

### Exact proposed messages

```protobuf
// In McpServerStatus, add field 3:
DiscoveredCapabilities discovered_capabilities = 3;

// New messages:
message DiscoveredCapabilities {
  repeated DiscoveredTool tools = 1;
  repeated DiscoveredResourceTemplate resource_templates = 2;
  google.protobuf.Timestamp last_discovered_at = 3;
  DiscoverySource discovered_by = 4;
}

message DiscoveredTool {
  string name = 1;
  string description = 2;
  google.protobuf.Struct input_schema = 3;
}

message DiscoveredResourceTemplate {
  string uri_template = 1;
  string name = 2;
  string description = 3;
  string mime_type = 4;
}

enum DiscoverySource {
  DISCOVERY_SOURCE_UNSPECIFIED = 0;
  DISCOVERY_SOURCE_SEEDPACK = 1;
  DISCOVERY_SOURCE_CLI = 2;
  DISCOVERY_SOURCE_AGENT_RUNNER = 3;
}
```

---

## File 2: [io.proto](apis/ai/stigmer/agentic/mcpserver/v1/io.proto)

### Changes

- **Add** `UpdateDiscoveredCapabilitiesInput` message
- **Add** import for `status.proto` (for `DiscoveredCapabilities`)
- Keep existing `McpServerId` message unchanged

### Exact proposed message

```protobuf
message UpdateDiscoveredCapabilitiesInput {
  string mcp_server_id = 1 [(buf.validate.field).required = true];
  DiscoveredCapabilities discovered_capabilities = 2 [(buf.validate.field).required = true];
}
```

The CLI flow is: `getByReference(org/slug)` to get the ID, then call this RPC with the system ID.

---

## File 3: [command.proto](apis/ai/stigmer/agentic/mcpserver/v1/command.proto)

### Changes

- **Add** `updateDiscoveredCapabilities` RPC to `McpServerCommandController`
- **Add** import for `io.proto` (for `UpdateDiscoveredCapabilitiesInput`)

### Exact proposed RPC

```protobuf
rpc updateDiscoveredCapabilities(UpdateDiscoveredCapabilitiesInput) returns (McpServer) {
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).resource_kind = mcp_server;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).permission = can_edit;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).field_path = "mcp_server_id";
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).error_msg = "unauthorized to update mcp server capabilities";
}
```

Authorization uses `can_edit` — same as `update` — because updating discovered capabilities is a form of editing the resource.

---

## Codegen

Run from `apis/`:

```bash
make build
```

This runs: `lint` -> `fmt` -> `go-stubs` -> `python-stubs`, which:

1. Cleans old stubs
2. Runs `buf generate` for Go (writes to `stubs/go/`)
3. Fixes directory structure and runs `go mod tidy`
4. Runs gazelle for BUILD files
5. Runs `buf generate` for Python (writes to `stubs/python/`)

After codegen, the Go stubs module at `apis/stubs/go` will have the new types available for import by stigmer-server, CLI, and mcp-server.

---

## What this phase does NOT touch

- No seedpack YAML changes (Phase 2)
- No server-side RPC handler (Phase 3)
- No CLI discover command (Phase 4)
- No `stigmer-cloud` Java codegen (separate concern, tracked separately)

---

## Risk: buf lint

The proto changes must pass `buf lint` with the STANDARD rules configured in [buf.yaml](apis/buf.yaml). Key exceptions already in place: `RPC_PASCAL_CASE`, `ENUM_VALUE_PREFIX`, `ENUM_ZERO_VALUE_SUFFIX`, `ENUM_VALUE_UPPER_SNAKE_CASE` — so our enum naming should be fine. The `RPC_REQUEST_STANDARD_NAME` exception means our RPC input name (`UpdateDiscoveredCapabilitiesInput`) does not need to follow `*Request` convention.

## Risk: breaking change detection

buf.yaml has `breaking.use: [FILE]`. Since we are only **adding** new messages, fields, enums, and RPCs (no removals or renames), this should not trigger breaking change violations.