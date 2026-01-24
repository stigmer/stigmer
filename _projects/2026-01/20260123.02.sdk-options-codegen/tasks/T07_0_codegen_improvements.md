# Task 07: Code Generation Improvements

**Status**: 🚧 In Progress  
**Created**: 2026-01-24  
**Type**: Enhancement

## Objective

Complete the SDK code generation improvements by fixing the switch case type generation, handling buf/validate dependencies properly, and enhancing the developer experience with helper methods.

## Background

During the original sdk-options-codegen project, we focused on migrating from functional options to struct-based Args (Pulumi pattern). After project completion, several code generation issues were discovered:

1. **Switch Case Type Generation**: The `SwitchTaskConfig` was using `[]map[string]interface{}` instead of properly typed `[]*types.SwitchCase`
2. **buf/validate Dependency**: Proto schema generation fails without manual stub creation
3. **Developer Experience**: Users have to manually construct conditions like `statusCode.Expression() + " == 200"` instead of using helper methods
4. **Hand-written Options**: Several `*_options.go` files need updates to match generated struct types

## Tasks

### ✅ Phase 1: Fix Code Generation Pipeline

- [x] Add Makefile targets for SDK code generation (`make codegen-schemas`, `make codegen-go`, `make codegen`)
- [x] Fix `proto2schema` to properly detect nested message types (e.g., `SwitchCase` from `repeated SwitchCase cases`)
- [x] Fix `generator` to load shared types from `types/` directory (not just `agent/types/`)
- [x] Add deduplication logic to prevent duplicate type generation
- [x] Generate proper `SwitchCase` type with typed fields (`Name`, `When`, `Then`)
- [x] Update `SwitchTaskConfig` to use `[]*types.SwitchCase` instead of `[]map[string]interface{}`
- [x] Clean up old manually-written `*_task.go` files that conflict with generated versions

### 🚧 Phase 2: buf/validate Dependency Handling

**Current State**: Proto schema generation requires manual creation of `/tmp/proto-stubs/buf/validate/validate.proto`

**Goal**: Automate buf/validate stub creation or use official proto sources

**Options**:
1. Bundle minimal buf/validate.proto in repository (under `tools/codegen/stubs/`)
2. Download from buf.build during generation
3. Use go module for buf.validate protos

**Acceptance Criteria**:
- [ ] `make codegen-schemas` works without manual stub creation
- [ ] buf/validate protos are available automatically
- [ ] Solution is documented in Makefile or README

### 📋 Phase 3: Update Hand-written Options Files

**Files needing updates**:
- [ ] `workflow/agentcall_options.go` - use `*types.AgentExecutionConfig`
- [ ] `workflow/for_options.go` - use `[]*types.WorkflowTask`
- [ ] `workflow/fork_options.go` - use `[]*types.ForkBranch`
- [ ] `workflow/grpccall_options.go` - fix `Body` field references
- [ ] `workflow/httpcall_options.go` - fix `URI` field name
- [ ] Remove duplicate `coerceToString` between `set_options.go` and `helpers.go`

**Acceptance Criteria**:
- [ ] All workflow package files compile without errors
- [ ] Options files use generated types correctly
- [ ] No duplicate function definitions

### 🎯 Phase 4: Enhance Developer Experience

**Add helper methods to `TaskFieldRef`**:
```go
func (r TaskFieldRef) Equals(value interface{}) string
func (r TaskFieldRef) NotEquals(value interface{}) string
func (r TaskFieldRef) GreaterThan(value interface{}) string
func (r TaskFieldRef) GreaterThanOrEqual(value interface{}) string
func (r TaskFieldRef) LessThan(value interface{}) string
func (r TaskFieldRef) LessThanOrEqual(value interface{}) string
func (r TaskFieldRef) In(values ...interface{}) string
func (r TaskFieldRef) Contains(value interface{}) string
```

**Update example**:
- [ ] Update `08_workflow_with_conditionals.go` to use new helper methods
- [ ] Show cleaner API: `statusCode.Equals(200)` instead of `statusCode.Expression() + " == 200"`

**Acceptance Criteria**:
- [ ] Helper methods implemented on `TaskFieldRef`
- [ ] Example updated and runs successfully
- [ ] API is more discoverable and user-friendly

## Success Criteria

- ✅ Code generation pipeline works end-to-end
- ✅ Properly typed `SwitchCase` struct generated and used
- ⏳ buf/validate dependency handled automatically
- ⏳ All SDK files compile without errors
- ⏳ Developer experience improved with helper methods
- ⏳ Example demonstrates clean, intuitive API

## Technical Decisions

### Decision 1: Struct Generation Pattern

**Context**: proto2schema wasn't detecting nested message types in repeated fields.

**Decision**: Enhanced `collectNestedTypes()` to properly traverse repeated message fields and extract their type definitions.

**Result**: `SwitchCase` now properly generated as a shared type in `tools/codegen/schemas/types/switchcase.json`.

### Decision 2: Type Loading Strategy

**Context**: Generator was only loading types from `agent/types/`, missing workflow task types.

**Decision**: Load from both `types/` (workflow task types) and `agent/types/` (agent types) with deduplication.

**Result**: All shared types available, duplicates eliminated.

### Decision 3: File Naming Convention

**Context**: Old hand-written files like `switch_task.go` conflicted with generated `switchtaskconfig_task.go`.

**Decision**: Generator uses lowercase config name + suffix pattern. Old files should be removed.

**Result**: Clear separation between hand-written helpers and generated configs.

## Next Steps

1. **Immediate**: Handle buf/validate dependency (Phase 2)
2. **Short-term**: Fix hand-written options files (Phase 3)
3. **Enhancement**: Add TaskFieldRef helper methods (Phase 4)

## References

- Original Project: `_projects/2026-01/20260123.02.sdk-options-codegen/`
- Switch Proto: `apis/ai/stigmer/agentic/workflow/v1/tasks/switch.proto`
- Generator Code: `tools/codegen/generator/main.go`
- Proto2Schema Code: `tools/codegen/proto2schema/main.go`
- SDK Makefile: `sdk/go/Makefile`

## Notes

- This work builds on the completed sdk-options-codegen project
- Discovered issues during actual usage of the SDK
- Focus on developer experience and automation
- Code generation should "just work" without manual setup
