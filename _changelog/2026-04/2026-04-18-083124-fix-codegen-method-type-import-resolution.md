# Fix codegen method type import resolution

**Date**: April 18, 2026

## Summary

Fixed a bug in the TypeScript and Python SDK code generators where method types defined in non-standard proto files (e.g., `token.proto`) were incorrectly imported from `io_pb`/`io_pb2`. The generators now resolve imports from `schema.MethodTypes[].protoFile`, which the proto-to-schema pipeline already provided but the generators ignored.

## Problem Statement

The SDK client generators (`sdk_client_ts.go` and `sdk_client_python.go`) assumed that all same-package method input/output types live in `io.proto`. This assumption held for every existing service — until PlatformClient introduced `token.proto` with `MintUserTokenRequest` and `MintUserTokenResponse`.

### Pain Points

- Generated TypeScript client imported `MintUserTokenRequestSchema` and `MintUserTokenResponseSchema` from `io_pb` — a module where those symbols don't exist
- Generated Python client annotated `mint_user_token` with `io_pb2.MintUserTokenRequest` — wrong module at runtime
- Hand-written `platform-client-auth.ts` copied the wrong import from generated code
- The Python generator also incorrectly routed spec-defined types (`IamPolicySpec`, `ApiResourceRef`, `EnvironmentValue`) to `io_pb2` instead of `spec_pb2`

## Solution

Used the `protoFile` metadata that `proto2schema` already extracts for each method type to resolve imports to the correct `_pb`/`_pb2` module, instead of blindly defaulting to `io_pb`.

## Implementation Details

### TypeScript generator (`sdk_client_ts.go`)

- Built `methodTypeFileMap` from `schema.MethodTypes` (same pattern as existing `specTypeFileMap`)
- Added a lookup in `tsImportMethodType` before the `io_pb` fallback
- Threaded the map through the function signature (one new parameter)
- **+23 lines changed**

### Python generator (`sdk_client_python.go`)

- Added `pyProtoFileToModule` (converts `token.proto` → `token_pb2`) and `pyMethodTypePb2Prefix` helper
- Built `methodTypePb2Map` restricted to same-package types (cross-package types use separate import handling)
- Added `extraPb2Modules` set to `pyImports` with deduplication against `needsIoPb2`/`needsSpec`
- Replaced hardcoded `io_pb2.` prefix with map-driven resolution in `generatePythonMethod` and `generatePythonStreamingMethod`
- Added `pyTrackMethodTypeImport` to centralize import tracking
- **+106/-20 lines changed**

### Hand-written fix

- `sdk/typescript/src/platform-client-auth.ts` line 5: `io_pb` → `token_pb`

### Regenerated output

| File | Change |
|------|--------|
| `sdk/typescript/src/gen/platformclient.ts` | `MintUserToken*` moved from `io_pb` to `token_pb` |
| `sdk/python/src/stigmer/_gen/_platformclient.py` | New `token_pb2` import; annotations use `token_pb2.MintUserToken*` |
| `sdk/python/src/stigmer/_gen/_iampolicy.py` | `IamPolicySpec`/`ApiResourceRef` corrected from `io_pb2` to `spec_pb2` |
| `sdk/python/src/stigmer/_gen/_environment.py` | `EnvironmentValue` return annotation corrected from `io_pb2` to `spec_pb2` |

## Benefits

- **Correctness**: Method types now import from the proto file where they're actually defined
- **Robustness**: Any future service with types in non-standard files (e.g., a future `mintClientToken` in token.proto) will automatically resolve correctly
- **Bonus fixes**: Two pre-existing Python annotation bugs (iampolicy, environment) corrected by the same mechanism

## Impact

- **SDK consumers**: No API change — the generated client surface is identical. Only the internal import paths changed.
- **Generator maintainers**: New pattern to follow — method types with `protoFile` in the schema are now respected, not just spec types.
- **Go and Java SDKs**: Not affected — Go uses gRPC stubs directly, Java uses package-level imports.

## Related Work

- Part of the PlatformClient project (`20260417.01.platform-client`), session 10
- PlatformClient introduced the first service with a third proto file (`token.proto`) beyond the standard `command.proto`/`query.proto`/`io.proto`/`spec.proto` pattern

---

**Status**: Production Ready
**Timeline**: Single session
