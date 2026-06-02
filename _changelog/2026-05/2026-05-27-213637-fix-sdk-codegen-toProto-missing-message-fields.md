# Fix SDK Codegen: toProto() Drops Message and Array-of-Message Fields

**Date**: May 27, 2026

## Summary

Fixed a bug in the SDK code generator (`tools/codegen/generator/sdk_client.go`) where the `emitNestedToProto` function silently skipped non-ApiResourceReference message fields and array-of-message fields when generating `toProto()` methods. This caused all workflow `export` and `flow` fields to be dropped during CLI apply, breaking inter-task `$context` propagation for every workflow in the platform.

## Problem Statement

All workflows using `export: as:` for inter-task data flow via `$context` were broken. The `$context` variable was never populated, causing all downstream expression interpolations (`${ $context.task_name.field }`) to produce empty strings.

### Pain Points

- Agent execution messages in MongoDB contained empty interpolated values (e.g., `"Campaigns from strategist: "`, `"DAU: "`)
- The stored CNCF YAML had zero occurrences of "export" — all export clauses were silently dropped
- Downstream LLM tasks received prompts with empty field values, causing incorrect assessments
- The daily-notification-plan workflow's quality gate always failed because it received no data to evaluate

## Solution

Fixed the code generator's `emitNestedToProto` function to handle all field types correctly in generated `toProto()` methods:

1. Expanded `needsImperative` detection to trigger for any message field (not just `ApiResourceReference`) and array-of-message fields
2. Added generic message field handling: emits nil-guarded `toProto()` calls for non-ApiResourceReference message fields
3. Replaced the `continue` for array-of-message fields with a proper for-range loop
4. Added oneof field skip to prevent generating code for proto oneof fields (which use different access patterns)

## Implementation Details

**File:** `tools/codegen/generator/sdk_client.go` — function `emitNestedToProto`

The generator has two code paths for `toProto()` body generation:

- **Imperative path** (used when type has struct/timestamp/message fields): Builds the proto field-by-field with `p.Field = value`
- **Declarative path** (used for simple types): Uses struct literal `return &Type{Field: value}`

Both paths had the same gap:

| Field kind | Before (broken) | After (fixed) |
|---|---|---|
| Message (non-ApiResourceReference) | Silently skipped | `if i.Field != nil { p.Field = i.Field.toProto() }` |
| Array of message | `continue` (skipped) | `for _, item := range i.Field { p.Field = append(...) }` |
| Message (oneof group) | Not applicable | `continue` (correctly skipped — different access pattern) |

**Effect on generated code** — `sdk/go/internal/gen/workflow.go:197`:

Before:
```go
func (i *WorkflowTaskInput) toProto() *workflowv1.WorkflowTask {
    p := &workflowv1.WorkflowTask{}
    p.Name = i.Name
    p.Kind = i.Kind
    if i.TaskConfig != nil {
        p.TaskConfig, _ = structpb.NewStruct(i.TaskConfig)
    }
    return p  // Export, Flow, Compensate never set!
}
```

After:
```go
func (i *WorkflowTaskInput) toProto() *workflowv1.WorkflowTask {
    p := &workflowv1.WorkflowTask{}
    p.Name = i.Name
    p.Kind = i.Kind
    if i.TaskConfig != nil {
        p.TaskConfig, _ = structpb.NewStruct(i.TaskConfig)
    }
    if i.Export != nil {
        p.Export = i.Export.toProto()
    }
    if i.Flow != nil {
        p.Flow = i.Flow.toProto()
    }
    for _, item := range i.Compensate {
        p.Compensate = append(p.Compensate, item.toProto())
    }
    return p
}
```

## Benefits

- All workflows using `export:` and `flow:` now work correctly — inter-task `$context` propagation is restored
- The fix is generic — any SDK input type with message or array-of-message fields benefits (not just WorkflowTask)
- All 4 SDKs (Go, TypeScript, Python, Java) are regenerated from the same codegen, so the fix propagates everywhere
- Added comprehensive test (`message_and_array_fields_in_struct_type`) that mirrors the exact WorkflowTask schema

## Impact

- **All workflows** that use `export:` or `flow:` directives — this was a platform-wide break
- **All SDKs** — Go, TypeScript, Python, Java client code is regenerated
- **CLI apply** — the primary workflow submission path now correctly serializes export/flow to proto
- **Zero risk** — adds fields that were always intended to be present; the `fromProto` direction already handled them correctly (the round-trip was asymmetric)

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes investigation + fix)
