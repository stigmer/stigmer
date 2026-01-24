# Tasks: 20260124.02.sdk-loop-ergonomics

**Created**: 2026-01-24

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## PHASE 1: ANALYSIS & INVESTIGATION

## Task 1: Analyze Expression Field Usage Across Codebase

**Status**: ✅ DONE
**Created**: 2026-01-24 07:32
**Updated**: 2026-01-24 08:15
**Completed**: 2026-01-24 08:15

### Objective
Generate comprehensive report on fields that accept JQ expressions to inform architecture decisions

### Subtasks
- [x] Scan all `*TaskConfig` structs in `sdk/go/workflow/*_options.go`
- [x] Identify fields that accept expression strings (uri, In, body, etc.)
- [x] Count total expression fields across all 13+ task types
- [x] Document field types: string, map[string]interface{}, []interface{}
- [x] Check proto definitions for any existing patterns or annotations
- [x] Generate summary report with counts and examples

### Key Findings
- **Total expression fields**: ~20 fields across 13 task types
- **Fields requiring type change**: Only 6 simple string fields
- **Complexity**: MEDIUM - highly manageable
- **Proto approach**: NOT APPLICABLE - no proto files found, must use code gen patterns
- **Recommendation**: ✅ PROCEED with smart type conversion

### Deliverable
✅ Complete analysis report: `expression-fields-analysis.md`

### Notes
- **Context**: Users currently must call `.Expression()` manually on TaskFieldRef
- **Question**: Can we eliminate this with smart type conversion?
- **Scope**: Need data to decide if this is maintainable at scale
- **Proto approach**: Consider adding custom annotations like `[(expression_field) = true]`

### Expected Output
Markdown report containing:
- Total count of expression-accepting fields
- Breakdown by task type
- Examples of each field type pattern
- Complexity assessment

## Task 2: Evaluate Proto Annotation vs Code Generation Approach

**Status**: ✅ DONE
**Created**: 2026-01-24 07:45
**Completed**: 2026-01-24 08:15

### Objective
Decide between proto annotations vs code generation patterns for marking expression fields

### Subtasks
- [x] Research proto custom options/annotations syntax
- [x] Check if proto files exist for workflow tasks
- [x] Evaluate code generation pattern matching approach
- [x] Compare maintainability of both approaches
- [x] Document decision with rationale

### Decision: Code Generation Pattern Matching

**Chosen Approach**: Option B - Code Generation Patterns

### Rationale

**Proto Annotation Approach NOT APPLICABLE**:
- ❌ No proto files found in `apis/` directory for workflow tasks
- ❌ Code generation appears to be custom (not proto-based)
- ❌ Cannot add proto annotations without proto source files

**Code Generation Pattern Matching SELECTED**:
- ✅ Works with existing custom code generator
- ✅ Field name patterns are clear and predictable
- ✅ Easy to maintain and extend
- ✅ No changes to build tooling required

### Implementation Pattern

**Field Name Patterns to Match**:
```go
var expressionFieldPatterns = []string{
    "uri", "url", "endpoint",     // URI patterns
    "in", "input", "body",         // Input patterns
    "message", "text", "content",  // Message patterns
    "error",                       // Error patterns
    "event",                       // Event patterns
}
```

**Generator Logic**:
- Match field name (case-insensitive) against patterns
- Only convert `string` type fields to `interface{}`
- Generate smart type conversion in `ToProto()` methods
- Leave map and array fields unchanged (already flexible)

### Pros of Chosen Approach
✅ No proto infrastructure changes needed  
✅ Clear, maintainable patterns  
✅ Works with existing tooling  
✅ Easy to extend for new task types  
✅ Predictable behavior  

### Cons (Mitigated)
⚠️ Implicit pattern matching - **Mitigated**: Clear documentation and tests  
⚠️ Could miss edge cases - **Mitigated**: Comprehensive field inventory completed  
⚠️ Harder to audit - **Mitigated**: Generator can output field detection log  

### Maintainability Assessment
- **Short-term**: Easy to implement, clear patterns
- **Long-term**: Scales well to new task types, pattern list is complete
- **Risk**: LOW - patterns are stable, field naming is consistent

### Notes
- Decision based on Task 1 findings
- Proto approach would have been preferred IF proto files existed
- Pattern matching is pragmatic solution for current architecture

## Task 3: Make Go/No-Go Decision on Smart Type Conversion

**Status**: ✅ DONE
**Created**: 2026-01-24 07:45
**Completed**: 2026-01-24 08:20
**Depends On**: Tasks 1, 2

