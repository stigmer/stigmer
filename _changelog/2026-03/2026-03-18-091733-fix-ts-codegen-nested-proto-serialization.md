# Fix TypeScript SDK Codegen: Nested Proto Message Serialization

**Date**: March 18, 2026

## Summary

Fixed the TypeScript SDK code generator to properly construct protobuf-es message instances for nested types, repeated message fields, oneofs, and maps with message values. The previous codegen emitted flat scalar-style assignments that broke at runtime whenever a nested message field was populated, causing `serialize binary: cannot use field ... with message undefined` errors. This was a systematic bug affecting 14 of 17 generated resource files.

## Problem Statement

The `generateTSBuildProto` function in `sdk_client_ts.go` treated every spec field identically, emitting `fieldName: input.fieldName` regardless of whether the field was a scalar, a nested message, a repeated message, a map with message values, or a oneof. While this worked for scalars, protobuf-es v2 requires nested fields to be proper message instances created via `create(Schema)`, not plain JS objects.

### Pain Points

- Session creation with workspace entries (a repeated message with nested oneofs) failed with a serialization error
- The error was generic ("Failed to start session") -- the actual protobuf error was swallowed
- The Go, Python, and Java SDK generators all handled nested messages correctly; only the TypeScript generator was broken
- 14 of 17 generated resource files would break at runtime if any nested message field was populated

## Solution

Ported the Go SDK's proven `emitToProtoField` / `emitNestedToProto` / `emitOneofToProto` pattern to the TypeScript generator, adapted for protobuf-es semantics (`create(Schema)` + `Object.assign` + oneof `{ case, value }` syntax).

## Implementation Details

All codegen logic changes in a single file: `tools/codegen/generator/sdk_client_ts.go`.

### New functions added

- **`isSyntheticOneof`** -- Detects proto3 optional synthetic oneofs (prefixed with `_`) which protobuf-es v2 exposes as regular fields, not oneofs
- **`tsFieldNeedsConversion`** -- Returns true if a field contains nested message types requiring proto builder conversion
- **`tsTypeHasOneof` / `tsTypeHasNestedMessages`** -- Determine if a type needs imperative construction vs. simple `Object.assign`
- **`tsAddSchemaImport`** -- Adds the `XxxSchema` import for nested types, deriving the correct `_pb` file from `ProtoFile`
- **`emitTSPreComputeField`** -- Emits pre-computed variable declarations for message fields in the main builder (single messages, message arrays, EnvironmentSpec, ApiResourceReference, env/execution value maps, generic message maps)
- **`emitTSNestedBuilders`** -- Recursively generates standalone `buildXxxProto` helper functions for each non-special nested message type (simple types use `Object.assign + stripUndefined`; complex types with oneofs or nested messages use imperative construction)
- **`emitTSNestedFieldAssign`** -- Emits individual field assignments inside nested builders, handling all field kinds

### Refactored

- **`generateTSBuildProto`** -- Now detects spec-level oneofs (e.g., `McpServerSpec.serverType`) and handles them with imperative `{ case, value }` assignment. Regular fields still use the `Object.assign + stripUndefined` pattern.

### Field types handled

| Field Type | Conversion Strategy |
|---|---|
| Scalar / string / bool / enum | Direct passthrough (unchanged) |
| Single message (non-special) | `buildXxxProto(input.field)` |
| Repeated message | `input.field?.map(buildXxxProto)` |
| ApiResourceReference | `create(ApiResourceReferenceSchema, input.field)` |
| EnvironmentSpec | Create spec + loop over variables map |
| EnvironmentValue / ExecutionValue map | `Object.fromEntries` with `create(Schema, ...)` |
| Map with message values | `Object.fromEntries` with builder |
| Oneof (nested) | `msg.group = { case: "field", value: builderOrCreate }` |
| Oneof (spec-level) | Build spec separately, assign oneofs imperatively |
| Proto3 optional (synthetic oneof) | Treated as regular scalar field |

### Error reporting fix

Also improved `SessionLauncher.tsx` to surface the actual error message instead of the generic "Failed to start session" string that was hiding the root cause.

## Benefits

- All 17 TypeScript SDK resource files now correctly serialize nested protobuf messages
- Session creation with workspace entries (the original bug trigger) works correctly
- MCP server creation with stdio/http oneof works correctly
- Agent creation with nested McpServerUsage, SubAgent, ToolApprovalOverride works correctly
- Environment and ExecutionContext map-of-message fields work correctly
- TypeScript type checker passes cleanly on all generated files
- No behavioral change for the 3 scalar-only resources (apikey, identityprovider, skill)

## Impact

- **SDK consumers**: All TypeScript SDK operations involving nested message fields now work at runtime
- **Web console**: Session creation, agent creation, MCP server configuration, workflow management all fixed
- **Platform builders**: Embedding `@stigmer/sdk` and `@stigmer/react` for resources with nested specs no longer triggers serialization errors
- **Code generators**: Only the TypeScript generator was affected; Go, Python, and Java generators were already correct

## Related Work

- Go SDK's `emitToProtoField` / `emitNestedToProto` / `emitOneofToProto` (sdk_client.go) served as the reference implementation
- Python SDK's `_to_proto()` methods and Java SDK's builder pattern were audited and confirmed correct

---

**Status**: ✅ Production Ready
**Timeline**: Single session
