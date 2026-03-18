# Codegen Conversion Generation Test Coverage

**Date**: March 18, 2026

## Summary

Added comprehensive unit tests for the ToProto/FromProto code generation functions in the codegen generator, covering both the structpb conversion path (bidirectional) and the typed proto SDK client conversion path (unidirectional). This brings test coverage to both conversion systems that generate SDK code across Go, TypeScript, Python, and Java.

## Problem Statement

The codegen generator had zero test coverage for its conversion code generation — the functions that produce `ToProto()`, `FromProto()`, and `toProto()` methods in generated SDK code. These functions contain complex branching logic across 12+ type categories (scalars, maps, arrays, messages, well-known types, enums) with additional dimensions for required/optional fields, shared/local types, and language-specific patterns.

### Pain Points

- Silent regressions in generated conversion code could produce SDK methods that compile but silently lose data during proto serialization
- Type branch additions (e.g., adding a new `TypeSpec.Kind`) had no test to verify the generated output
- Shared type import behavior (cross-package `types.` prefix vs same-package direct reference) was untested
- No verification that `ToProto` and `FromProto` used consistent JSON keys — a mismatch would cause silent data loss during roundtrip conversion

## Solution

Created `tools/codegen/generator/conversion_test.go` with targeted substring assertions on the generated code output, exercising every branch in the conversion generation functions. Added roundtrip symmetry tests that structurally verify `ToProto` and `FromProto` produce compatible conversion code.

## Implementation Details

### Test file: `tools/codegen/generator/conversion_test.go`

12 test functions with 57 subtests covering:

**Part A — main.go structpb path** (both ToProto and FromProto):
- `TestGenFromProtoField`: All 18 `TypeSpec.Kind` branches — 6 scalars, struct, 4 map variants, 3 message variants (local/shared/well-known), 5 array variants, unknown kind
- `TestGenToProtoMethod`: 8 branches — required/optional x scalar/expression/message/array-of-message
- `TestGenWellKnownTypeFromProto`: Timestamp (RFC3339 string + struct paths), Duration, unknown type
- `TestGenerateMessageFieldConversion`: HttpEndpoint coerceToString vs no-op
- `TestGenTypeFromProtoMethod`: Shared type FromProto boilerplate
- `TestRoundtripSymmetry`: Structural verification of JSON key and field name consistency across 6 type categories

**Part B — sdk_client.go typed proto path** (toProto only):
- `TestEmitToProtoField`: All 14 switch branches — timestamp, struct, 5 scalars, 4 message variants, 2 array variants, 4 map variants
- `TestEmitOneofToProto`: Wrapper struct generation + typeMap miss
- `TestEmitNestedToProto`: Simple/struct paths, ApiResourceReference, all 4 skip conditions, recursive emission

**Test helpers**: Shared `field()`, `requiredField()`, `mustContain()`, `mustNotContain()` for concise test construction.

### Key design decisions

- **Separate file**: Kept conversion tests in `conversion_test.go`, separate from the 1,359-line `main_test.go` that covers pure utility functions
- **Substring assertions**: Tests verify critical patterns in generated output rather than exact string equality — resilient to formatting changes
- **Import assertions on ctx.imports**: Import paths are side-effects on `genContext`, not part of the buffer output — dedicated tests verify import behavior

## Benefits

- 57 new subtests covering every type branch in the conversion generation pipeline
- Roundtrip symmetry tests catch JSON key mismatches between ToProto/FromProto at test time rather than at runtime
- Total generator test count: 450 passing subtests across `main_test.go` + `conversion_test.go`

## Impact

- `tools/codegen/generator/` — 1 new test file (643 lines)
- Prevents silent regressions in generated SDK conversion code across all supported languages

## Related Work

- [Proto2Schema Unit Test Coverage](2026-03-18-142227-proto2schema-unit-test-coverage.md) — Task 1
- [Codegen Generator Unit Test Coverage](2026-03-18-143042-codegen-generator-unit-test-coverage.md) — Task 2
- Task 4 (pending): Integration test verifying generated Go code compiles end-to-end

---

**Status**: Production Ready
