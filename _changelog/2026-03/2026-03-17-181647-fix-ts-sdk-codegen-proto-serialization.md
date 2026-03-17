# Fix TypeScript SDK Codegen Proto Serialization Bug

**Date**: March 17, 2026

## Summary

Fixed a protobuf binary serialization crash in all 17 generated TypeScript SDK resource clients. The `buildXxxProto` functions used `Object.assign` to copy input fields onto proto message instances, but `undefined` values from omitted optional fields overwrote protobuf-es default values (empty maps, empty arrays), causing the serializer to throw `Cannot convert undefined or null to object`.

## Problem Statement

When SDK callers omitted optional fields (e.g., creating a session without `metadata` or `workspaceEntries`), the generated `buildSessionProto` function passed `undefined` values through `Object.assign`. This overwrote the proto message's default empty `{}` (for `map<string, string>`) and `[]` (for `repeated WorkspaceEntry`) with `undefined`, crashing the protobuf-es binary serializer before the request ever reached the network.

### Pain Points

- Session creation from the web console failed with "Failed to start session" for any resource with optional map or repeated fields
- The error was a client-side serialization failure — no network request was ever made
- All 17 generated TypeScript SDK clients were affected, not just sessions
- The bug was invisible in the other three SDKs (Go, Python, Java) which use different proto construction patterns that are naturally null-safe

## Solution

Added a `stripUndefined` utility function to the TypeScript SDK codegen. The utility removes `undefined`-valued keys from an object before `Object.assign` can overwrite proto defaults. The codegen wraps the spec fields object in every `buildXxxProto` function with this utility.

## Implementation Details

**Single source file modified**: `tools/codegen/generator/sdk_client_ts.go`

Three changes to the codegen:

1. **New `generateTSProtoUtils` function** — emits `sdk/typescript/src/gen/proto-utils.ts` containing the `stripUndefined<T>` generic utility. Called from the same entry point that generates `errors.ts` and `types.ts`.

2. **Import injection** — when a resource client has an input type, `stripUndefined` is imported from `./proto-utils` alongside the existing `wrapError` from `./errors`.

3. **Spec field wrapping** — in `generateTSBuildProto`, changed:
   ```
   spec: Object.assign(create(SpecSchema), { ...fields })
   ```
   to:
   ```
   spec: Object.assign(create(SpecSchema), stripUndefined({ ...fields }))
   ```

The `metadata` assignment (which only contains required `name` and `org` fields) is intentionally NOT wrapped — those fields are always defined.

**Generated output**: All 17 resource client files regenerated via `make -C sdk/typescript codegen`. Each now imports `stripUndefined` and wraps spec fields in the `buildXxxProto` function.

## Cross-SDK Analysis

Investigated all four SDK codegens to confirm this is a TypeScript-only issue:

| SDK | Proto Construction Pattern | Null-Safe? |
|-----|---------------------------|------------|
| **Go** (`sdk_client.go`) | Empty spec + field-by-field assignment | Yes — Go zero values (`nil`, `""`, `0`) are valid protobuf values |
| **Python** (`sdk_client_python.go`) | Constructor kwargs + `if is not None:` guards | Yes — explicit null checks for all complex types |
| **Java** (`sdk_client_java.go`) | Builder pattern + `if != null` guards | Yes — setter calls behind null checks |
| **TypeScript** (`sdk_client_ts.go`) | `Object.assign(create(Schema), {...})` | **No** — `undefined` overwrites proto defaults |

## Benefits

- Session creation (and all other resource creation) works when optional fields are omitted
- Fix is systematic — applied uniformly across all 17 resource clients via codegen
- Zero risk of regression on future resources — the pattern is baked into the generator
- No changes to proto definitions, Go server code, or SDK input type interfaces

## Impact

- **All TypeScript SDK consumers** — any caller passing only required fields to any resource with optional map or repeated fields was affected
- **Web console** — session creation was completely broken without workspace entries
- **Generated code only** — no hand-written SDK code changes required

## Related Work

- Part of the `20260317.01.session-first-web-ux` project
- Discovered during T01.5 (New Session Launcher) browser verification
- The `Object.assign(create(Schema), {...})` pattern itself is a deliberate design choice documented in the codegen and remains unchanged — it works correctly once `undefined` values are stripped

---

**Status**: Production Ready
**Timeline**: Single session fix
