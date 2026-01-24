# Fix SDK Codegen: Load Types from Namespace-Specific Subdirectories

**Date**: 2026-01-24 10:51:51  
**Scope**: `tools/codegen`, `sdk/go`  
**Type**: Bug Fix - Build Failures  
**Impact**: Critical - Unblocks SDK development

## Summary

Fixed critical build failures in the Stigmer Go SDK by enhancing the code generator to load type schemas from namespace-specific `types/` subdirectories. The generator was previously only loading types from top-level directories, causing three essential types (`WorkflowDocument`, `ExecutionValue`, `ExecutionConfig`) to be missing from the generated code.

## Problem

Running `make test-sdk` produced compilation errors:

```
# github.com/stigmer/stigmer/sdk/go/gen/executioncontext
gen/executioncontext/executioncontextspec_args.go:18:19: undefined: ExecutionValue

# github.com/stigmer/stigmer/sdk/go/gen/workflowexecution
gen/workflowexecution/workflowexecutionspec_args.go:68:25: undefined: ExecutionValue

# github.com/stigmer/stigmer/sdk/go/gen/agentexecution
gen/agentexecution/agentexecutionspec_args.go:22:19: undefined: ExecutionConfig
gen/agentexecution/agentexecutionspec_args.go:24:25: undefined: ExecutionValue

# github.com/stigmer/stigmer/sdk/go/gen/workflow
gen/workflow/workflowspec_args.go:26:12: undefined: WorkflowDocument
```

All SDK packages failed to build, blocking development completely.

## Root Cause Analysis

**Schema Files Exist But Weren't Being Loaded:**
- ✅ JSON schemas existed: `workflow/types/workflowdocument.json`, `executioncontext/types/executionvalue.json`, `agentexecution/types/executionconfig.json`
- ✅ Proto messages existed in appropriate proto files
- ❌ Code generator was skipping namespace-specific `types/` subdirectories

**Generator Logic Gap:**

The generator's `loadSchemas()` function in `tools/codegen/generator/main.go` had logic to:
1. Load types from top-level `types/` directory ✅
2. Load types from `agent/types/` directory ✅
3. Load resource specs from namespace directories ✅
4. **BUT**: When loading from namespace directories, it explicitly skipped subdirectories (line 368)

```go
for _, entry := range entries {
    // Skip subdirectories (like types/) and non-JSON files
    if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
        continue  // 👈 This was skipping types/ subdirectories!
    }
```

This meant types in `workflow/types/`, `executioncontext/types/`, and `agentexecution/types/` were never discovered.

## Solution

**Enhanced Namespace Scanning Logic:**

Modified `tools/codegen/generator/main.go` (lines 344-383) to:

1. **Detect `types/` subdirectories** within namespace directories
2. **Load type schemas** from these subdirectories
3. **Track loaded types** to avoid duplicates
4. **Extract domain** from proto namespace for proper categorization

**New Logic Flow:**
```go
// When scanning namespace directories (workflow/, agentexecution/, etc.)
for _, entry := range entries {
    // NEW: Check if this is a types/ subdirectory
    if entry.IsDir() && entry.Name() == "types" {
        // Load types from <namespace>/types/ directory
        namespaceTypesDir := filepath.Join(namespaceDir, "types")
        typeEntries, _ := os.ReadDir(namespaceTypesDir)
        
        for _, typeEntry := range typeEntries {
            if !typeEntry.IsDir() && strings.HasSuffix(typeEntry.Name(), ".json") {
                schema := loadTypeSchema(path)
                
                // Skip duplicates
                if !loadedTypes[schema.Name] {
                    loadedTypes[schema.Name] = true
                    schema.Domain = extractDomainFromProtoType(schema.ProtoType)
                    g.sharedTypes = append(g.sharedTypes, schema)
                }
            }
        }
        continue
    }
    
    // Existing logic for resource specs...
}
```

## Implementation Details

**Code Changes:**
- **File**: `tools/codegen/generator/main.go`
- **Function**: `loadSchemas()`
- **Lines Modified**: 344-383 (40 lines)
- **Change Type**: Logic enhancement, not refactoring

**Key Features:**
1. **Detects `types/` subdirectories** in all namespace folders
2. **Loads type schemas** using `loadTypeSchema()` (existing function)
3. **Deduplicates** using `loadedTypes` map
4. **Extracts domain** for proper Go package generation
5. **Logs discovery** for transparency

**Types Now Discovered:**
```
Loaded type: ExecutionConfig (domain: agentic, from agentexecution/types/)
Loaded type: ExecutionValue (domain: agentic, from agentexecution/types/)  
Loaded type: WorkflowDocument (domain: agentic, from workflow/types/)
```

## Verification

**Before Fix:**
```bash
$ make test-sdk
# Build failures in 4 packages
# 22 example tests failed (couldn't compile)
# FAIL
```

**After Fix:**
```bash
$ make codegen-go
✅ Loaded type: ExecutionConfig (domain: agentic, from agentexecution/types/)
✅ Loaded type: ExecutionValue (domain: agentic, from agentexecution/types/)
✅ Loaded type: WorkflowDocument (domain: agentic, from workflow/types/)
✅ Generated agentic_types.go (24 types)

$ make test-sdk
✅ 8/12 packages passing
✅ All compilation errors resolved
⚠️  4 packages with test logic failures (not build failures)
```

**Generated Types:**
- `sdk/go/gen/types/agentic_types.go` now contains:
  - `ExecutionConfig` (line 720)
  - `ExecutionValue` (line 737)
  - `WorkflowDocument` (line 762)

