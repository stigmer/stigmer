# Tasks: 20260124.01.sdk-codegen-completion

**Created**: 2026-01-24

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Automate buf/validate proto dependency

**Status**: ✅ DONE
**Created**: 2026-01-24 06:50
**Completed**: 2026-01-24

### Subtasks
- [x] Updated proto2schema to use buf's module cache
- [x] Removed manual stub-dir flag from Makefile
- [x] Updated README documentation
- [x] Tested full codegen pipeline

### Notes
- **Solution**: Integrated with existing buf infrastructure
- proto2schema now automatically uses buf's module cache at `~/.cache/buf/v3/modules/`
- No manual dependency management needed - just run `make protos` once
- Dependencies version-locked via `apis/buf.lock`
- Clean, professional solution that aligns with existing tooling

## Task 2: Fix hand-written *_options.go files to match generated struct types

**Status**: ✅ DONE
**Created**: 2026-01-24 06:50
**Completed**: 2026-01-24

### Subtasks
- [x] Fixed type mismatches in all *_options.go files
- [x] Fixed proto.go field references
- [x] Fixed validation.go field references
- [x] Fixed generated files missing types. prefix
- [x] Removed duplicate files and functions
- [x] Verified build success

### Notes
**Type mismatches fixed:**
- switch: `[]map[string]interface{}` → `[]*types.SwitchCase`
- agentcall: `map[string]interface{}` → `*types.AgentExecutionConfig`
- for: `[]map[string]interface{}` → `[]*types.WorkflowTask`
- fork: `[]map[string]interface{}` → `[]*types.ForkBranch`
- try: `Tasks []map` → `Try []*types.WorkflowTask`, `Catch []map` → `Catch *types.CatchBlock`

**Field name fixes:**
- httpcall: `URI` → `Endpoint.Uri`
- grpccall: `Body` → `Request`
- listen: `Event` → `To`
- run: `WorkflowName` → `Workflow`
- raise: Removed non-existent `Data` field

**Files cleaned:**
- Removed duplicate `wait_task.go` (old generated file)
- Removed duplicate `coerceToString` from set_options.go
- Fixed missing `types.` prefix in generated FromProto methods

## Task 3: Add TaskFieldRef helper methods (.Equals(), .GreaterThan(), .LessThan(), etc.)

**Status**: 🚧 IN PROGRESS  
**Created**: 2026-01-24 06:50

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 4: Update example 08_workflow_with_conditionals.go to demonstrate new API

**Status**: ⏸️ TODO
**Created**: 2026-01-24 06:50

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

