# Learning Summary: Task Export Context Fix

**Date:** 2026-01-21  
**Areas:** SDK (Go), Workflow Runner  
**Type:** Critical Bug Fix + Pattern Discovery

## For SDK Rule Improvement

### Learning 1: Bracket Notation for Task Field References

**Context:** Task names with hyphens (required by validation) broke jq expression parsing

**Problem:**
```go
// Generated dot notation
${ $context.fetch-pr.diff_url }
// jq interprets as: fetch minus pr()/0
// Error: function not defined: pr/0
```

**Solution:**
```go
// Use bracket notation for task names
func (r TaskFieldRef) Expression() string {
    return fmt.Sprintf("${ $context[\"%s\"].%s }", r.taskName, r.fieldName)
}
// Generated: ${ $context["fetch-pr"].diff_url }
```

**Pattern:**
- **Always use bracket notation for task names in expressions**
- Supports special characters (hyphens, mixed case)
- Standard JSON/jq syntax
- No user-facing naming restrictions

**When to apply:**
- Any task field reference generation
- When task names can contain special characters
- Following validation requirements (kebab-case)

**File:** `sdk/go/workflow/task.go:86-92`

### Learning 2: Validation Requires Kebab-Case

**Discovery:** Task name validation enforces kebab-case (lowercase with hyphens)

```
Error: "name must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric"
```

**Implication:**
- Underscores are NOT allowed
- camelCase is NOT allowed
- Only kebab-case: `fetch-pr`, `analyze-code`

**SDK Impact:**
- Must support hyphens in expressions (bracket notation required)
- Cannot use underscore workaround
- Must align with validation rules

---

## For Workflow Runner Rule Improvement

### Learning 3: Context Export Merging Pattern

**Context:** Multi-task workflows were broken - task exports overwrote entire context

**Problem:**
```go
// OLD: Replaced entire context
func (t *DoTaskBuilder) processTaskExport(...) error {
    state.Context = export  // ❌ Overwrites previous tasks
    return nil
}

// After task "fetch-pr" exports:
context = { "diff_url": "...", "title": "..." }  // No task-name key!

// After task "fetch-diff" exports:
context = { "body": "...", "status": 200 }  // Lost fetch-pr data!

// Expression fails:
$context["fetch-pr"]  // nil - key doesn't exist
```

**Solution:**
```go
// NEW: Merge into context under task name
func (t *DoTaskBuilder) processTaskExport(...) error {
    if state.Context == nil {
        state.Context = make(map[string]any)
    }
    
    contextMap, ok := state.Context.(map[string]any)
    if !ok {
        // Backward compatibility
        contextMap = map[string]any{
            "__previous_context": state.Context,
        }
    }
    
    contextMap[task.Name] = export  // ✅ Stores under task name
    state.Context = contextMap
    
    return nil
}

// After task "fetch-pr" exports:
context = {
  "fetch-pr": { "diff_url": "...", "title": "..." }
}

// After task "fetch-diff" exports:
context = {
  "fetch-pr": { ... },  // Preserved!
  "fetch-diff": { "body": "...", "status": 200 }
}

// Expression works:
$context["fetch-pr"]  // Returns task output
```

**Pattern:**
- **Export merges into context, never replaces**
- Each task's output stored under its name
- Context accumulates all task results
- Later tasks can reference earlier tasks

**When to apply:**
- Any task export processing
- Multi-task workflows
- Workflow state management

**File:** `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_do.go:402-422`

### Learning 4: Context vs Data Distinction

**Discovery:** `$context` and `$data` serve different purposes

**Understanding:**
```go
type State struct {
    Context any            `json:"context"`  // Exported task outputs
    Data    map[string]any `json:"data"`     // Internal task results
}

func (s *State) GetAsMap() map[string]any {
    return map[string]any{
        "$context": s.Context,  // User-facing (exported outputs)
        "$data":    s.Data,     // Internal (all task results)
    }
}
```

**Usage:**
- **`$context`**: For task outputs exported with `export.as`
- **`$data`**: For internal state, temporary values

**Expression patterns:**
```yaml
# Reference exported output
uri: ${ $context["task-name"].field }

# Reference internal data
debug: ${ $data["task-name"].field }
```

**Implications:**
- Export determines what goes in `$context`
- Task results always go in `$data`
- Multi-task workflows rely on `$context` merging correctly

---

## Testing Verification

### SDK Tests
```bash
cd sdk/go/workflow
go test -v
# All tests pass ✅
```

**New tests:**
- `TestBracketNotation_WithHyphens` - Hyphenated task names
- `TestBracketNotation_WithSpecialCharacters` - Various characters
- Updated existing tests for bracket notation

### Integration Tests
- Demo workflow (`stigmer-project/main.go`) synthesis successful
- Context structure verified
- Bracket notation generation confirmed

---

## Documentation Created

**For SDK:**
- `sdk/go/workflow/BRACKET_NOTATION.md` - Complete guide
- `sdk/go/workflow/CHANGELOG_BRACKET_NOTATION.md` - Detailed changelog

**For Backend:**
- `backend/services/workflow-runner/BUG_TASK_EXPORT_CONTEXT.md` - Root cause analysis

**General:**
- `FIX_SUMMARY.md` - Executive summary
- `_changelog/2026-01/2026-01-21-042813-fix-task-export-context-bracket-notation.md` - Complete changelog

---

## Recommendations for Rule Updates

### SDK Rule (`improve-go-sdk-rule.mdc`)

**Add to Learning Log:**
1. **Bracket Notation Pattern**: Always use bracket notation for task names in expressions
2. **Validation Alignment**: SDK must support kebab-case (hyphens required)

**Add to Documentation:**
- Create topic doc: `docs/patterns/task-field-references.md`
- Explain bracket notation rationale
- Show examples with special characters
- Reference validation requirements

**Update Main Rule:**
- Add reference to bracket notation pattern
- Note validation requirements for task names
- Link to BRACKET_NOTATION.md

### Workflow Runner Rule (`improve-this-rule.mdc`)

**Add to Learning Log:**
1. **Context Merging Pattern**: Export must merge, never replace
2. **Context vs Data**: Understanding the distinction and usage

**Add to Documentation:**
- Create topic doc: `docs/patterns/workflow-context-management.md`
- Explain context merging pattern
- Show multi-task workflow examples
- Clarify context vs data usage

**Update Main Rule:**
- Add reference to context merging pattern
- Note importance of accumulating task results
- Link to BUG_TASK_EXPORT_CONTEXT.md

---

## Impact Summary

**Critical Fix:**
- Enables multi-task workflows with hyphenated names (required by validation)
- Unblocks core workflow functionality
- Resolves user-reported failures

**Pattern Discovery:**
- Bracket notation for special characters
- Context merging for workflow composition
- Clear separation of $context and $data

**Documentation:**
- Comprehensive inline documentation
- Testing verification
- Future maintainability

---

**Next Steps:**
1. Incorporate learnings into respective rules
2. Update rule documentation with patterns
3. Consider adding to onboarding materials
4. Share patterns with team
