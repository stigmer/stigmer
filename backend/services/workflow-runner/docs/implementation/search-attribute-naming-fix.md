# Search Attribute Naming Fix

**Date**: 2026-01-16  
**Impact**: Semantic naming improvement - no breaking changes

## Problem

The search attribute was named `CustomStringField` which is:
- ❌ Generic and meaningless  
- ❌ Doesn't convey what it stores
- ❌ Like naming a variable `myString` instead of `userId`
- ❌ Makes code harder to understand

## Solution

Renamed to `WorkflowExecutionID` which:
- ✅ Clearly indicates it stores execution IDs
- ✅ Self-documenting
- ✅ Matches naming conventions (descriptive, not generic)
- ✅ Follows the pattern of naming variables after what they store

## Changes Made

### Code Files
```
pkg/temporal/searchattributes/setup.go
  - RequiredSearchAttributes: "CustomStringField" → "WorkflowExecutionID"

pkg/executor/temporal_workflow.go  
  - UpsertSearchAttributes: "CustomStringField" → "WorkflowExecutionID"

pkg/interceptors/progress_interceptor.go
  - IndexedFields lookup: "CustomStringField" → "WorkflowExecutionID"
```

### Scripts
```
scripts/setup-temporal-search-attributes.sh
  - REQUIRED_ATTRS: "CustomStringField" → "WorkflowExecutionID"

scripts/test-search-attr-setup.sh
  - grep pattern: "CustomStringField" → "WorkflowExecutionID"
```

### Documentation
```
IMPLEMENTATION_STATUS.md
docs/implementation/execution-id-propagation.md
docs/implementation/execution-id-propagation-summary.md
docs/implementation/temporal-search-attribute-automation.md
_rules/implement-workflow-runner-features/implement-workflow-runner-features.mdc
_rules/implement-workflow-runner-features/docs/learning-log.md
_ops/setup-guides/06-temporal-search-attributes.md
```

## Migration

**Good news**: This change is NOT breaking!

**Why?**
- Search attributes don't exist yet (first deployment)
- Automatic setup creates `WorkflowExecutionID` from scratch
- No migration needed - clean slate

**If you already created `CustomStringField`** (unlikely):
```bash
# Option 1: Delete old, create new (production)
temporal operator search-attribute remove \
  --namespace default \
  --name CustomStringField

temporal operator search-attribute create \
  --namespace default \
  --name WorkflowExecutionID \
  --type Text

# Option 2: Just create the new one (both will exist harmlessly)
temporal operator search-attribute create \
  --namespace default \
  --name WorkflowExecutionID \
  --type Text
```

## Verification

```bash
# Verify no old references remain
grep -r "CustomStringField" backend/services/workflow-runner \
  --include="*.go" --include="*.md" --include="*.sh"
# Expected: No results

# Verify new attribute name is used
grep -r "WorkflowExecutionID.*search" backend/services/workflow-runner \
  --include="*.go"
# Expected: Multiple hits in setup.go, temporal_workflow.go, progress_interceptor.go
```

## Before & After

### Before (Generic)
```go
// Setup
RequiredSearchAttributes = []RequiredSearchAttribute{
    {Name: "CustomStringField", Type: TEXT},  // ❌ What does this store?
}

// Usage
workflow.UpsertSearchAttributes(ctx, map[string]interface{}{
    "CustomStringField": workflowExecutionID,  // ❌ Not obvious
})

// Extraction
if val, ok := indexedFields["CustomStringField"]; ok {  // ❌ Meaningless name
    ...
}
```

### After (Semantic)
```go
// Setup
RequiredSearchAttributes = []RequiredSearchAttribute{
    {Name: "WorkflowExecutionID", Type: TEXT},  // ✅ Clear purpose
}

// Usage
workflow.UpsertSearchAttributes(ctx, map[string]interface{}{
    "WorkflowExecutionID": workflowExecutionID,  // ✅ Self-documenting
})

// Extraction
if val, ok := indexedFields["WorkflowExecutionID"]; ok {  // ✅ Obvious
    ...
}
```

## Lesson Learned

**Always use semantic naming, even for infrastructure schema.**

Search attributes are part of the system's schema and should be named with the same care as database columns or API fields.

**Bad naming patterns**:
- `CustomStringField`, `CustomField1`, `Field1` (generic)
- `MyField`, `TempField`, `DataField` (vague)
- `Str1`, `Val2` (abbreviated and numbered)

**Good naming patterns**:
- `WorkflowExecutionID` (describes what it stores)
- `UserEmail`, `OrderStatus` (clear domain concepts)
- `CreatedTimestamp`, `LastModifiedBy` (specific metadata)

---

*"Good code is its own best documentation." - Steve McConnell*
