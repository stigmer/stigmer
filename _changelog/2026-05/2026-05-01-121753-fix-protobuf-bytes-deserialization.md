# Fix Protobuf Bytes Field Deserialization in Polyglot Temporal Pipeline

**Date**: May 1, 2026

## Summary

Fixed a critical polyglot serialization mismatch between the TypeScript Cursor runner and the Java `stigmer-service` Temporal workflow. The TypeScript activity was returning a raw `@bufbuild/protobuf` message instance, which Temporal's default `JSON.stringify`-based payload converter serialized incorrectly — `Uint8Array` bytes fields became `{}` instead of base64 strings. This caused `InvalidProtocolBufferException` on the Java side and trapped the workflow in a permanent retry loop.

## Problem Statement

Agent executions triggered through the Cursor runner were failing with a deserialization error on the Java workflow side, producing repeated stack traces:

```
InvalidProtocolBufferException: Invalid value: {} for expected type: BYTES
  -> JsonMappingException: Failed to deserialize protobuf AgentExecutionStatus
    -> DataConverterException (Temporal payload conversion failure)
```

### Pain Points

- Workflows that hit this bug became **permanently stuck** — the corrupted activity result in Temporal's event history caused every replay attempt to fail with the same error
- The retry loop (Attempts 2, 3, 4, 5, 6...) consumed resources without recovery
- The root cause was non-obvious: `JSON.stringify(new Uint8Array(0))` produces `{}` because `Uint8Array` has no enumerable properties, while the Java `JsonFormat.Parser` expects base64-encoded strings for `bytes` fields

## Solution

Modified `slimStatus()` in the Cursor runner's `ExecuteCursor` activity to convert the protobuf message to a plain JSON object using `toJson()` from `@bufbuild/protobuf` before returning it as the Temporal activity result. This produces canonical protobuf JSON that the Java `JsonFormat.Parser` can deserialize correctly.

## Implementation Details

**File changed**: `backend/services/cursor-runner/src/activity/execute-cursor.ts`

Key changes:
- Added `toJson` import from `@bufbuild/protobuf`
- Changed `slimStatus()` to call `toJson(AgentExecutionStatusSchema, slim)` instead of returning the raw proto message
- Updated return types from `Promise<AgentExecutionStatus>` to `Promise<unknown>` on `ExecuteCursor` and `executeCursor` to reflect the plain JSON output

**Why `toJson()` is the correct fix**: It produces canonical protobuf JSON where:
- `bytes` fields are base64-encoded strings (or omitted when empty)
- Enums are string names (e.g., `"EXECUTION_FAILED"`)
- Default-valued fields are omitted

This matches exactly what the Java `ProtobufJacksonModule.MessageDeserializer` expects via `JsonFormat.Parser.merge()`.

**Contrast with Python runner**: The Python agent runner already uses `JSONProtoPayloadConverter` in its custom `ForwardCompatiblePayloadConverter`, which handles proto JSON serialization correctly. The TypeScript runner had no equivalent custom converter — this fix achieves the same result at the activity level.

## Benefits

- Eliminates the `InvalidProtocolBufferException` deserialization crash
- Prevents workflows from becoming permanently stuck due to corrupted event history
- Establishes correct polyglot serialization between TypeScript activities and Java workflows
- Aligns the TypeScript runner's output format with the Python runner's established pattern

## Impact

- **Agent Execution Pipeline**: All Cursor-based agent executions now serialize their activity results correctly for the Java workflow consumer
- **Operational**: Stuck workflows from the bug era must be manually terminated via Temporal CLI (the corrupted payloads are baked into their event histories)
- **Forward Compatibility**: The `toJson()` approach is resilient to future proto schema additions — new `bytes`, `Timestamp`, or enum fields will serialize correctly without code changes

## Related Work

- `ProtobufJacksonModule` (stigmer-cloud) — Java-side deserializer that consumes the corrected output
- `ForwardCompatiblePayloadConverter` (agent-runner) — Python equivalent that already handled this correctly
- Previous fix: `fix-cursor-runner-enum-crash` — related enum serialization issue in the same pipeline

---

**Status**: ✅ Production Ready
