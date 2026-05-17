# Workflow Task Name Proto Validation

**Date**: May 17, 2026

## Summary

Added a `buf.validate` string pattern constraint to `WorkflowTask.name` in the proto definition, establishing the proto as the single source of truth for task name format rules. Consolidated three duplicate inline regex validations in the React SDK into a shared constant, and extended YAML editor validation to also check task name format.

## Problem Statement

The `WorkflowTask.name` proto field only had `required = true`, while the React SDK independently hardcoded `^[a-zA-Z_][a-zA-Z0-9_]*$` in three separate components with inconsistent error messages.

### Pain Points

- Proto was not the source of truth for the naming rule — the constraint only existed in frontend code
- Three components duplicated the same regex with slightly different error strings ("alphanumeric/underscore only" vs "Alphanumeric and underscores only")
- The YAML editor's validation pipeline did not check task name format at all — only empty and duplicate names
- Any future change to the naming rule would require updating multiple files independently

## Solution

Made the proto authoritative by adding a `buf.validate` pattern constraint, then aligned the SDK by extracting a shared constant and adding format validation to the YAML editor.

## Implementation Details

- **Proto**: Changed `WorkflowTask.name` from `(buf.validate.field).required = true` to `(buf.validate.field).string = { min_len: 1, pattern: "^[a-zA-Z_][a-zA-Z0-9_]*$" }` — enforces C-style identifiers at the proto level
- **Shared constant**: Added `TASK_NAME_PATTERN` and `TASK_NAME_PATTERN_ERROR` to `canvas-constants.ts`, with a doc comment linking back to the proto constraint
- **Inspector panel, approval builder, branch builder**: Replaced inline regex and error strings with imports from the shared constant
- **YAML validation**: Added a `TASK_NAME_PATTERN` check in `validateTasks()` so the code editor surfaces invalid task names with source-mapped diagnostics

## Benefits

- Proto is now the authoritative source for the task name format rule
- Backend validators (Go, Java) will enforce the same pattern once stubs are regenerated
- Single constant to update if the naming rule evolves
- Consistent error message across visual editor, approval forms, branch conditions, and YAML editor
- YAML editor now catches invalid task names that previously slipped through to runtime

## Impact

- **SDK consumers**: No API changes — validation behavior is the same, just consolidated
- **Backend**: After stub regeneration, `buf.validate` will enforce the pattern server-side
- **Workflow authors**: YAML editor now flags invalid task names inline instead of at save/deploy time

## Related Work

- Workflow visual canvas editor (T15 batches)
- Workflow YAML editor with graph preview (T10)

---

**Status**: ✅ Production Ready (proto stubs need regeneration via `buf generate`)
