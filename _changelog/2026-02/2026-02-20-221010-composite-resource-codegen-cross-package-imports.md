# Composite Resource Codegen: Cross-Package Import Strategy

**Date**: February 20, 2026

## Summary

Enabled MCP server code generation for composite resources — API resources that embed other full resource wrappers. The `Project` resource, previously skipped due to a naming collision, now generates correctly via a cross-package import strategy that reuses already-generated input types from sibling packages.

## Problem Statement

The MCP server codegen pipeline generates `*Input` structs and `ToProto()` conversion methods from protobuf JSON schemas. When processing the `Project` resource, the generator encountered a fundamental naming collision: `ProjectSpec` contains fields like `repeated Agent agents`, where `Agent` is itself a full resource wrapper (with `api_version`, `kind`, `metadata`, `spec`). The generator would attempt to create both an `AgentInput` type (for the `Agent` wrapper) and an `AgentInput` type (for the `AgentSpec` inside it), causing a conflict.

### Pain Points

- `Project` was the only resource excluded from codegen (hardcoded in `skipResources`)
- Any future composite/aggregate-root resource would hit the same limitation
- The gap required hand-writing MCP input types for composite resources

## Solution

Implemented structural detection of resource wrapper types and cross-package imports. When the generator encounters a field whose type is a resource wrapper (has the canonical `api_version` + `kind` + `metadata` + `spec` pattern), it imports the already-generated `*Input` type from the sibling package instead of recursing into the wrapper's internals.

## Implementation Details

### Resource Wrapper Detection

Added `isResourceWrapper()` to `mcpGen` which inspects a message's fields for the canonical API resource envelope pattern: `api_version` (string), `kind` (string), `metadata` (with `ApiResourceMetadata` type), and `spec` (message). This structural approach avoids maintaining a hardcoded list of wrapper types.

### Import Path Derivation

Added `resourceWrapperGenImport()` which parses the protobuf fully-qualified type name (e.g., `ai.stigmer.agentic.agent.v1.Agent`) to derive:
- **Go import path**: `github.com/stigmer/stigmer/mcp-server/gen/agentic/agent`
- **Package name**: `agent`
- **Input type**: `AgentInput`

### Field Resolution

Extended `resolveField()` with two new cases (processed before general message handling):
1. **Array of resource wrappers** (`repeated Agent agents`) → `[]agent.AgentInput`
2. **Singular resource wrapper** (`Agent agent`) → `*agent.AgentInput`

Both set the `useExportedToProto` flag to ensure the exported `ToProto()` method is called during conversion.

### Code Emission

Updated `genFieldAssignment()` to conditionally call `ToProto()` (exported, cross-package) vs `toProto()` (unexported, same-package) based on the `useExportedToProto` flag.

## Benefits

- **Complete coverage**: All 16 API resources now generate MCP input types (was 15)
- **Zero naming collisions**: Cross-package imports eliminate the wrapper-vs-spec ambiguity
- **Single source of truth**: Each resource's input type exists in exactly one package
- **Future-proof**: Any new composite resource is handled automatically by structural detection
- **No hand-written code**: The `Project` MCP input type is fully generated

## Impact

- **Codegen pipeline**: `skipResources` map is now empty — no resources are excluded
- **Generated output**: New `mcp-server/gen/agentic/project/project_gen.go` with `ProjectInput` struct that uses `[]agent.AgentInput`, `[]workflow.WorkflowInput`, `[]mcpserver.McpServerInput`, and `[]skill.SkillInput`
- **Validation**: `go build ./...`, `go test -race ./...`, and `make vet` all pass

## Related Work

- [Generalize MCP codegen to all domains](2026-02-20-215458-generalize-mcp-codegen-all-domains.md) — T10 that generated 15 resources and identified the Project gap
- [Typed workflow task configs](2026-02-20-210846-typed-workflow-task-configs-mcp-codegen.md) — T09 discriminated union handling
- [MCP input type codegen](2026-02-20-181518-mcp-server-input-type-codegen.md) — T07 original codegen foundation

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours including design and implementation)
