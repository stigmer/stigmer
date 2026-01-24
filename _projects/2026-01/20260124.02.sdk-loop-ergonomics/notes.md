# Notes: 20260124.02.sdk-loop-ergonomics

**Created**: 2026-01-24

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-01-24 07:32 - Project Created

Project started. Initial scope: LoopBody helper for type-safe loop variable references.

## 2026-01-24 07:45 - Scope Expanded: Expression Field Investigation

**Context**: User questioned why `.Expression()` must be called manually on TaskFieldRef.

**Problem Identified**:
```go
// Current (verbose):
In: fetchTask.Field("items").Expression(),  // ❌ Manual conversion required

// Desired (clean):
In: fetchTask.Field("items"),  // ✅ SDK should figure it out!
```

**Root Cause**:
- Args fields are strongly typed as `string`
- Go won't auto-convert `TaskFieldRef` to `string`
- Users forced to call `.Expression()` manually

**Potential Solution**: Smart type conversion via `interface{}`
```go
type ForTaskConfig struct {
    In interface{} `json:"in,omitempty"`  // Accept string OR TaskFieldRef
}

func (c *ForTaskConfig) ToProto() (*structpb.Struct, error) {
    // Check type and convert automatically
    switch v := c.In.(type) {
    case string: /* use directly */
    case TaskFieldRef: /* call .Expression() */
    }
}
```

**Decision**: Don't jump to implementation - **analyze first**

**Key Questions**:
1. How many fields accept expressions across all task types?
2. Proto annotation approach vs code generation patterns?
3. Is this maintainable at scale (10+ task types, 100+ fields)?
4. What's the long-term architectural impact?

**Expanded Project Scope**:
- Phase 1: Analysis & Investigation (NEW)
- Phase 2: Implementation (depends on Phase 1 findings)

## 2026-01-24 07:45 - Proto Annotation Discussion

**User Suggestion**: Add proto annotations to mark expression fields

**Approach**:
```protobuf
message ForTaskConfig {
  string in = 1 [(expression_field) = true];  // Custom annotation
  repeated WorkflowTask do = 2;
}
```

**Benefits**:
- Explicit declaration in proto
- Single source of truth
- Self-documenting
- Code generator can detect and handle automatically

**Challenges**:
- Requires proto custom options setup
- Need to ensure buf/protoc tooling supports it
- May add complexity to proto validation

**Alternative**: Code generation pattern matching
- Detect field names like "uri", "in", "when", "body", "headers"
- Auto-generate as `interface{}` with smart conversion
- No proto changes needed
- More implicit (could miss edge cases)

**Action**: Both approaches should be prototyped and compared

## 2026-01-24 07:45 - Analysis Requirements

**Report Should Include**:

1. **Field Count**:
   - Total expression fields across all task types
   - Breakdown by task type (HttpCallArgs, ForArgs, SwitchArgs, etc.)
   - Field type distribution (string, map, slice)

2. **Pattern Analysis**:
   - Common field names that accept expressions
   - Edge cases (nested expressions, optional fields)
   - Proto definitions review

3. **Complexity Assessment**:
   - How many files would need updates?
   - Impact on code generator
   - Backward compatibility concerns
   - Testing surface area

4. **Maintainability**:
   - Will this scale to 20+ task types?
   - Clear pattern for future additions?
   - Documentation requirements

**Decision Framework**:
- **< 50 fields**: Highly feasible, proceed with confidence
- **50-75 fields**: Feasible, need clear patterns
- **75-100 fields**: Challenging, need strong justification
- **> 100 fields**: Reconsider approach

## Design Considerations

### LoopBody Helper (Core Feature)
**Priority**: HIGH - Always implement
**Complexity**: LOW
**Impact**: Eliminates magic strings in loop bodies
**Risk**: LOW - Additive, doesn't break existing code

### Smart Expression Conversion (Investigation)
**Priority**: MEDIUM - Depends on analysis
**Complexity**: MEDIUM-HIGH
**Impact**: Eliminates .Expression() calls across SDK
**Risk**: MEDIUM - Changes type signatures, needs thorough testing

**Key Risk**: Type safety trade-off
- `interface{}` loses compile-time checking
- Need excellent error messages at runtime
- Could confuse users if not well-documented

**Mitigation**:
- Add helper interfaces (Expression interface)
- Clear validation in ToProto()
- Comprehensive tests
- Migration guide if implemented

## Success Metrics

**Phase 1 Complete When**:
- [ ] Analysis report generated
- [ ] Proto vs code gen decision made
- [ ] Go/No-Go decision documented with rationale

**Phase 2 Complete When** (if GO):
- [ ] LoopBody helper working
- [ ] Smart conversion working (if approved)
- [ ] Example 09 updated
- [ ] Tests passing
- [ ] Docs updated

**Project Complete When**:
- [ ] All tasks done
- [ ] Code reviewed
- [ ] No regressions in existing examples
- [ ] Developer experience measurably improved

---

## Example Entry Format

