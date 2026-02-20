# Workflow Codegen, Enum/Struct Support, and toProto Error Propagation

**Date**: February 20, 2026

## Summary

Extended the MCP input type codegen pipeline to generate workflow input types, added proper enum and `google.protobuf.Struct` field support, and made all generated `toProto()` methods return errors. This completes the migration of all three domains (agent, mcpserver, workflow) to generated, type-safe input types with consistent error propagation.

## Problem Statement

The workflow domain was the last holdout using the old raw-JSON pattern (`ApplyWorkflowInput{Resource string}`) while agents and mcpservers had been migrated to generated input types in T07. Additionally, two foundational gaps in the codegen pipeline prevented clean workflow generation:

### Pain Points

- `WorkflowTask.kind` is a proto enum (`WorkflowTaskKind`), but `proto2schema` discarded enum type information, mapping all enums to plain `"string"` — the generator had no way to emit type-safe enum conversion
- `WorkflowTask.task_config` is `google.protobuf.Struct`, which requires `structpb.NewStruct()` for conversion — a fallible operation that the existing `toProto()` signature (no error return) couldn't accommodate
- All generated `toProto()` methods silently swallowed potential errors, creating a pattern that would accumulate technical debt as more complex types are added
- Dead code (`ApplyFunc`, `CallApply`, `UnmarshalJSON`, `ResourceIdentity`) remained from the pre-codegen era

## Solution

A three-pronged approach: extend the schema extraction pipeline for enum metadata, add struct and enum field support to the code generator, and change all generated `toProto()` methods to return `(proto, error)`.

## Implementation Details

### proto2schema: Enum Type Extraction

Added `EnumType` field to `TypeSpec` struct. Updated `extractScalarTypeSpec` to capture the fully-qualified proto enum name (e.g., `ai.stigmer.agentic.workflow.v1.WorkflowTaskKind`) when processing `TYPE_ENUM` fields. Mirrored the field in the generator's `TypeSpec`.

### Generator: Struct and Enum Field Support

Extended `mcpInputField` with `isStruct` and `enumType` fields. Added a `struct` case in `resolveField` mapping to `map[string]any`. In `genFieldAssignment`:
- **Struct fields** emit `structpb.NewStruct()` with proper error wrapping
- **Enum fields** emit `EnumType(EnumType_value[input.Field])` using the fully-qualified enum type to derive Go import paths and type names

### Generator: Error-Returning toProto()

Changed signatures across all generation methods:
- `genTopLevelToProto`: `ToProto() (*T, error)` and `specToProto() (*TSpec, error)`
- `genNestedToProto`: `toProto() (*T, error)`
- `genRefToProto`: `toProto() (*ApiResourceReference, error)` (consistency, even though refs can't fail today)

Updated `genFieldAssignment` for all codepaths (pointer, slice, map, oneof, value-struct) to propagate errors from nested `toProto()` calls.

### Workflow Generation

Generated `mcp-server/gen/workflow/workflow_gen.go` containing:
- `WorkflowInput` (top-level with identity fields)
- `WorkflowTaskInput` (enum Kind + structpb TaskConfig)
- `WorkflowDocumentInput`, `ExportInput`, `FlowControlInput`
- `EnvironmentInput`, `EnvironmentValue` (shared types)

### Handler Migration

Rewrote `workflows/tools.go` to use `geninput.WorkflowInput` + `ToProto()` pattern. Changed `workflows/apply.go` from `Apply(ctx, addr, jsonStr)` to `Apply(ctx, addr, *workflowv1.Workflow)`. Updated agents and mcpservers handlers to handle the new error return.

### Makefile Target

Added `codegen-mcp` target to `mcp-server/Makefile` that regenerates all three domains in one command.

### Dead Code Cleanup

Removed: `ApplyFunc` type, `CallApply` function, `UnmarshalJSON`, `UnmarshalOptions`, `ResourceIdentity` struct (`input.go` deleted entirely), and all associated tests.

### Struct Tag Sanitization

Fixed a gofmt failure caused by backticks and double quotes in proto description text breaking Go struct tags. `buildJsonSchemaTag` now replaces backticks with `'` and double quotes with `'` in description values.

## Benefits

- **Type safety**: Workflow input is now a fully typed Go struct with jsonschema tags — LLMs get structured schema instead of opaque JSON string
- **Error visibility**: Conversion failures (e.g., invalid structpb data) are surfaced to callers instead of silently producing malformed protos
- **Consistency**: All three domains follow the identical generated-input-type pattern
- **Automation**: `make codegen-mcp` regenerates everything in one shot
- **Less code to maintain**: Removed ~80 lines of hand-written dead code

## Impact

- **MCP server**: All apply handlers now use generated input types with error handling
- **Codegen pipeline**: Supports enum, struct, message, map, array, oneof, and reference fields — covers all proto types used in the platform
- **Test suite**: All 12+ packages pass with race detection
- **Developer workflow**: Single Makefile target for regeneration

## Related Work

- T07: Initial MCP input type codegen (agent + mcpserver) — `_changelog/2026-02/2026-02-20-181518-mcp-server-input-type-codegen.md`
- T06: Agent apply rich schema — `_changelog/2026-02/2026-02-20-162724-mcp-server-agent-apply-rich-schema.md`

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
