# Tasks: 20260318.02.codegen-test-coverage

**Created**: 2026-03-18

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Add unit tests for proto2schema pure functions (extractTaskKind, toCamelCase, naming conversions, type spec extraction)

**Status**: ✅ DONE
**Created**: 2026-03-18 14:12
**Completed**: 2026-03-18

### Subtasks
- [x] Test extractTaskKind (9 cases: single word, multi-word camelCase, acronyms, edge cases)
- [x] Test toCamelCase (14 cases: capitalize/no-capitalize, edge cases)
- [x] Test deriveGoImportAlias (6 cases: various proto packages)
- [x] Test inferServiceRole (7 cases: command/query/default)
- [x] Test capitalize (6 cases: edge cases)
- [x] Test countMethods (4 cases: nil, single, multiple, empty)
- [x] Test extractStringFromUnknownFields (6 cases: using constructed protowire binary)

### Notes
- Created `tools/codegen/proto2schema/main_test.go` with 39 test cases across 7 test functions
- All tests pass
- toCamelCase with capitalizeFirst=false leaves the first part completely untouched (doesn't lowercase it)

## Task 2: Add unit tests for generator pure functions (goType, toSnakeCase, titleCase, singularize/pluralize, type mapping)

**Status**: ✅ DONE
**Created**: 2026-03-18 14:12
**Completed**: 2026-03-18

### Subtasks
- [x] Read all 6 generator source files (main.go, sdk_client.go, sdk_client_ts.go, sdk_client_python.go, sdk_client_java.go, mcp.go)
- [x] Create `tools/codegen/generator/main_test.go` with unit tests for pure functions across all 6 files
- [x] Run tests and fix expectation mismatches
- [x] All 62 top-level test functions pass (358 total test cases with subtests)

### Notes
- Created `tools/codegen/generator/main_test.go` covering pure functions from all 6 source files
- Tests cover: extractDomain, extractSubdomain, protoTypeToGoImportPath, protoTypeToPackageAlias, titleCase, toSnakeCase, sanitizeDescription, matchEnumValue, isWordSubset, paramName, goType (scalars, arrays, maps, messages, well-known types, shared types), singularize, pluralize, needsCoercion, isWellKnownProtoType, deriveApiVersion, deriveGoImportPath, pascalToSnake, isSpecialType, isEmptyType, isIDType, goProtoFieldName, resolveType, deriveTSImportBase, tsProtoFieldName, tsClientFieldName, tsProtoFileToSuffix, tsResolveEnumImport, isCommonsType, tsMethodName, pyMethodName, pyStubMethodName, pyClientFieldName, pyTypeForTypeSpec, pyDefaultForTypeSpec, pyDefaultForField, pyIsNullableType, pyNeedsFieldImport, pyFieldName, pyIsScalarKind, javaCapCamel, javaCamel, javaSetterName, javaAddAllName, javaAddName, javaPutName, javaPutAllName, javaMethodLower, javaAccessorName, resolveJavaFQCN, javaBoxed, javaIsPrimitive, javaTypeForTypeSpec, resolveJavaEnumImport, scalarGoType, isScalarSlice, parseMapType, toPascalCase, singularize (mcp), protoTypeName
- `isScalarSlice` doesn't verify the `[]` prefix — bare scalar type names also return true (quirk of TrimPrefix approach)
- Both `genContext.singularize` and mcp `singularize` strip trailing "s" from words like "Bus" → "Bu" (known limitation of the simple heuristic)

## Task 3: Add unit tests for ToProto/FromProto generation and roundtrip correctness

**Status**: ✅ DONE
**Created**: 2026-03-18 14:12
**Completed**: 2026-03-18

### Subtasks
- [x] Test genFromProtoField — all 18 TypeSpec.Kind branches (scalars, struct, map variants, message variants, array variants, unknown)
- [x] Test genFromProtoField shared type import behavior (cross-package vs same-package)
- [x] Test genFromProtoField shared type in map values (import added)
- [x] Test genToProtoMethod — 8 branches (required/optional x scalar/expression/message/array-of-message)
- [x] Test genToProtoMethod import side-effects (structpb, encoding/json)
- [x] Test genWellKnownTypeFromProto — Timestamp (RFC3339 + struct paths), Duration, unknown type
- [x] Test generateMessageFieldConversion — HttpEndpoint coerceToString vs no-op
- [x] Test genTypeFromProtoMethod — shared type FromProto boilerplate
- [x] Test roundtrip symmetry — verify ToProto/FromProto use matching JSON keys and field names
- [x] Test emitToProtoField (sdk_client.go) — all 14 switch branches (timestamp, struct, scalars, messages, arrays, maps)
- [x] Test emitOneofToProto — wrapper struct generation + typeMap miss
- [x] Test emitNestedToProto — simple/struct paths, ApiResourceReference, skip conditions, recursion

### Notes
- Created `tools/codegen/generator/conversion_test.go` with 12 test functions and 57 subtests
- Tests cover both conversion systems: main.go structpb path (ToProto + FromProto) and sdk_client.go typed proto path (toProto only)
- Import path assertions must check `ctx.imports` (not buffer output) — imports are tracked as side-effects on genContext
- When genContext.packageName matches the shared types package ("types"), no `types.` prefix is added — tested explicitly
- All 450 subtests pass across both test files (main_test.go + conversion_test.go)

## Task 4: Add integration test: JSON schema -> generated Go code compiles successfully

**Status**: ✅ DONE
**Created**: 2026-03-18 14:12
**Completed**: 2026-03-18

### Subtasks
- [x] Create integration test framework with temp dir setup, JSON schema writing, and Go parser verification
- [x] TestIntegrationSyntheticSchemas: all scalar types, maps, arrays, well-known types, struct, expression, shared types, resource specs
- [x] TestIntegrationMessageArrayAndMapValues: arrays of messages, maps with message values
- [x] TestIntegrationEnumFields: enum type fields
- [x] TestIntegrationRealSchemas: runs against all production schemas (caught 2 real bugs)
- [x] TestIntegrationFileSuffix: verifies --file-suffix flag
- [x] TestIntegrationMultipleResourceSubdomains: multiple namespace/subdomain resource generation
- [x] TestIntegrationResourceWithSharedTypes: resource specs referencing shared types from types/ subdirs
- [x] Fix production bug: add `uint32` kind support to goType() and genFromProtoField()
- [x] Fix production bug: add `timestamp` kind support to goType() and genFromProtoField()

### Notes
- Created `tools/codegen/generator/integration_test.go` with 7 test functions
- The real-schemas test (TestIntegrationRealSchemas) found 2 actual production bugs:
  1. `goType()` and `genFromProtoField()` didn't handle `uint32` kind — used by `Duration` type in tasks/types/duration.json
  2. `goType()` and `genFromProtoField()` didn't handle `timestamp` kind — used by `WaitTaskConfig` and `ApiKeySpec`
- Both bugs caused panics when generating code from those schemas
- Fixed by adding `uint32` and `timestamp` cases to both `goType()` and `genFromProtoField()` in main.go
- Tests use `os.Chdir` to temp dirs to handle hardcoded relative output paths in the generator
- All generated files verified via `go/parser.ParseFile` (syntax validity) on top of `go/format.Source()` (which the generator already calls internally)


## Project Completion Checklist

When all tasks are done:
- [x] All tasks marked ✅ DONE
- [x] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