### Objective
Decide whether to proceed with smart type conversion based on analysis

### Decision Criteria Analysis
- [x] ✅ **Scope manageable?** YES - Only ~20 fields, 6 need type changes (< 50 threshold)
- [x] ✅ **Long-term maintainability?** YES - Clear field name patterns, backward compatible
- [x] ✅ **UX improvement worth it?** YES - Eliminates `.Expression()` calls across entire SDK
- [x] ✅ **Clear pattern exists?** YES - Code generation pattern matching
- [x] ✅ **Will it scale?** YES - Pattern-based approach handles future task types

### 🎯 DECISION: ✅ **GO - PROCEED WITH IMPLEMENTATION**

**Confidence Level**: HIGH

### Detailed Rationale

#### Scope Assessment ✅ PASS
- **Total fields**: ~20 expression fields across 13 task types
- **Type changes needed**: Only 6 simple string fields
- **Threshold**: < 50 fields (we have 20)
- **Verdict**: Well within manageable scope

#### Pattern Assessment ✅ PASS
- **Approach**: Code generation field name matching
- **Patterns identified**: uri, url, in, input, message, error, event
- **Coverage**: 100% of current expression fields
- **Verdict**: Clear, predictable, maintainable

#### Maintainability Assessment ✅ PASS
- **Backward compatibility**: Zero breaking changes (interface{} accepts both)
- **Type safety**: Runtime validation with clear error messages
- **Testing surface**: ~25-30 straightforward test cases
- **Scaling**: Pattern automatically handles new task types
- **Verdict**: Low risk, high maintainability

#### UX Impact Assessment ✅ PASS

**Before (current)**:
```go
In: fetchTask.Field("items").Expression(),  // ❌ Verbose
Body: map[string]interface{}{
    "userId": userTask.Field("id").Expression(),  // ❌ Manual
},
```

**After (with smart conversion)**:
```go
In: fetchTask.Field("items"),  // ✅ Clean
Body: map[string]interface{}{
    "userId": userTask.Field("id"),  // ✅ Automatic
},
```

**Impact**: Significant UX improvement, reduces cognitive load, fewer errors

#### Risk Assessment ✅ LOW RISK
- **Type safety**: Maintained via runtime checks
- **Breaking changes**: None (fully backward compatible)
- **Implementation complexity**: LOW (only 6 fields)
- **Testing complexity**: LOW (straightforward cases)

### Implementation Scope

**Files to modify**: ~8 files
1. 6 generated TaskConfig files in `sdk/go/workflow/gen/`
2. 1 code generator update
3. 1 helper file (add `String()` to TaskFieldRef)

**Estimated effort**: 2-3 hours implementation + 1-2 hours testing

### Success Metrics

When implementation complete:
- ✅ All 6 string fields accept both string and TaskFieldRef
- ✅ Existing code continues to work (backward compatible)
- ✅ New code can omit `.Expression()` calls
- ✅ Clear error messages for type mismatches
- ✅ All tests pass
- ✅ Example code updated to demonstrate clean pattern

### Next Steps

1. ✅ **Task 4**: Implement LoopBody helper (independent, can do in parallel)
2. ✅ **Task 5**: Implement smart type conversion for 6 fields
3. ✅ **Task 6**: Update example 09 to use new patterns
4. ✅ **Task 7**: Add comprehensive tests
5. ✅ **Task 8**: Update documentation

### Alternative Considered: NO-GO

**Would require**:
- Scope > 100 fields (we have 20)
- No clear pattern (we have clear patterns)
- High complexity (we have low complexity)
- Breaking changes needed (we have zero)

**Verdict**: Not applicable - all criteria favor GO decision

---

**DECISION DOCUMENTED** ✅

Proceeding to Phase 2: Implementation

---

## PHASE 2: IMPLEMENTATION (Conditional on Task 3 Decision)

## Task 4: Add LoopBody helper function

**Status**: ✅ DONE
**Created**: 2026-01-24 07:32
**Completed**: 2026-01-24 08:10

### Objective
Create `workflow.LoopBody(func(item LoopVar) []*types.WorkflowTask)` helper to eliminate magic strings in loop bodies

### Subtasks
- [x] Add LoopBody helper function to for_options.go
- [x] Ensure LoopVar is accessible in closure
- [x] Handle default "item" variable name
- [x] Support custom variable names via Each field
- [x] Add godoc with examples

