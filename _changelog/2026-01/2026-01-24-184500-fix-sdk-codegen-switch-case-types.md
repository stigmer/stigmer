# Fix SDK Code Generation - Typed SwitchCase Support

**Date**: 2026-01-24 18:45  
**Type**: Enhancement  
**Scope**: SDK Code Generation, Workflow Types  
**Impact**: Developer Experience, Type Safety

## Summary

Fixed the SDK code generation pipeline to properly generate typed structures for workflow task configurations. The primary issue was `SwitchTaskConfig` using untyped `[]map[string]interface{}` instead of the properly typed `[]*types.SwitchCase`. This fix enhances type safety and developer experience across all workflow task types.

## Problem

During SDK usage, discovered that the `SwitchTaskConfig` was using an untyped map structure:

```go
// BEFORE (Broken - untyped):
type SwitchTaskConfig struct {
    Cases []map[string]interface{}  // ❌ No type safety
}

// Users had to write:
Cases: []map[string]interface{}{
    {
        "condition": statusCode.Expression() + " == 200",  // ❌ Magic strings
        "then":      "deployProduction",
    },
}
```

**Root Causes**:

1. **proto2schema** wasn't detecting nested message types like `SwitchCase` from `repeated SwitchCase cases`
2. **generator** only loaded types from `agent/types/`, missing workflow task types in `types/`
3. **generator** had duplicate type generation when types existed in multiple directories
4. **Old hand-written files** conflicted with newly generated files

## Solution

### 1. Code Generation Pipeline

**Added Makefile Targets** (`sdk/go/Makefile`):
```makefile
make codegen-schemas  # Stage 1: Proto → JSON schemas
make codegen-go       # Stage 2: JSON schemas → Go code
make codegen          # Full pipeline
```

**Benefits**:
- Automated workflow (no manual proto2schema/generator invocation)
- Clear separation of stages
- Easy to regenerate after proto changes

### 2. Fixed proto2schema

**File**: `tools/codegen/proto2schema/main.go`

**What Changed**:
- Enhanced `collectNestedTypes()` to properly detect message types in repeated fields
- Created buf/validate proto stub for dependency resolution (temporary solution)

**Result**:
- `SwitchCase` now properly detected and generated as shared type
- Schema written to `tools/codegen/schemas/types/switchcase.json`

**Generated Schema**:
```json
{
  "type": {
    "kind": "array",
    "elementType": {
      "kind": "message",          // ← Fixed! Was "struct"
      "messageType": "SwitchCase" // ← Proper type reference
    }
  }
}
```

### 3. Fixed generator

**File**: `tools/codegen/generator/main.go`

**Changes**:
- Load shared types from both `types/` (workflow tasks) and `agent/types/` (agent types)
- Added deduplication logic to prevent duplicate type generation
- Properly handle `"kind": "message"` in array element types

**Result**:
- All shared types loaded and available for generation
- No duplicate type definitions
- Proper cross-references between workflow and types packages

### 4. Generated Proper Types

**File**: `sdk/go/types/agentic_types.go`

**New Type**:
```go
type SwitchCase struct {
    Name string `json:"name,omitempty"`  // Case identifier
    When string `json:"when,omitempty"`  // Condition expression
    Then string `json:"then,omitempty"`  // Target task
}
```

**File**: `sdk/go/workflow/switchtaskconfig_task.go`

**Fixed Structure**:
```go
type SwitchTaskConfig struct {
    Cases []*types.SwitchCase `json:"cases,omitempty"`  // ✅ Typed!
}
```

### 5. Cleaned Up Conflicts

**Removed Old Files**:
- Deleted hand-written `*_task.go` files that conflicted with generated `*taskconfig_task.go`
- Generator now owns task config struct definitions
- Hand-written code limited to `*_options.go` helper files

## Files Changed

### Code Generation Tools
- `sdk/go/Makefile` - Added codegen targets
- `tools/codegen/proto2schema/main.go` - Fixed nested type detection
- `tools/codegen/generator/main.go` - Fixed type loading and deduplication

### Generated Files (New/Updated)
- `sdk/go/types/agentic_types.go` - 21 shared types (was 11, now deduplicated)
- `sdk/go/workflow/*taskconfig_task.go` - 13 task config files
- `tools/codegen/schemas/types/*.json` - 10 new shared type schemas
- `tools/codegen/schemas/tasks/*.json` - Updated task schemas

### Deleted Files
- `sdk/go/workflow/switch_task.go` (old, conflicting)
- `sdk/go/workflow/agentcall_task.go` (old, conflicting)
- `sdk/go/workflow/for_task.go` (old, conflicting)
- _(and 9 more old task files)_

## Impact

### Type Safety ✅
- Switch cases now have compile-time type checking
- No more magic string keys in maps
- IDE autocomplete for case structure

### Developer Experience ✅
- Clear structure: `Name`, `When`, `Then` fields
- Self-documenting code
- Easier to understand and maintain

### Code Generation ✅
- Repeatable, automated workflow
- Proper handling of nested types
- Works with all 13 workflow task types

