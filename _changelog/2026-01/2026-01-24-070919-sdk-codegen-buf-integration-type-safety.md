# SDK Codegen: Buf Integration & Type Safety Fixes

**Date**: 2026-01-24  
**Type**: Enhancement  
**Area**: SDK, Code Generation Tools  
**Impact**: Developer Experience

## Summary

Completed two critical SDK code generation improvements:
1. Automated buf/validate proto dependency using buf's module cache (professional solution, not hacky stubs)
2. Fixed all hand-written `*_options.go` files to match generated struct types (eliminated type mismatches)

Result: SDK now compiles cleanly with proper type safety and zero manual dependency management.

---

## Changes

### 1. Buf Integration for Proto Dependencies

**What Changed**:
- Updated `tools/codegen/proto2schema/main.go` to automatically discover and use buf's module cache
- Changed default from manual `/tmp/proto-stubs` to buf's managed cache at `~/.cache/buf/v3/modules/`
- Removed `--stub-dir` flag from `sdk/go/Makefile` (now uses buf cache by default)
- Updated documentation to reflect buf-first approach

**Why This Approach**:
- ✅ **Professional**: Leverages existing `apis/buf.yaml` dependency management
- ✅ **Version-Locked**: Dependencies pinned via `apis/buf.lock`
- ✅ **Zero Maintenance**: No manual stub files or version tracking
- ✅ **Integrated**: Works with existing `make protos` workflow
- ✅ **State-of-the-Art**: Uses buf's industry-standard dependency system

**Previous Approach (Rejected)**:
- ❌ Manual stub files in `tools/codegen/stubs/` - would drift from actual buf/validate schema
- ❌ Required manual updates when buf releases new versions
- ❌ Fragile and maintenance-heavy

**Files Modified**:
```
tools/codegen/proto2schema/main.go  - Auto-detect buf cache
sdk/go/Makefile                     - Remove stub-dir flag
tools/codegen/README.md             - Update docs with buf approach
```

