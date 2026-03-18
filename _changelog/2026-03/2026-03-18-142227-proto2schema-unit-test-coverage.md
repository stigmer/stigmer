# Add Unit Test Coverage for proto2schema Codegen Tool

**Date**: March 18, 2026

## Summary

Added the first unit tests for the `proto2schema` codegen tool, covering 7 pure functions with 39 test cases. This establishes a test foundation for the critical codegen pipeline that generates SDK code across Go, TypeScript, Python, and Java.

## Problem Statement

The `proto2schema` and `generator` codegen tools have zero test coverage across ~5,700 lines of production code. These tools are responsible for converting Protocol Buffer definitions into JSON schemas and then generating SDK client code. Silent regressions in type mapping, naming conversions, or validation extraction would propagate to all generated SDKs.

### Pain Points

- No safety net for refactoring codegen logic
- Naming conversion bugs (e.g., `toCamelCase`, `extractTaskKind`) could silently produce incorrect SDK field names
- Protowire binary parsing in `extractStringFromUnknownFields` is particularly fragile without tests
- Changes to the codegen pipeline require manual verification across all target languages

## Solution

Started with the highest-value, lowest-friction approach: unit testing pure functions that have no external dependencies (no proto file parsing, no filesystem). Used Go table-driven tests throughout.

## Implementation Details

Created `tools/codegen/proto2schema/main_test.go` with tests for:

- **`extractTaskKind`** (9 cases) — CamelCase message name to UPPER_SNAKE_CASE task kind
- **`toCamelCase`** (14 cases) — snake_case to CamelCase with capitalizeFirst flag
- **`deriveGoImportAlias`** (6 cases) — Proto package to Go import alias
- **`inferServiceRole`** (7 cases) — Service name classification as command/query
- **`capitalize`** (6 cases) — First-letter capitalization
- **`countMethods`** (4 cases) — Service method counting
- **`extractStringFromUnknownFields`** (6 cases) — Protowire binary parsing using constructed test data

## Benefits

- Prevents regressions in naming conversions that affect all generated SDK code
- Establishes testing patterns (table-driven, protowire construction) reusable for remaining codegen tests
- Documents actual behavior (e.g., `toCamelCase` leaves first part untouched when `capitalizeFirst=false`)

## Impact

- **Scope**: `tools/codegen/proto2schema/` — 1 new test file, 39 test cases
- **Coverage**: 7 of the tool's pure functions now have tests; remaining functions depend on proto descriptors and will be covered in subsequent tasks

## Related Work

- Part of project `20260318.02.codegen-test-coverage` (Tasks 2-4 remaining: generator tests, roundtrip tests, integration tests)

---

**Status**: ✅ Production Ready