**Args Files Now Reference Correctly:**
```go
// Before (broken)
Document *WorkflowDocument  // ❌ undefined

// After (working)
import "github.com/stigmer/stigmer/sdk/go/gen/types"
Document *types.WorkflowDocument  // ✅ properly imported
```

## Files Changed

**Modified (1 file):**
- `tools/codegen/generator/main.go` - Enhanced namespace types loading

**Regenerated (27 files):**
All generated Go files were regenerated with proper type imports:
- `sdk/go/gen/types/agentic_types.go` - Added 3 new types
- `sdk/go/gen/types/commons_types.go` - Regenerated with updated timestamp
- 11 workflow task config files - Updated imports
- 11 Args files - Added proper `types.` prefixes
- 3 spec files - Updated imports

## Impact Assessment

**Critical Fix:**
- ✅ **Unblocks SDK development** - Code now compiles successfully
- ✅ **Enables testing** - 8/12 test packages now passing
- ✅ **Prevents future issues** - Pattern applies to all namespace types

**Build Status:**
- **Before**: 100% build failure (4/4 packages with compilation errors)
- **After**: 100% build success (0 compilation errors)

**Test Status:**
- **Before**: 0 tests running (build failures blocked execution)
- **After**: 
  - ✅ 8 packages passing (environment, synth, mcpserver, skill, stigmer, naming, subagent, templates)
  - ⚠️ 4 packages with test logic failures (not build failures):
    - `sdk/go` - 2 integration test failures (validation issues)
    - `agent` - Test logic issues
    - `examples` - Example test logic issues
    - `workflow` - Test logic issues

**No Breaking Changes:**
- Existing code patterns unchanged
- Same generated API surface
- Only fixes missing types

## Future Improvements

**Extensibility:**
The enhanced pattern now supports:
- ✅ Any namespace can have a `types/` subdirectory
- ✅ Types automatically discovered and loaded
- ✅ Proper domain extraction and Go package assignment
- ✅ Deduplication across multiple locations

**Example:**
If we add `workflowinstance/types/some-new-type.json`, it will automatically be:
1. Discovered during schema loading
2. Added to `sdk/go/gen/types/agentic_types.go`
3. Available for import in Args files

## Lessons Learned

**Code Generator Design:**
1. **Recursive scanning is important** - Don't skip subdirectories without checking their purpose
2. **Type discovery should be data-driven** - The generator shouldn't need hard-coded paths
3. **Logging is critical** - Clear output helped identify what was missing

**Proto-to-SDK Pipeline:**
1. **Schema generation works** - `proto2schema` successfully created JSON schemas
2. **Gap was in Go generation** - `generator` wasn't loading all schemas
3. **Test suite caught the issue** - `make test-sdk` immediately surfaced the problem

**Debugging Process:**
1. Started with test failures (undefined types)
2. Confirmed schemas exist (JSON files present)
3. Checked generator logic (found the gap)
4. Enhanced loading logic (minimal change)
5. Verified fix (all builds pass)

## Related Work

**Recent Context:**
This fix completes the work from the earlier conversation where we added comprehensive Args codegen for all proto namespaces. The generator was creating Args files that referenced these types, but the types themselves weren't being generated.

**Coordination:**
- Proto definitions: Already existed in `apis/ai/stigmer/agentic/*/v1/spec.proto`
- JSON schemas: Successfully generated by `proto2schema`  
- Go types: NOW successfully generated by `generator` (this fix)
- Args files: Already generated, now with correct imports

## Commit Scope

**Scope**: `tools/codegen`, `sdk/go`

**Conventional Commit:**
```
fix(tools/codegen): load type schemas from namespace subdirectories

Enhanced the code generator to discover and load type schemas from
namespace-specific types/ subdirectories (workflow/types/,
agentexecution/types/, executioncontext/types/, etc.).

Previously, the generator only loaded types from top-level directories,
causing three critical types to be missing from generated code:
- WorkflowDocument
- ExecutionValue  
- ExecutionConfig

This resulted in compilation failures across all SDK packages.

Modified tools/codegen/generator/main.go to:
- Detect types/ subdirectories within namespace folders
- Load type schemas using existing loadTypeSchema() function
- Deduplicate types across multiple locations
- Extract domain for proper Go package generation

Regenerated all SDK Go files with proper type imports.

Fixes: SDK build failures
Impact: Critical - unblocks SDK development and testing
```

## Testing

**Build Verification:**
```bash
# Regenerate code
make codegen-go  # ✅ Success - types now loaded

# Run tests  
make test-sdk    # ✅ Build success - 0 compilation errors
```

**Type Existence:**
```bash
# Verify types were generated
grep "type WorkflowDocument" sdk/go/gen/types/agentic_types.go  # ✅ Found (line 762)
grep "type ExecutionValue" sdk/go/gen/types/agentic_types.go    # ✅ Found (line 737)
grep "type ExecutionConfig" sdk/go/gen/types/agentic_types.go   # ✅ Found (line 720)
```

**Import Verification:**
```bash
# Verify Args files import types correctly
grep "types.WorkflowDocument" sdk/go/gen/workflow/workflowspec_args.go      # ✅ Found
grep "types.ExecutionValue" sdk/go/gen/executioncontext/executioncontextspec_args.go  # ✅ Found
grep "types.ExecutionConfig" sdk/go/gen/agentexecution/agentexecutionspec_args.go     # ✅ Found
```

## Conclusion

This fix resolves a critical gap in the code generator's type discovery logic, unblocking SDK development. The enhanced pattern is extensible and will automatically handle future namespace-specific types without requiring generator changes.

All SDK packages now compile successfully, enabling continued development and testing.
