# Fix: Workflow Execution Default Instance Recovery

**Date**: 2026-01-20 20:24:47  
**Type**: Bug Fix  
**Scope**: Backend / Workflow Execution  
**Impact**: Critical resilience improvement for workflow execution creation

---

## Problem

Workflow execution creation was failing with a duplicate error when the default workflow instance existed in the database but the workflow's `status.default_instance_id` field was not set.

**Error encountered**:
```
failed to create default workflow instance: rpc error: code = Unknown desc = 
pipeline step CheckDuplicate failed: WorkflowInstance with slug 'review-demo-pr-default' 
already exists (id: win-1768918212607329000)
```

**Root cause**:
1. When a workflow is created, it creates a default instance and updates `workflow.status.default_instance_id`
2. If the status update fails (step 7 in workflow creation pipeline), you end up with an orphaned instance
3. Next workflow execution attempt tries to create the default instance again
4. This fails with duplicate error because an instance with that slug already exists

**Why this happened**:
The `createDefaultInstanceIfNeededStep` only checked if `workflow.status.default_instance_id` was set, but didn't handle the case where the instance exists but the status field wasn't updated.

---

## Solution

Enhanced the `createDefaultInstanceIfNeededStep` in workflow execution creation to be **resilient** by:

### 1. Added Instance Lookup by Slug

Before creating a new default instance, the step now:
1. Checks if `workflow.status.default_instance_id` is set → use it
2. **If not set**, looks up whether an instance with slug `{workflow-slug}-default` exists
3. If found, updates workflow status with the existing instance ID and uses it
4. Only creates a new instance if one truly doesn't exist

### 2. New Helper Method

Added `findInstanceBySlug()` method:
- Searches through all workflow instances to find one matching the slug
- Returns the instance if found, nil if not found
- Handles unmarshal errors gracefully

### 3. Recovery Logic

If an existing instance is found:
```go
// Update workflow status with found instance ID
if workflow.Status == nil {
    workflow.Status = &workflowv1.WorkflowStatus{}
}
workflow.Status.DefaultInstanceId = existingInstanceID

// Save workflow with updated status
if err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, workflowID, workflow); err != nil {
    return fmt.Errorf("failed to update workflow with existing default instance: %w", err)
}

// Update execution with resolved instance ID
execution.Spec.WorkflowInstanceId = existingInstanceID
```

---

## Changes

### Modified Files

**`backend/services/stigmer-server/pkg/domain/workflowexecution/controller/create.go`**

#### Updated `createDefaultInstanceIfNeededStep.Execute()` (lines 156-341)

**Step 1-2**: Load workflow and check if `default_instance_id` is set (existing logic)

**Step 3** (NEW): If not set, look up if instance exists by slug
```go
// 3. Default instance ID not set - check if instance exists by slug
workflowSlug := workflow.GetMetadata().GetName()
defaultInstanceSlug := workflowSlug + "-default"

existingInstance, err := s.findInstanceBySlug(ctx.Context(), defaultInstanceSlug)
```

**Step 4** (NEW): If found, update workflow status and use it
```go
// 4. If instance exists, update workflow status and use it
if existingInstance != nil {
    existingInstanceID := existingInstance.GetMetadata().GetId()
    // Update workflow status
    workflow.Status.DefaultInstanceId = existingInstanceID
    // Save workflow
    s.store.SaveResource(...)
    // Update execution
    execution.Spec.WorkflowInstanceId = existingInstanceID
    return nil
}
```

**Step 5-8**: If not found, create new instance (existing logic, renumbered)

#### Added `findInstanceBySlug()` helper (lines 343-369)

```go
func (s *createDefaultInstanceIfNeededStep) findInstanceBySlug(ctx context.Context, slug string) (*workflowinstancev1.WorkflowInstance, error) {
    // List all workflow instances
    instances, err := s.store.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow_instance)
    
    // Search for matching slug
    for _, data := range instances {
        instance := &workflowinstancev1.WorkflowInstance{}
        if err := instance.Unmarshal(data); err != nil {
            continue // Skip unmarshal errors
        }
        
        if instance.GetMetadata() != nil && instance.GetMetadata().GetSlug() == slug {
            return instance, nil
        }
    }
    
    return nil, nil
}
```

#### Updated Documentation Comment (lines 122-136)

Added comprehensive documentation explaining:
- The 7-step process including lookup and recovery
- Why this resilient approach is needed
- Edge case handling

---

## Testing

### Test Scenario 1: Normal Case (Instance Doesn't Exist)
```bash
stigmer apply        # Creates workflow, creates default instance, updates status
stigmer run workflow # Uses existing instance from status ✅
```