```
## YYYY-MM-DD HH:MM - Brief Title

Quick description of what happened or what you learned.

Code snippet or command if relevant:
<code here>

Why it matters: <brief explanation>
```

---

*Add your timestamped notes below as you work*

---

## 2026-01-24 08:15 - Task 1 Complete: Expression Fields Analysis

**Summary**: Comprehensive analysis of all expression-accepting fields across SDK completed.

**Key Findings**:
1. **Total scope**: ~20 expression fields across 13 task types
2. **Type changes needed**: Only 6 simple string fields
   - HttpCallTaskConfig.URI
   - ForTaskConfig.In
   - AgentCallTaskConfig.Message
   - RaiseTaskConfig.Error
   - RaiseTaskConfig.Message
   - ListenTaskConfig.Event

3. **No changes needed**: 14 fields already flexible (maps/interfaces)

**Proto Investigation**: 
- ❌ No proto files found for workflow tasks
- Must use code generation pattern matching approach
- Recommended pattern: Match field names (uri, url, in, message, error, event)

**Complexity Assessment**: MEDIUM (feasible)
- Only 6 files to update in `gen/` directory
- Clear field name patterns for generator
- Fully backward compatible (interface{} accepts both string and TaskFieldRef)

**Decision Criteria Met**:
- < 50 fields total ✅ (20 fields)
- Clear pattern exists ✅ (field name matching)
- Maintainable at scale ✅ (pattern-based)
- No breaking changes ✅ (backward compatible)

**Recommendation**: ✅ **PROCEED** with smart type conversion

**Deliverable**: Full report in `expression-fields-analysis.md`

---

## 2026-01-24 08:15 - Task 2 Complete: Code Generation Pattern Selected

**Decision**: Use code generation field name matching (NOT proto annotations)

**Rationale**:
- No proto files found for workflow tasks
- Code generation is custom (not proto-based)
- Field name patterns are clear and predictable

**Pattern Matching Approach**:
```go
expressionFieldPatterns = ["uri", "url", "in", "input", "message", "error", "event"]
```

**Why this works**:
- All 6 fields requiring changes match these patterns
- Easy to maintain and extend
- Works with existing tooling
- No build infrastructure changes needed

---

## 2026-01-24 08:20 - Task 3 Complete: GO Decision Made

**🎯 DECISION**: ✅ **GO - PROCEED WITH SMART TYPE CONVERSION**

**Confidence**: HIGH

**Key Factors**:
1. ✅ Manageable scope (20 fields, only 6 need changes)
2. ✅ Clear patterns (field name matching)
3. ✅ Zero breaking changes (backward compatible)
4. ✅ High UX value (eliminates `.Expression()` boilerplate)
5. ✅ Scales well (pattern handles future task types)

**Risk Level**: LOW
- Backward compatible (interface{} accepts both string and TaskFieldRef)
- Runtime type checking with clear errors
- Straightforward testing (~25-30 test cases)
- Small implementation surface (~8 files)

**Next Steps**: Proceed to Phase 2 implementation
- Task 4: LoopBody helper
- Task 5: Smart type conversion
- Task 6-8: Tests and docs

---

## 2026-01-24 08:10 - Task 4 & Task 6 Complete: LoopBody Helper Implemented

**Summary**: Successfully implemented LoopBody helper and updated example 09.

**Key Implementation Details**:

1. **Return Type**: `[]*types.WorkflowTask` (NOT `[]map[string]interface{}`)
   - The `ForTaskConfig.Do` field was updated to use `[]*types.WorkflowTask`
   - Two versions of ForTaskConfig exist:
     - `gen/fortaskconfig.go` (older, uses `[]map[string]interface{}`)
     - `fortaskconfig_task.go` (newer, uses `[]*types.WorkflowTask`) ✅ THIS ONE IS USED

2. **Conversion Logic**:
   ```go
   func LoopBody(fn func(LoopVar) []*Task) []*types.WorkflowTask {
       // 1. Create LoopVar with default "item" name
       // 2. Call user function to get SDK tasks
       // 3. Convert each workflow.Task to types.WorkflowTask
       //    - Use taskToMap() to get map representation
       //    - Extract fields: name, kind, config, export, flow
   }
   ```

3. **Example 09 Updates**:
   - Before: Raw `[]map[string]interface{}` with magic strings
   - After: Typed `workflow.LoopBody(func(item LoopVar) []*Task)`
   - Fixed HttpPost signature (added nil headers parameter)
   - Removed incorrect `.Field("results")` and `.Field("count")` references

**Gotchas Discovered**:

1. **HttpPost Signature**: 
   - Takes 4 parameters: `(name, uri, headers, body)`
   - Headers cannot be omitted - use `nil` if no headers needed

2. **Loop Task Output**: 
   - FOR tasks don't have fields like "results" or "count"
   - Use explicit `DependsOn()` for ordering if needed

**Testing**: ✅ Example 09 compiles and runs successfully

**Next Steps**: Task 5 (smart type conversion for expression fields)

---