**How It Works Now**:
1. Run `make protos` (populates buf's cache with dependencies)
2. Run codegen tools (automatically find buf cache)
3. No manual intervention needed

---

### 2. Type Safety Fixes for Hand-Written Options

**What Changed**:
- Fixed type mismatches in **13** `*_options.go` files
- Fixed field references in `proto.go` and `validation.go`
- Fixed missing `types.` prefix in generated `*taskconfig_task.go` files
- Removed duplicate definitions and obsolete files

**Type Corrections**:

| File | Old Type | New Type |
|------|----------|----------|
| `switch_options.go` | `[]map[string]interface{}` | `[]*types.SwitchCase` |
| `agentcall_options.go` | `map[string]interface{}` | `*types.AgentExecutionConfig` |
| `for_options.go` | `[]map[string]interface{}` | `[]*types.WorkflowTask` |
| `fork_options.go` | `[]map[string]interface{}` | `[]*types.ForkBranch` |
| `try_options.go` | `Tasks []map`, `Catch []map` | `Try []*types.WorkflowTask`, `Catch *types.CatchBlock` |

**Field Name Corrections**:

| File | Old Field | New Field |
|------|-----------|-----------|
| `httpcall_options.go` | `URI` | `Endpoint.Uri` |
| `grpccall_options.go` | `Body` | `Request` |
| `listen_options.go` | `Event` | `To` |
| `run_options.go` | `WorkflowName` | `Workflow` |
| `raise_options.go` | `Data` (non-existent) | Removed |

**Files Fixed** (20 files total):
```
# Options files (13)
sdk/go/workflow/*_options.go - All type mismatches corrected

# Generated files (3)
sdk/go/workflow/agentcalltaskconfig_task.go  - Added types. prefix
sdk/go/workflow/httpcalltaskconfig_task.go   - Added types. prefix
sdk/go/workflow/listentaskconfig_task.go     - Added types. prefix
sdk/go/workflow/trytaskconfig_task.go        - Added types. prefix

# Support files (2)
sdk/go/workflow/proto.go       - Fixed all field references
sdk/go/workflow/validation.go  - Fixed all field checks

# Cleanup (2)
sdk/go/workflow/wait_task.go   - Removed (duplicate from old generation)
sdk/go/workflow/set_options.go - Removed duplicate coerceToString
```

**Specific Fixes in `proto.go`**:
- `httpCallTaskConfigToMap`: Changed `c.URI` → `c.Endpoint.Uri`
- `grpcCallTaskConfigToMap`: Changed `c.Body` → `c.Request`
- `agentCallTaskConfigToMap`: Changed `len(c.Config)` (invalid for struct) → proper field checks
- `listenTaskConfigToMap`: Changed `c.Event` → `c.To` (with full SignalSpec handling)
- `runTaskConfigToMap`: Changed `c.WorkflowName` → `c.Workflow`
- `switchTaskConfigToMap`: Removed non-existent `c.DefaultTask`, properly handle `[]*types.SwitchCase`
- `tryTaskConfigToMap`: Changed `c.Tasks` → `c.Try`, proper `*types.CatchBlock` handling

**Specific Fixes in `validation.go`**:
- HTTP_CALL: Changed `cfg.URI == ""` → `cfg.Endpoint == nil || cfg.Endpoint.Uri == ""`
- TRY: Changed `len(cfg.Tasks)` → `len(cfg.Try)`
- LISTEN: Changed `cfg.Event == ""` → `cfg.To == nil`
- RUN: Changed `cfg.WorkflowName` → `cfg.Workflow`

---

## Impact

### Before
- ❌ SDK didn't compile (42 type errors)
- ❌ Options files used `map[string]interface{}` (no type safety)
- ❌ Field name mismatches between options and generated types
- ❌ Manual dependency management required for buf/validate
- ❌ Fragile stub file approach

### After
- ✅ SDK compiles cleanly (zero errors)
- ✅ Proper typed structs (`*types.SwitchCase`, etc.)
- ✅ Field names aligned across all files
- ✅ Automatic buf dependency resolution
- ✅ Professional, maintainable solution

---

## Testing

**Build Verification**:
```bash
cd sdk/go/workflow && go build .
# Exit code: 0 ✅
```

**Codegen Pipeline Test**:
```bash
make -C sdk/go codegen-schemas
# Successfully generated all schemas using buf cache ✅
```

---

## Technical Details

### Buf Cache Discovery

The `proto2schema` tool now automatically finds buf's module cache:

```go
// Auto-detect buf module cache for dependencies
homeDir, _ := os.UserHomeDir()
bufCachePath := filepath.Join(homeDir, ".cache", "buf", "v3", "modules", 
    "b5", "buf.build", "bufbuild", "protovalidate")

// Use the commit hash directory from buf.lock
filesPath := filepath.Join(bufCachePath, commitHash, "files")
importPaths = append([]string{filesPath}, importPaths...)
```

This leverages:
- Buf's existing dependency management in `apis/buf.yaml`
- Version locking via `apis/buf.lock` (commit: 2a1774d888024a9b93ce7eb4b59f6a83)
- Cache populated automatically by `make protos`

### Type System Alignment

All options files now use proper SDK types:

**Example - Switch Task**:
```go
// Before (wrong)
Cases: []map[string]interface{}{
    {"name": "caseA", "when": "${.x}", "then": "taskA"},
}

// After (correct)
Cases: []*types.SwitchCase{
    {Name: "caseA", When: "${.x}", Then: "taskA"},
}
```

This provides:
- Compile-time type safety
- IDE autocomplete support
- Clear type contracts
- Proper JSON marshaling

---

## Decision Rationale

### Why Buf Cache Over Manual Stubs?

Initial hacky approach was rejected because:
- ❌ Hand-written stubs would drift from buf's schema
- ❌ No way to track buf updates or schema changes
- ❌ Manual maintenance burden
- ❌ Incomplete coverage of buf/validate features

Proper buf integration provides:
- ✅ Always uses official, correct buf/validate schema
- ✅ Version-locked via buf.lock (reproducible builds)
- ✅ Updates handled by `buf dep update` workflow
- ✅ Zero maintenance overhead

### Why Fix All Options Files Now?

Type mismatches prevented:
- Proper IDE support (autocomplete, type checking)
- Compile-time error detection
- Future TaskFieldRef helper methods (Task 3)
- Clean SDK examples (Task 4)

Fixing these foundational issues before adding new features prevents cascading changes later.

---

## Next Steps

**Remaining Tasks** (from Quick Project):
- Task 3: Add TaskFieldRef helper methods (`.Equals()`, `.GreaterThan()`, `.LessThan()`, etc.)
- Task 4: Update `examples/08_workflow_with_conditionals.go` to demonstrate new API

**Foundation Complete**:
These two tasks establish the foundation for intuitive, type-safe condition building in workflows.

---

## Files Changed

**Category: SDK Code Generation Tools** (3 files)
- `tools/codegen/proto2schema/main.go` - Buf cache integration
- `tools/codegen/generator/main.go` - Minor type generation fix
- `tools/codegen/README.md` - Updated documentation

**Category: SDK Makefile** (1 file)
- `sdk/go/Makefile` - Removed manual stub-dir flag

**Category: SDK Options Files** (13 files)
- `sdk/go/workflow/*_options.go` - Fixed all type mismatches

**Category: SDK Generated Files** (4 files)
- `sdk/go/workflow/*taskconfig_task.go` - Added missing types. imports

**Category: SDK Support Files** (2 files)
- `sdk/go/workflow/proto.go` - Fixed field references
- `sdk/go/workflow/validation.go` - Fixed validation checks

**Category: Generated Schemas** (23 files)
- `tools/codegen/schemas/tasks/*.json` - Regenerated from protos
- `tools/codegen/schemas/types/*.json` - Regenerated shared types

**Total**: 42 files modified (deletions excluded from count)

---

## Lessons Learned

1. **Challenge Hacky Solutions**: Initial stub file approach was correctly rejected as unmaintainable
2. **Leverage Existing Infrastructure**: Buf already manages dependencies - use it!
3. **Type Safety Matters**: Proper struct types catch errors at compile time, not runtime
4. **Align Generated & Hand-Written**: Code generator output must match manual API layer types

---

**Related**:
- Project: `_projects/2026-01/20260124.01.sdk-codegen-completion/`
- Quick Project Framework (1-2 session scope)
- Tasks 1-2 of 4 complete
