# Fix Protobuf Timestamp Serialization in SDK Codegen

**Date**: May 19, 2026

## Summary

Fixed a systemic bug in the TypeScript SDK code generator that caused protobuf binary serialization to fail when creating invitation links (and any resource with a timestamp field in its spec). The codegen now properly converts JavaScript `Date` objects to protobuf `Timestamp` messages via a generated `toTimestamp()` utility. Comprehensive tests added at unit, component, and integration levels.

## Problem Statement

Users attempting to create invite links in the web console encountered a cryptic error: `serialize binary: cannot use field google.protobuf.Timestamp.seconds with message undefined`. The invitation form appeared to work (all fields filled correctly), but the RPC call failed at the serialization boundary.

### Pain Points

- Invite link creation was completely broken in the UI
- The error message gave no indication of which field was problematic
- The bug was systemic in the codegen, meaning any future resource with a timestamp spec field would inherit the same defect
- No tests existed at any level to catch timestamp serialization issues

## Solution

Fixed the code generator (`tools/codegen/generator/sdk_client_ts.go`) to recognize `timestamp` as a field type requiring conversion, then regenerated all affected SDK clients. Added a `toTimestamp(value: Date | string): Timestamp` utility to the generated `proto-utils.ts` that wraps `@bufbuild/protobuf/wkt`'s `timestampFromDate`.

## Implementation Details

### Codegen Changes (`sdk_client_ts.go`)

Three modifications to the Go code generator:

1. **`tsFieldNeedsConversion`** — Added `timestamp` as a case returning `true`, so timestamp fields are routed through the pre-computation path instead of being treated as plain scalars.

2. **`emitTSPreComputeField`** — Added a `timestamp` case that emits: `const expiresAt = input.expiresAt !== undefined ? toTimestamp(input.expiresAt) : undefined;`

3. **`emitTSNestedFieldAssign`** — Extracted `timestamp` from the scalar union and gave it a dedicated case emitting: `if (input.X !== undefined) msg.X = toTimestamp(input.X);`

4. **`generateTSProtoUtils`** — Added the `toTimestamp` function with the `timestampFromDate` import from `@bufbuild/protobuf/wkt`.

### Generated Output Changes

- `invitation.ts` — `expiresAt` now pre-computed via `toTimestamp()` before assignment to spec
- `apikey.ts` — Same fix for optional `expiresAt` field
- `platformclient.ts` — Same fix for optional `expiresAt` field
- `proto-utils.ts` — New `toTimestamp` export alongside existing `stripUndefined`

### Test Coverage Added

| Level | File | Tests |
|-------|------|-------|
| Unit (SDK) | `sdk/typescript/src/__tests__/gen/proto-utils.test.ts` | 6 tests for `toTimestamp` (Date, string, epoch, far-future, millisecond precision, roundtrip) |
| Unit (SDK) | `sdk/typescript/src/__tests__/gen/invitation-client.test.ts` | 5 tests (Date input, string input, binary serialization roundtrip, 7-day expiry, 30-day expiry) |
| Component (React) | `sdk/react/src/invitation/__tests__/useCreateInvitation.test.tsx` | 5 tests (delegation, isCreating state, error handling, clearError, Date wiring) |
| Integration (Go) | `test/integration/auth_invitation_test.go` | 8 tests (7/14/30-day expiry, past-expiry validation, max-expiry validation, listByOrg, revoke, revoke idempotency, getByToken preview) |

## Benefits

- Invitation link creation works correctly in the web console
- API key creation with expiry dates works correctly
- The codegen is now future-proof: any new resource with a timestamp spec field will automatically get proper conversion
- 24 new tests prevent regression at multiple pyramid levels
- Binary serialization roundtrip tests catch this class of bug immediately

## Impact

- **Users**: Invite link creation is unblocked; admins can onboard team members again
- **SDK consumers**: Platform builders using `@stigmer/sdk` with custom timestamp fields will no longer hit serialization errors
- **Maintainers**: The codegen fix is systemic; no per-resource manual intervention needed for future timestamp fields

## Related Work

- Codegen lives in `tools/codegen/generator/` — shared by Go, Python, Java, and TypeScript SDK generation
- The Go and Java SDKs were not affected (they use language-native timestamp handling in their respective codegen paths)
- The existing `TestInvitation_CRUD_Lifecycle` in `auth_iam_resources_test.go` covered backend correctness but not the SDK serialization path

---

**Status**: Production Ready
**Timeline**: Single session fix