### Example Target API
```go
wf.ForEach("processItems", &workflow.ForArgs{
    In: fetchTask.Field("items"),
    Do: workflow.LoopBody(func(item LoopVar) []*types.WorkflowTask {
        return []*types.WorkflowTask{
            {
                Config: &workflow.HttpCallTaskConfig{
                    Body: map[string]interface{}{
                        "itemId": item.Field("id"),  // ✅ Type-safe!
                    },
                },
            },
        }
    }),
})
```

### Notes
- Core feature - always implement regardless of Task 3 decision
- Builds on existing LoopVar type

### Implementation Details
- Returns `[]*types.WorkflowTask` (not `[]map[string]interface{}`)
- Converts SDK `workflow.Task` to `types.WorkflowTask` using `taskToMap()` helper
- Handles config, export, and flow control fields
- Verified with example 09 - compiles and runs successfully

## Task 5: Implement Smart Type Conversion (CONDITIONAL)

**Status**: ⏸️ TODO (PENDING TASK 3 DECISION)
**Created**: 2026-01-24 07:45
**Conditional**: Only if Task 3 = GO

### Objective
Enable Args fields to accept both strings and TaskFieldRef without manual .Expression() calls

### Subtasks
- [ ] Update identified fields from `string` to `interface{}`
- [ ] Implement smart conversion in ToProto() methods
- [ ] Add type checking: string, TaskFieldRef, Expression interface
- [ ] Update code generator (if using code gen approach)
- [ ] OR add proto annotations (if using proto approach)
- [ ] Add validation and helpful error messages

### Implementation Pattern
```go
func (c *ForTaskConfig) ToProto() (*structpb.Struct, error) {
    data := make(map[string]interface{})
    
    // Smart conversion
    if c.In != nil {
        switch v := c.In.(type) {
        case string:
            data["in"] = v
        case TaskFieldRef:
            data["in"] = v.Expression()
        case interface{ Expression() string }:
            data["in"] = v.Expression()
        default:
            return nil, fmt.Errorf("In must be string or TaskFieldRef")
        }
    }
    
    return structpb.NewStruct(data)
}
```

### Notes
- **SKIP this task if Task 3 = NO-GO**
- Test thoroughly - type conversion is easy to get wrong
- Ensure backward compatibility with existing code

## Task 6: Update ForEach example (09)

**Status**: ✅ DONE
**Created**: 2026-01-24 07:32
**Completed**: 2026-01-24 08:10

### Objective
Migrate example 09 to use new LoopBody pattern (and smart conversion if implemented)

### Subtasks
- [x] Replace raw map[string]interface{} with typed tasks
- [x] Use LoopBody helper for type-safe item references
- [ ] Remove .Expression() calls if smart conversion implemented (pending Task 5)
- [x] Fix incorrect .Field("results") and .Field("count") references
- [x] Use loopTask directly (not loopTask.Field(...))
- [x] Add comments explaining the pattern

### Notes
- Example currently has two bugs: magic strings + wrong field references
- Should demonstrate best practices after fixes

### Changes Made
- Replaced raw `[]map[string]interface{}` with `workflow.LoopBody(func(item LoopVar))`
- Fixed HttpPost call signature (added nil headers parameter)
- Removed incorrect `.Field("results")` and `.Field("count")` references
- Used explicit `DependsOn(loopTask)` for task dependency
- Example now compiles and runs successfully ✅

## Task 7: Add tests

**Status**: ⏸️ TODO
**Created**: 2026-01-24 07:32

### Objective
Test LoopBody with various scenarios (and smart conversion if implemented)

### Subtasks
- [ ] Test LoopBody with default "item" variable
- [ ] Test LoopBody with custom variable names (Each field)
- [ ] Test nested field access (item.Field("user").Field("id"))
- [ ] Test smart type conversion (if implemented)
- [ ] Test error cases (invalid types, nil values)
- [ ] Verify generated proto/YAML is correct

### Notes
- Focus on LoopBody core functionality
- Add smart conversion tests only if Task 5 executed

## Task 8: Update documentation

**Status**: ⏸️ TODO
**Created**: 2026-01-24 07:32

### Objective
Document the new patterns in USAGE.md and API_REFERENCE.md

### Subtasks
- [ ] Update USAGE.md with LoopBody examples
- [ ] Update API_REFERENCE.md with LoopBody signature
- [ ] Add migration guide if smart conversion implemented
- [ ] Document before/after for clarity
- [ ] Add troubleshooting section

### Notes
- Keep examples grounded in real code
- Show both simple and complex use cases


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

