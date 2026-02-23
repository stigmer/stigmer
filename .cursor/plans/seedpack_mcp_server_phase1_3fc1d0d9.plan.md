---
name: Seedpack MCP Server Phase1
overview: "Add MCP server support to the seedpack package: a new manifest entry type, embedded YAML definition, Go loader functions, and tests — all following the existing agent pattern exactly."
todos:
  - id: create-yaml
    content: Create mcp-servers/stigmer-mcp-server.yaml with the McpServer proto-compliant YAML definition
    status: completed
  - id: update-manifest
    content: "Update manifest.json: bump schema_version to 3, version to 1.2.0, add mcp_servers array"
    status: completed
  - id: update-embed
    content: "Update embed.go: add //go:embed mcp-servers/* directive and doc comment"
    status: completed
  - id: update-seedpack-go
    content: "Update seedpack.go: add McpServerEntry, Manifest.McpServers, LoadMcpServerYAML, GetMcpServerByName"
    status: completed
  - id: update-bazel
    content: "Update BUILD.bazel: add mcp-servers/** glob and mcpserver proto dep"
    status: completed
  - id: update-tests
    content: "Update seedpack_test.go: fix existing assertions, add MCP server test cases"
    status: completed
  - id: run-tests
    content: Run bazel test to verify everything compiles and passes
    status: completed
isProject: false
---

# Phase 1: Seedpack — Add MCP Server Resource

## Context

The seedpack currently has two resource types: **skills** (with ZIP artifacts) and **system agents** (with YAML definitions). We are adding a third: **MCP servers** (YAML definitions, same pattern as agents).

The existing agent pattern in the seedpack is:

- `AgentEntry` struct in `Manifest` with `Name` + `Path`
- `LoadAgentYAML()` reads embedded YAML, converts YAML-to-JSON-to-protojson into `agentv1.Agent`
- `GetAgentByName()` does a manifest lookup
- Embedded via `//go:embed agents/`* directive

We replicate this pattern precisely for MCP servers, using the `McpServer` proto from `apis/ai/stigmer/agentic/mcpserver/v1/api.proto`.

## Files to Change

### 1. Update manifest — [manifest.json](backend/services/stigmer-server/pkg/seedpack/manifest.json)

- Bump `schema_version` from `"2"` to `"3"` (new field added)
- Bump `version` from `"1.1.0"` to `"1.2.0"` (new resource type)
- Add `"mcp_servers"` array with one entry:

```json
"mcp_servers": [
  {
    "name": "stigmer-mcp-server",
    "path": "mcp-servers/stigmer-mcp-server.yaml"
  }
]
```

### 2. Create MCP server YAML — `backend/services/stigmer-server/pkg/seedpack/mcp-servers/stigmer-mcp-server.yaml` (new file)

Following the `McpServer` proto schema from `api.proto`, matching the exact pattern used by `skill-creator-agent.yaml`:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: stigmer-mcp-server
  labels:
    stigmer.ai/system: "true"
spec:
  description: "Built-in MCP server that exposes Stigmer resources (agents, skills, workflows, MCP servers) to MCP clients via the Model Context Protocol."
  tags:
    - system
    - built-in
  stdio:
    command: "stigmer"
    args:
      - "mcp-server"
```

### 3. Extend Go types and loaders — [seedpack.go](backend/services/stigmer-server/pkg/seedpack/seedpack.go)

- Add `McpServerEntry` struct (same shape as `AgentEntry`: `Name` + `Path`)
- Add `McpServers []McpServerEntry` field to `Manifest` struct
- Add `LoadMcpServerYAML(path string) (*mcpserverv1.McpServer, error)` — follows `LoadAgentYAML` pattern exactly (read embedded file, YAML-to-JSON, protojson unmarshal)
- Add `GetMcpServerByName(name string) (*McpServerEntry, error)` — follows `GetAgentByName` pattern

Key import to add: `mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"`

The internal `parseAgentYAML` and helper functions (`yamlMapToJSON`, `convertYAMLValue`) are already generic — `LoadMcpServerYAML` will reuse `yamlMapToJSON` and `convertYAMLValue` directly, with a new `parseMcpServerYAML` that targets `mcpserverv1.McpServer` instead of `agentv1.Agent`.

### 4. Add embed directive — [embed.go](backend/services/stigmer-server/pkg/seedpack/embed.go)

Add one line to the embed directives:

```go
//go:embed mcp-servers/*
```

Update the doc comment to mention `mcp-servers/*: MCP server YAML definitions`.

### 5. Update Bazel build — [BUILD.bazel](backend/services/stigmer-server/pkg/seedpack/BUILD.bazel)

- Add `"mcp-servers/**"` to the `embedsrcs` glob list
- Add `"//apis/stubs/go/ai/stigmer/agentic/mcpserver/v1:mcpserver"` to `deps`

### 6. Add tests — [seedpack_test.go](backend/services/stigmer-server/pkg/seedpack/seedpack_test.go)

Following the existing test patterns:

- `TestLoadManifest` — update expected `SchemaVersion` to `"3"`, `Version` to `"1.2.0"`, add MCP servers count assertion
- `TestLoadManifest_McpServerEntry` — validate the `stigmer-mcp-server` entry exists with correct path
- `TestLoadMcpServerYAML` — load and validate the parsed `McpServer` proto (metadata, spec, stdio config)
- `TestGetMcpServerByName` — test found and not-found cases

## Execution Order

The changes must be made in this order to maintain a coherent state:

1. Create `mcp-servers/stigmer-mcp-server.yaml` (new file)
2. Update `manifest.json` (add mcp_servers array, bump versions)
3. Update `embed.go` (add embed directive)
4. Update `seedpack.go` (add types and loaders)
5. Update `BUILD.bazel` (add glob and dep)
6. Update `seedpack_test.go` (add and update tests)
7. Run tests to verify

## Design Notes

- **No new `parseMcpServerYAML` helper is strictly required** — We could write a generic `parseResourceYAML[T proto.Message]()` function. However, Go generics with protojson require a `proto.Message` constraint, and the seedpack currently only has two resource types. A generic approach would be premature. Instead, we write `parseMcpServerYAML` mirroring `parseAgentYAML` — straightforward, testable, no abstraction debt.
- **Schema version "3"** — Signals to any future migration logic that `mcp_servers` field exists. Good hygiene even if not currently enforced.
- **No `artifact_path` or `content_digest`** — MCP servers are pure YAML definitions (like agents), not vendored content packages (like skills). The simpler `McpServerEntry` struct reflects this.

