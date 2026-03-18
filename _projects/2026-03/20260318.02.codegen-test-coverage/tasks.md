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

**Status**: ⏸️ TODO
**Created**: 2026-03-18 14:12

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 3: Add unit tests for ToProto/FromProto generation and roundtrip correctness

**Status**: ⏸️ TODO
**Created**: 2026-03-18 14:12

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 4: Add integration test: JSON schema -> generated Go code compiles successfully

**Status**: ⏸️ TODO
**Created**: 2026-03-18 14:12

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

