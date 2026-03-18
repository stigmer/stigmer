# Codegen Integration Tests and Production Bug Fixes

**Date**: March 18, 2026

## Summary

Added 7 integration tests for the codegen generator that exercise the full pipeline (JSON schema -> Go code generation -> syntax validation) and discovered 2 production bugs where `uint32` and `timestamp` type kinds caused panics during code generation. Both bugs were fixed.

## Problem Statement

The codegen generator had unit tests for individual pure functions and conversion code generation, but no integration tests that exercised the full pipeline: loading JSON schemas from disk, running the Generator, and verifying the output is valid Go. This meant schema-level regressions (like unsupported type kinds) could go undetected until the generator was run manually.

### Pain Points

- No end-to-end test coverage for the generator pipeline
- Two type kinds (`uint32` and `timestamp`) listed in the TypeSpec documentation but not handled by `goType()` or `genFromProtoField()`, causing panics when generating code from schemas that used them
- The `Duration` shared type (5 fields) and `WaitTaskConfig` / `ApiKeySpec` schemas were silently broken

## Solution

Created `tools/codegen/generator/integration_test.go` with 7 test functions that:
1. Construct temporary directories with JSON schema files covering all TypeSpec kinds
2. Create a Generator instance, run `Generate()`
3. Verify all generated `.go` files pass `go/parser.ParseFile` (syntax validation)
4. Verify structural properties (struct definitions, method signatures, package declarations)
5. Run against the full production schemas directory as a regression guard

Fixed the two production bugs by adding `uint32` and `timestamp` support to `goType()` and `genFromProtoField()` in `main.go`.

## Implementation Details

### Integration Tests

| Test | Coverage |
|---|---|
| `TestIntegrationSyntheticSchemas` | All scalar types, maps, arrays, well-known types, struct, expression, shared types, resource specs (7 subtests) |
| `TestIntegrationMessageArrayAndMapValues` | Arrays of messages, maps with message values |
| `TestIntegrationEnumFields` | Enum type fields |
| `TestIntegrationRealSchemas` | All 99 production JSON schemas |
| `TestIntegrationFileSuffix` | `--file-suffix` flag behavior |
| `TestIntegrationMultipleResourceSubdomains` | Multi-namespace resource generation |
| `TestIntegrationResourceWithSharedTypes` | Cross-package type references |

### Bug Fixes (main.go)

- `goType()`: Added `case "uint32": return "uint32"` and `case "timestamp"` returning `*timestamppb.Timestamp` with import
- `genFromProtoField()`: Added `uint32(val.GetNumberValue())` conversion and full RFC3339/struct-based timestamp parsing

## Benefits

- Regression guard against schema changes that break code generation
- Caught 2 real bugs that would have caused panics in production
- `TestIntegrationRealSchemas` runs against all production schemas, so new schemas are automatically covered

## Impact

- `tools/codegen/generator/main.go`: 3 additions to `goType()`, ~20 additions to `genFromProtoField()`
- `tools/codegen/generator/integration_test.go`: New file (7 test functions)
- Affects: `Duration` type, `WaitTaskConfig`, `ApiKeySpec` — these schemas now generate valid Go code

## Related Work

- [Codegen Generator Unit Test Coverage](2026-03-18-143042-codegen-generator-unit-test-coverage.md)
- [Codegen Conversion Generation Test Coverage](2026-03-18-150758-codegen-conversion-generation-test-coverage.md)
- [Proto2Schema Unit Test Coverage](2026-03-18-142227-proto2schema-unit-test-coverage.md)

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour (Session 4 of codegen-test-coverage project)