## Current API

```go
// Users can now write:
config := &workflow.SwitchTaskConfig{
    Cases: []*types.SwitchCase{
        {
            Name: "success",
            When: "${ $context.statusCode == 200 }",
            Then: "deployProduction",
        },
        {
            Name: "accepted",
            When: "${ $context.statusCode == 202 }",
            Then: "deployStaging",
        },
    },
}
```

## Known Limitations

### 1. buf/validate Dependency

**Current**: Requires manual creation of `/tmp/proto-stubs/buf/validate/validate.proto`

**Stub Created**:
```proto
syntax = "proto3";
package buf.validate;

extend google.protobuf.FieldOptions {
  optional FieldConstraints field = 1071;
}

message FieldConstraints {
  optional StringRules string = 2;
  optional Int32Rules int32 = 3;
  // ... other rules
}
```

**Future**: Automate stub bundling or use official buf.validate from go modules

### 2. Hand-written Options Files

**Current**: Several `*_options.go` files don't compile due to type mismatches:
- `agentcall_options.go` - needs `*types.AgentExecutionConfig`
- `for_options.go` - needs `[]*types.WorkflowTask`
- `fork_options.go` - needs `[]*types.ForkBranch`
- etc.

**Impact**: SDK doesn't fully compile yet (task configs work, but option helpers need updates)

**Next**: Phase 3 of T07 will update these files

### 3. Condition Expression Helper Methods

**Current**: Users must manually construct conditions:
```go
statusCode.Expression() + " == 200"  // ❌ Manual string concatenation
```

**Desired**: Helper methods for better UX:
```go
statusCode.Equals(200)          // ✅ Fluent, type-safe
statusCode.GreaterThan(199)     // ✅ Discoverable
```

**Next**: Phase 4 of T07 will add these helpers to `TaskFieldRef`

## Testing

**Verified**:
- ✅ Schemas generated successfully from protos
- ✅ Go code generated successfully from schemas
- ✅ `SwitchCase` type properly defined with 3 fields
- ✅ `SwitchTaskConfig` uses `[]*types.SwitchCase`
- ✅ No duplicate type definitions
- ✅ Proper cross-package references (`workflow` → `types`)

**Not Yet Tested**:
- ⏳ Full SDK compilation (blocked by option file updates)
- ⏳ Example 08 with new API (blocked by helper methods)

## Technical Decisions

### Decision 1: Two-Stage Generation

**Rationale**: Separate proto parsing from Go code generation
- Stage 1 (proto→schema) handles proto complexities
- Stage 2 (schema→Go) handles Go-specific patterns
- Clear intermediate format (JSON schemas)

### Decision 2: Shared Types in types/ Package

**Rationale**: Centralize workflow task shared types
- Avoids circular imports between workflow tasks
- Single source of truth for shared structures
- Matches pattern used for agent/skill types

### Decision 3: Deduplication at Load Time

**Rationale**: Handle types that appear in multiple schema directories
- Simple map-based deduplication
- First occurrence wins
- Logs which types are loaded

### Decision 4: Delete Old Conflicting Files

**Rationale**: Generator owns task config definitions
- Hand-written configs caused confusion
- Generator creates consistent patterns
- Hand-written code limited to helpers (`*_options.go`)

## Next Steps (Task 07)

### Phase 2: buf/validate Dependency ⏳
- Automate buf/validate stub creation
- Bundle minimal proto in `tools/codegen/stubs/`
- OR download from buf.build during generation
- Update Makefile to handle automatically

### Phase 3: Fix Option Files ⏳
- Update all `*_options.go` files to use generated types
- Fix type mismatches
- Remove duplicate functions
- Ensure full SDK compilation

### Phase 4: Helper Methods 🎯
- Add `.Equals()`, `.GreaterThan()`, etc. to `TaskFieldRef`
- Update example 08 to demonstrate new API
- Improve developer experience and discoverability

## Related Work

**Original Project**: `_projects/2026-01/20260123.02.sdk-options-codegen/`
- Migrated SDK from functional options to struct-based Args (Pulumi pattern)
- This work extends that project with proper type generation

**Proto Files**:
- `apis/ai/stigmer/agentic/workflow/v1/tasks/switch.proto` - Source of truth
- Contains `SwitchCase` message definition

## Lessons Learned

1. **Proto reflection is complex** - Nested types require careful traversal
2. **Schema validation is crucial** - Outdated schemas cause runtime issues
3. **Type deduplication matters** - Same type in multiple places breaks compilation
4. **Clear naming conventions help** - Avoid conflicts between generated and hand-written files
5. **Automation saves time** - Make file targets reduce cognitive load

## Documentation Impact

**Files Updated**:
- Project task file: `tasks/T07_0_codegen_improvements.md`
- Project status: `next-task.md`

**Future Documentation Needed**:
- SDK code generation guide (how to add new task types)
- buf/validate setup instructions
- Developer guide for using typed workflow tasks

---

**End of Changelog**
