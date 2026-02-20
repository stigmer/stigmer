# MCP Server Input Type Code Generation

**Date**: February 20, 2026

## Summary

Built an end-to-end code generation pipeline that replaces hand-written MCP server input types with generated Go structs. The generator produces flat, LLM-friendly structs with `jsonschema` tags and type-safe `ToProto()` conversion methods, eliminating hundreds of lines of boilerplate per domain while ensuring consistency across all apply tools.

## Problem Statement

After the initial hand-written `ApplyAgentInput` (T06), it became clear that every domain's apply tool would need the same mechanical boilerplate: flat input struct, `jsonschema` tags mirroring proto descriptions, `toProto()` conversion with auto-populated metadata (api_version, kind, slug generation, visibility mapping, reference kind injection). Writing this by hand for each domain is error-prone and hard to keep in sync with proto changes.

### Pain Points

- ~260 lines of hand-written input + conversion code per domain
- Proto field descriptions had to be manually duplicated into `jsonschema` tags
- `ApiResourceReference` flattening (hiding `kind` enum values) was tedious and repetitive
- Oneof fields (e.g., `McpServerSpec.server_type`) required knowledge of Go protobuf wrapper types
- No mechanism to detect when proto changes made input types stale

## Solution

Extended the existing two-stage codegen pipeline (`proto2schema` → `generator`) with a new `--target=mcp` mode that generates MCP-specific input types from JSON schemas.

### Architecture

```
*.proto → [proto2schema] → *.json (with referenceKind + oneofGroup) → [generator --target=mcp] → *_gen.go
```

## Implementation Details

### Stage 1: Proto2Schema Enhancements

- Added `referenceKind` field to JSON schemas — extracted from a new `reference_kind` proto field option (typed as `ApiResourceKind` enum) on `field_options.proto`
- Added `oneofGroup` field to JSON schemas — identifies which oneof group a field belongs to
- Used `protowire` package to read custom options from unknown bytes, avoiding dependency on up-to-date generated Go stubs

### Stage 2: Generator MCP Mode (`tools/codegen/generator/mcp.go`)

- **Type collection**: Recursively walks the schema tree, creating `mcpInputType` descriptors for the top-level struct and all nested message/reference types
- **Reference flattening**: `ApiResourceReference` fields become flat structs with `Org`, `Slug`, and conditionally `Version` (based on `versionedKinds` map). `Kind` is auto-populated in `toProto()`
- **Oneof handling**: Detects `oneofGroup` metadata and generates correct Go wrapper types (`McpServerSpec_Stdio`, `McpServerSpec_Http`)
- **Identity fields**: Emitted inline (Name, Slug, Org, Visibility, Labels, Tags) with identity-field dedup to prevent collisions with spec-level fields of the same name
- **Tag generation**: Full proto descriptions flow into `jsonschema` tags with proper comma escaping (`\\,`)
- **Import management**: Tracks and deduplicates Go imports, resolving proto FQNs to Go import paths

### Generated Output

- `mcp-server/gen/agent/agent_gen.go`: `AgentInput` + 8 nested types + `ToProto()` + 7 conversion methods
- `mcp-server/gen/mcpserver/mcp_server_gen.go`: `McpServerInput` + 5 nested types + `ToProto()` with oneof handling
- `mcp-server/internal/convert/convert.go`: Shared hand-written utilities (`GenerateSlug`, `VisibilityFromString`)

### Naming Conventions (Refined via feedback)

- Singular package names: `gen/agent/`, `gen/mcpserver/`
- Simple struct names: `AgentInput`, `McpServerInput` (not `ApplyAgentInput`)
- Simple file names: `agent_gen.go`, `mcp_server_gen.go`
- Zero dependency on `internal/domains` from generated code
- Hand-written utilities in `internal/convert/`, not `gen/`

## Benefits

- **Zero boilerplate per new domain**: Run the generator, get a complete input type with ToProto()
- **Proto is the source of truth**: Field descriptions, types, validation rules, and reference kinds all flow from proto definitions
- **Consistency guaranteed**: Every domain's input types follow identical patterns — same identity fields, same tag format, same conversion logic
- **Type-safe references**: `reference_kind` enum on proto fields (not strings) catches invalid resource kind annotations at proto compilation time
- **Oneof correctness**: Generator handles Go protobuf wrapper types automatically, preventing the subtle `spec.Stdio undefined` errors that arise from direct assignment

## Impact

- **agents domain**: Deleted 260 lines of hand-written code (input.go + convert.go), replaced by ~258 lines of generated code
- **mcpservers domain**: Gained structured input types (was using raw JSON string), handlers now use typed `McpServerInput` with `ToProto()`
- **All 28 agent tests** and **all mcpserver tests** pass against generated code
- **Full mcp-server module** (12 packages) builds and tests clean

## Related Work

- `2026-02-20-162724-mcp-server-agent-apply-rich-schema.md` — T06: Hand-written agent apply input (now replaced by generated code)
- `2026-02-20-145752-mcp-server-shared-abstractions.md` — T02: Shared domain infrastructure
- `2026-02-20-153626-mcp-server-remaining-domains-refactor.md` — T04: Domain refactoring

---

**Status**: ✅ Production Ready (agents + mcpservers generated; workflows pending)
**Timeline**: Single session (~3 hours)