### Test Scenario 2: Recovery Case (Instance Exists, Status Not Set)
```bash
# Simulate: Instance exists but workflow status not updated
stigmer run workflow # Now finds existing instance by slug, updates status, proceeds ✅
```

### Test Scenario 3: User-Provided Instance
```bash
stigmer run workflow --instance custom-instance # Uses provided instance, skips default logic ✅
```

---

## Impact

### Before Fix
- ❌ Workflow execution creation fails if instance exists but status not set
- ❌ User must manually delete BadgerDB data to recover
- ❌ Poor developer experience during development iterations

### After Fix
- ✅ Workflow execution creation succeeds even if status not set
- ✅ Automatically recovers by finding and linking existing instance
- ✅ Resilient to partial failures in workflow creation pipeline
- ✅ Better developer experience (self-healing)

---

## Technical Details

### Pipeline Step Execution Order

The workflow execution creation pipeline:
1. `ValidateProtoStep` - Validate field constraints
2. `ResolveSlugStep` - Generate slug from metadata.name
3. `ValidateWorkflowOrInstanceStep` - Ensure workflow_id OR workflow_instance_id provided
4. **`CreateDefaultInstanceIfNeededStep`** ← Enhanced with recovery logic
5. `CheckDuplicateStep` - Verify no duplicate execution
6. `BuildNewStateStep` - Generate ID, set audit fields
7. `SetInitialPhaseStep` - Set phase to PENDING
8. `PersistStep` - Save execution to repository

### Database Operations

**New query added**:
- `ListResources(workflow_instance)` - Lists all workflow instances
- Iterates to find matching slug
- O(n) operation but acceptable (typically < 100 instances per workflow)

**Considerations**:
- Could be optimized with slug-based index in future
- Currently sufficient for OSS local backend use case
- Cloud backend would need optimization for scale

### Error Handling

All new operations include:
- Error wrapping with context: `fmt.Errorf("failed to look up existing default instance: %w", err)`
- Graceful handling of unmarshal errors during search
- Debug/info logging at key decision points

---

## Logging

Added comprehensive logging:

**Debug logs**:
- "Default instance ID not set in workflow status, checking if instance exists by slug"
- "Updated workflow status with existing default_instance_id"

**Info logs**:
- "Found existing default instance, updating workflow status"
- "Successfully resolved existing default instance"
- "Default instance not found, creating new one"

---

## Future Improvements

Potential enhancements:
1. Add slug-based index to BadgerDB store for O(1) lookups
2. Consider adding retry logic to workflow status updates
3. Monitor frequency of recovery path usage to identify if workflow creation needs hardening
4. Add metrics for instance recovery vs. creation paths

---

## Pattern: Resilient Resource Creation

This fix introduces a **resilient resource creation** pattern:

**Problem**: Parent resource (workflow) has reference to child resource (default instance) in status, but status update can fail after child creation.

**Solution**: When needing the child:
1. Check if parent has reference → use it
2. If not, look up child by predictable name/slug
3. If found, update parent reference and use it (recovery)
4. If not found, create child (normal path)

**Applicability**: This pattern can be applied to other parent-child relationships where:
- Child resource has predictable naming (e.g., `{parent-slug}-default`)
- Parent stores child ID in status field
- Status updates can fail independently of child creation

**Examples**:
- Workflow → Default WorkflowInstance (implemented)
- Agent → Default AgentSession (potential future application)
- Resource → Default Configuration (potential future application)

---

## Related Code

**Workflow creation** (`backend/services/stigmer-server/pkg/domain/workflow/controller/create.go`):
- Creates default instance in step 6
- Updates workflow status in step 7 ← Failure here causes the issue we fixed

**WorkflowInstance duplicate check** (`backend/libs/go/grpc/request/pipeline/steps/duplicate.go`):
- Uses `findBySlug()` to detect duplicates
- This is what was catching our duplicate creation attempt

---

## Commit

```bash
git add backend/services/stigmer-server/pkg/domain/workflowexecution/controller/create.go
git commit -m "fix(backend/workflow-execution): add resilient default instance recovery

- Look up existing instance by slug before creating duplicate
- Update workflow status if instance found but status not set
- Add findInstanceBySlug() helper method
- Handles edge case where instance creation succeeded but status update failed
- Prevents duplicate instance errors during workflow execution creation
- Improves developer experience with self-healing behavior"
```

---

**Tags**: #bug-fix #workflow-execution #resilience #self-healing #backend #pipeline #stigmer-oss
