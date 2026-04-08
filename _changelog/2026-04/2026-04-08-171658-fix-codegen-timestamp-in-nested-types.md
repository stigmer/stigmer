# Fix Codegen Timestamp Handling in Nested Types

**Date**: April 8, 2026

## Summary

Fixed a code generation bug where `timestamp` fields in nested proto message types produced invalid Go code — assigning a `string` to a `*timestamppb.Timestamp` field. The codegen now correctly emits RFC3339 parse-and-convert logic for timestamp fields in nested type `toProto()` methods, matching the behavior already present for top-level spec fields.

## Problem Statement

The `stigmer-codegen` tool generates Go SDK client code from JSON schemas derived from proto definitions. When `McpServerSource` was added to `McpServerSpec` (with a `google.protobuf.Timestamp last_synced_at` field), the generated `McpServerSourceInput.toProto()` method contained a type mismatch:

```go
LastSyncedAt: i.LastSyncedAt,  // string assigned to *timestamppb.Timestamp
```

### Pain Points

- `sdk/go` failed to compile — blocking all downstream consumers
- `make check` failed on the Stigmer OSS repo
- The `time` and `timestamppb` imports were emitted correctly but never referenced, causing additional unused-import errors

## Solution

The root cause was in `emitNestedToProto` within `tools/codegen/generator/sdk_client.go`. The top-level `emitToProtoField` function already handled `timestamp` fields correctly by emitting `time.Parse(time.RFC3339, ...)` + `timestamppb.New(t)` conversion logic. However, the nested type emitter had no `timestamp` case — these fields fell through to generic direct assignment.

The fix:

1. Renamed the `hasStructField` gate to `needsImperative` and expanded it to also trigger on `timestamp` fields (since timestamp conversion requires conditional logic that cannot be inlined into a struct literal).
2. Added an explicit `timestamp` branch in the imperative code path that emits the same parse-and-convert pattern used by the top-level emitter.

## Implementation Details

**File changed**: `tools/codegen/generator/sdk_client.go`

The `emitNestedToProto` function has two code paths for generating `toProto()` methods on nested input types:

- **Imperative path** (variable `p` with sequential assignments) — used when any field requires conditional logic (`struct` or now `timestamp`).
- **Struct-literal path** (single `return &Proto{...}` statement) — used when all fields can be directly assigned.

The timestamp field requires the imperative path because the conversion involves an `if` guard (skip empty strings) and error handling (`time.Parse` may fail). The fix ensures `timestamp` fields trigger the imperative path and emit:

```go
if i.LastSyncedAt != "" {
    if t, err := time.Parse(time.RFC3339, i.LastSyncedAt); err == nil {
        p.LastSyncedAt = timestamppb.New(t)
    }
}
```

**File regenerated**: `sdk/go/internal/gen/mcpserver.go` — now compiles cleanly with correct `McpServerSourceInput.toProto()`.

## Benefits

- Restores `make check` to green on the Stigmer OSS repo
- Any future nested type with a `timestamp` field will be handled correctly by the codegen — no manual fix needed
- The fix is minimal and surgical: 9 lines changed in the generator, producing correct output for all current and future schemas

## Impact

- **SDK consumers**: The Go SDK (`sdk/go`) compiles again. Anyone importing `stigmer.McpServerSourceInput` gets correct `toProto()` behavior.
- **Codegen reliability**: This was the first nested type with a `timestamp` field; the fix ensures the pattern is covered going forward.
- **MCP Registry sync pipeline**: The `McpServerSource.last_synced_at` field (added in the previous session for registry sync provenance) now round-trips correctly through the SDK.

## Related Work

- [Automated MCP Registry Sync Pipeline](2026-04-08-165622-automated-mcp-registry-sync-pipeline.md) — introduced `McpServerSource` with the `last_synced_at` timestamp that exposed this bug

---

**Status**: Production Ready
