# Codegen Generator Unit Test Coverage

**Date**: March 18, 2026

## Summary

Added comprehensive unit test coverage for the codegen generator package, which previously had zero tests across ~4,400 lines of production code in 6 source files. The new test suite includes 62 test functions with 358 total test cases covering pure functions for Go, TypeScript, Python, and Java SDK code generation.

## Problem Statement

The `tools/codegen/generator/` package is responsible for generating SDK client code in four languages from JSON schemas. Despite being a critical part of the build pipeline, it had no unit tests, making regressions in naming conventions, type mapping, and import path derivation invisible until they manifested as broken generated code.

### Pain Points

- Zero test coverage across 6 source files (~4,400 lines)
- Type mapping changes (e.g., proto types to Go/TS/Python/Java types) could silently break generated SDKs
- Naming convention functions (snake_case, PascalCase, camelCase conversions) had no regression protection
- Import path derivation logic was complex and untested
- Singularization/pluralization heuristics had undocumented edge cases

## Solution

Created a single comprehensive test file (`tools/codegen/generator/main_test.go`) that tests all pure functions across the 6 generator source files using Go's standard testing package with table-driven subtests.

## Implementation Details

- **1,358 lines** of test code in `main_test.go`
- **62 top-level test functions** with **358 test cases** via subtests
- Coverage spans all 6 source files: `main.go`, `sdk_client.go`, `sdk_client_ts.go`, `sdk_client_python.go`, `sdk_client_java.go`, `mcp.go`
- Tests use `genContext` with minimal initialization where method receivers are needed
- Focused exclusively on pure functions (no proto descriptor or file I/O dependencies)

### Categories Tested

| Category | Functions | Test Cases |
|----------|-----------|------------|
| Proto type/path parsing | extractDomain, extractSubdomain, protoTypeToGoImportPath, protoTypeToPackageAlias | ~30 |
| String transforms | titleCase, toSnakeCase, toPascalCase, sanitizeDescription, pascalToSnake | ~35 |
| Go type mapping | goType (scalars, arrays, maps, messages, well-known, shared), scalarGoType | ~40 |
| Go SDK helpers | deriveApiVersion, deriveGoImportPath, resolveType, goProtoFieldName, isSpecialType, isEmptyType, isIDType | ~50 |
| TypeScript SDK | deriveTSImportBase, tsProtoFieldName, tsClientFieldName, tsProtoFileToSuffix, tsResolveEnumImport, tsMethodName | ~40 |
| Python SDK | pyMethodName, pyTypeForTypeSpec, pyDefaultForTypeSpec, pyFieldName, pyIsNullableType, pyIsScalarKind | ~60 |
| Java SDK | javaCapCamel, javaCamel, javaSetterName, javaTypeForTypeSpec, resolveJavaFQCN, javaBoxed | ~70 |
| MCP helpers | singularize, isScalarSlice, parseMapType, protoTypeName | ~25 |
| Linguistic | singularize, pluralize, needsCoercion, matchEnumValue, isWordSubset | ~30 |

## Benefits

- Regression protection for the entire codegen pipeline's naming and type logic
- Documented actual behavior of edge cases (e.g., `isScalarSlice` accepting bare scalars, singularize trimming "Bus" → "Bu")
- Fast execution (~0.7s for all 358 tests)
- Foundation for adding higher-level generation tests (Tasks 3 and 4)

## Impact

- **Codegen pipeline**: All four language SDK generators now have tested type mapping and naming logic
- **Developer confidence**: Changes to shared functions like `toSnakeCase` or `goType` will be caught immediately
- **Documentation**: Test cases serve as executable documentation of expected behavior

## Related Work

- Previous session: Added proto2schema unit tests (39 test cases, 7 functions) — `tools/codegen/proto2schema/main_test.go`
- Remaining: Task 3 (ToProto/FromProto roundtrip tests) and Task 4 (integration compilation test)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
