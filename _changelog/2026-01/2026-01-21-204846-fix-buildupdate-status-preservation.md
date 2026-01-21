# Fix: BuildUpdateState Clears Agent Status Breaking Default Instance Persistence

**Date**: 2026-01-21  
**Category**: Bug Fix (Critical)  
**Scope**: Pipeline Framework, Agent Creation, Agent Execution  
**Impact**: Critical (was blocking all agent executions after first run)

## Problem

Agent execution creation failed on second and subsequent runs with:

```
✗ Failed to create execution: rpc error: code = Unknown desc = 
pipeline step CreateDefaultInstanceIfNeeded failed: failed to create default instance: 
rpc error: code = Unknown desc = pipeline step CheckDuplicate failed: 
AgentInstance with slug 'pr-reviewer-default' already exists (id: ain-1768940931959458000)
```

**Symptoms**:
- First `stigmer run`: Works perfectly ✅
- Second `stigmer run`: Fails with duplicate instance error ❌
- Instance exists in database but agent.status.default_instance_id is empty
- CreateDefaultInstanceIfNeeded always tries to create instance (thinks it doesn't exist)

## Root Cause Discovery Process

### Initial Hypotheses (Wrong)

**Hypothesis 1**: Slug vs Name field mismatch
- Thought: Go uses `GetSlug()` but Java uses `GetName()`
- Result: Changed Go to match Java
- Outcome: Still failed ❌

**Hypothesis 2**: Need duplicate error handling
- Thought: Should catch "already exists" and fetch existing instance
- Result: Added complex duplicate handling logic
- Outcome: Made it worse - couldn't find instance ❌

**Hypothesis 3**: Missing duplicate handling in Java
- Thought: Maybe Java has this logic elsewhere
- Discovery: **Java has NO duplicate handling at all**
- Result: Removed all duplicate handling from Go
- Outcome: Still failed ❌

### The Real Root Cause (Found!)

Comparing Java and Go update flows revealed the bug:

**Java Update Flow (Working)**:
```java
// UpdateOperationSetAuditStepV2.java - Line 56-63
Message existingResource = context.getExistingResource();
if (existingResource != null) {
    // Preserve ENTIRE status from existing resource
    newState = ApiResourcePreviousStatusReplacer.replace(newState, existingResourceTyped);
}
// THEN update only audit fields within preserved status
```

**Go Update Flow (Before Fix - Broken)**:
```go
// build_update_state.go - Line 71-76
// Clear status field (status is system-managed)
if hasStatusField(merged) {
    clearStatusFieldReflect(merged)  // ❌ CLEARS EVERYTHING!
}
// No restoration - status lost forever!
```

**The Bug**: `BuildUpdateStateStep` in Go was **clearing the entire status field** and never restoring it.

## What Happens During Update

### First Run - Create Flow

```
1. User runs: stigmer run (agent doesn't exist)
2. Apply → detects doesn't exist → delegates to Create
3. Create pipeline:
   - Creates agent ✅
   - Creates default instance ✅
   - Updates agent.status.default_instance_id = "ain-xxx" ✅
   - Persists agent with status ✅
```

**Database After First Run**:
```
agent/agt-xxx:
  metadata: {...}
  spec: {...}
  status:
    default_instance_id: "ain-xxx"  ✅
```

### Second Run - Update Flow (Bug Manifests)

```
1. User runs: stigmer run (agent already exists)
2. Apply → detects exists → delegates to Update
3. Update pipeline:
   - Loads existing agent (has default_instance_id) ✅
   - Merges spec from input
   - BuildUpdateState step:
     * Clears status field ❌
     * Updates audit fields
     * NO restoration of status ❌
   - Persists agent WITHOUT status fields ❌
```

**Database After Second Run** (Bug):
```
agent/agt-xxx:
  metadata: {...}
  spec: {...}
  status:
    audit: {...}  # Only audit preserved
    # default_instance_id: LOST! ❌
```

### Execution Creation (Fails)

```
1. User selects agent to run
2. CreateDefaultInstanceIfNeeded step:
   - Loads agent
   - Checks agent.status.default_instance_id
   - Field is empty! ❌ (was cleared by Update)
   - Tries to create default instance
   - Gets "already exists" error (instance still in DB from first run)
   - FAILURE ❌
```

## Solution

Modified `BuildUpdateStateStep` to match Java implementation exactly:

### Before Fix (Broken)

```go
// Clear status - loses ALL system state
if hasStatusField(merged) {
    clearStatusFieldReflect(merged)
}

// Update audit (but status is gone!)
updateAuditFieldsReflect(merged, existing)
```

**Problem**: Clears status, only restores audit. Loses:
- `default_instance_id` (agent)
- `phase` (executions)  
- `conditions` (resources)
- All other system-managed state

### After Fix (Working - Matches Java)

```go
// Clear status from INPUT (ignore client-provided status)
if hasStatusField(merged) {
    clearStatusFieldReflect(merged)
}

// Preserve ENTIRE status from existing resource
if err := copyStatusFromExisting(merged, existing); err != nil {
    return fmt.Errorf("failed to copy status from existing: %w", err)
}

// Update ONLY audit fields within preserved status
if hasStatusField(merged) {
    updateAuditFieldsReflect(merged, existing)
}
```

**Result**: Preserves ALL system state, updates only audit.

## Implementation

### Core Fix: `build_update_state.go`

Added `copyStatusFromExisting()` function:

```go
// copyStatusFromExisting copies the entire status field from existing to merged resource
// This matches Java's ApiResourcePreviousStatusReplacer.replace() behavior.
func copyStatusFromExisting[T proto.Message](merged, existing T) error {
    // Get status field from existing resource
    existingMsg := existing.ProtoReflect()
    existingStatusField := existingMsg.Descriptor().Fields().ByName("status")
    
    if existingStatusField == nil || !existingMsg.Has(existingStatusField) {
        return nil // No status to copy
    }
    
    // Get the status value from existing
    existingStatus := existingMsg.Get(existingStatusField)
    
    // Copy entire status field to merged
    mergedMsg := merged.ProtoReflect()
    mergedStatusField := mergedMsg.Descriptor().Fields().ByName("status")
    mergedMsg.Set(mergedStatusField, existingStatus)
    
    return nil
}
```

**Key insight**: Uses proto reflection to copy the **entire status field** as a single unit, matching Java's `builder.setField(statusFieldDescriptor, previousStatus)`.

### Secondary Fix: `create.go` (AgentExecution)

Changed agent status update from gRPC Update to direct store save:

**Before**:
```go
// Goes through Update handler pipeline → triggers BuildUpdateState → clears status
_, err = s.agentClient.Update(ctx.Context(), agent)
```

**After**:
```go
// Direct repository save (matching Java: agentRepo.save(updatedAgent))
agentKind := apiresourcekind.ApiResourceKind_agent
err := s.store.SaveResource(ctx.Context(), agentKind, agentID, agent)
```

**Why**: Bypasses Update handler pipeline, preserves status exactly as set.

### Cleanup: Removed Buggy Duplicate Handling

Removed ~60 lines of complex duplicate handling logic from both files:
- `backend/services/stigmer-server/pkg/domain/agent/controller/create.go`
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go`

**Rationale**: 
- Java implementation has NO duplicate handling
- Go's duplicate handling was buggy and unnecessary
- Simple failures are better than complex fallbacks that fail mysteriously

## Testing

### Verification Process

**Before Fix**:
```bash
# First run
stigmer run
✓ Works

# Second run
stigmer run
✗ Fails: duplicate instance error

# Database inspection
go run tools/badger-inspect.go agent
# Shows: agent.status.default_instance_id is empty ❌
```

**After Fix**:
```bash
# First run
stigmer run
✓ Creates agent + instance

# Second run  
stigmer run
✓ Reuses existing agent + instance

# Third run
stigmer run
✓ Still works

# Database inspection
go run tools/badger-inspect.go agent
# Shows: agent.status.default_instance_id persists ✅
```

### Edge Cases Verified

| Scenario | Before Fix | After Fix |
|----------|------------|-----------|
| Create agent (first time) | ✅ Works | ✅ Works |
| Apply agent (updates) | ❌ Clears status | ✅ Preserves status |
| Create execution (after create) | ✅ Works | ✅ Works |
| Create execution (after update) | ❌ Fails | ✅ Works |
| Multiple updates | ❌ Status lost | ✅ Status preserved |

## Files Modified

### 1. `backend/libs/go/grpc/request/pipeline/steps/build_update_state.go`

**Changes**:
- Added `copyStatusFromExisting()` function (30 lines)
- Modified Execute() to preserve entire status before updating audit
- Updated comments to clarify status preservation logic

**Impact**: 
- Fixes ALL resources that use BuildUpdateState
- Agent, AgentInstance, Session, Workflow, etc.
- Preserves ALL system-managed status fields

### 2. `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go`

**Changes**:
- Changed agent status save from `agentClient.Update()` to `store.SaveResource()`
- Added store parameter to `createDefaultInstanceIfNeededStep`
- Removed ~50 lines of buggy duplicate handling logic
- Removed unused imports

**Impact**: 
- Agent status saved correctly during execution creation
- Simpler code (120 lines → 70 lines)

### 3. `backend/services/stigmer-server/pkg/domain/agent/controller/create.go`

**Changes**:
- Removed ~50 lines of buggy duplicate handling logic
- Simplified error handling (fail fast)
- Removed unused imports and helper functions

**Impact**:
- Cleaner code (200 lines → 150 lines)
- Matches Java simplicity

### 4. Created Debugging Tools

**`tools/badger-inspect.go`**: Inspect BadgerDB contents
- Usage: `go run tools/badger-inspect.go <agent|agent-instance|session|all>`
- Decodes proto messages to JSON
- Essential for database debugging

**`tools/decode-manifest.go`**: Decode proto manifest files
- Usage: `go run tools/decode-manifest.go <manifest-file>`
- Decodes .pb files to JSON

## Why This Fix Works

### Status as System State

The `status` field contains **ALL platform-managed state**:

**For Agent**:
- `default_instance_id` - Links to default instance
- `phase` - Lifecycle phase
- `conditions` - Health/readiness
- `audit` - Timestamps and actors

**For Executions**:
- `phase` - PENDING → RUNNING → COMPLETED/FAILED
- `error` - Failure messages
- `audit` - Timestamps and actors

**Critical Point**: Status is **NOT just audit info** - it's the entire system state!

### Update Semantics

**What Update SHOULD do** (matching Java):
1. Accept new **spec** from user (desired state)
2. Preserve **ALL existing status** (system state)
3. Update **only audit fields** within status (who/when)

**What Go was doing** (bug):
1. Accept new spec ✅
2. Clear entire status ❌
3. Update audit (but nothing else exists) ❌

### Java Implementation Reference

**File**: `UpdateOperationSetAuditStepV2.java`

**Key Lines**:
```java
// Line 56-63: Preserve entire status FIRST
Message existingResource = context.getExistingResource();
if (existingResource != null) {
    newState = ApiResourcePreviousStatusReplacer.replace(newState, existingResourceTyped);
}

// Line 66-79: THEN update audit within preserved status
var resourceBuilder = newState.toBuilder();
ApiResourceAudit audit = buildUpdateAudit(context, existingResource);
ApiResourceStatusAuditSetter.set(resourceBuilder, audit);
```

**Strategy**:
1. Copy entire status object from existing
2. Get builder from resource (includes copied status)
3. Update only audit fields
4. Build final resource

## Design Lessons

### 1. Compare Working Implementations First

When debugging, **always start by comparing working code**:
- ✅ Java implementation working? Study it first
- ✅ Understand the EXACT flow before fixing
- ❌ Don't invent "improvements" or "self-healing" logic

**In this case**: Should have compared Java's BuildUpdateState equivalent FIRST, not tried to fix symptoms.

### 2. Status is Sacred System State

The status field is NOT just metadata - it's the **source of truth for all system state**:

```go
// ❌ WRONG: Clear status (loses system state)
clearStatusFieldReflect(resource)

// ✅ CORRECT: Preserve status, update only specific fields
preserveStatusFromExisting(resource)
updateOnlyAuditFields(resource)
```

**Rule**: Never clear status without explicitly preserving what you need.

### 3. Avoid Complex Fallback Logic

The duplicate handling logic was:
- 60+ lines of code
- Multiple database queries
- Complex error path
- **Didn't exist in Java**

**Lesson**: If Java doesn't have it, you probably don't need it.

Simple failure > Complex fallback that fails mysteriously.

### 4. Direct Repository Access vs gRPC

**Two ways to save**:
```go
// Option 1: Via gRPC (goes through full handler pipeline)
s.agentClient.Update(ctx.Context(), agent)

// Option 2: Direct repository save
s.store.SaveResource(ctx.Context(), kind, id, agent)
```

**When to use each**:
- **gRPC**: When you want full validation/authorization/pipeline
- **Direct save**: When you're IN a pipeline and need surgical persistence

**In this case**: Using gRPC Update from within execution creation triggered another Update pipeline, causing BuildUpdateState to run and clear status.

## Impact Assessment

### User Impact

**Before Fix**:
- ❌ First run works, all subsequent runs fail
- ❌ Requires manual database cleanup between runs
- ❌ Confusing error messages
- ❌ Unusable for real workflows

**After Fix**:
- ✅ All runs work reliably
- ✅ Status persists correctly across updates
- ✅ No manual intervention needed
- ✅ Production-ready behavior

### System Impact

**Affected Resources**:
- ✅ Agent (default_instance_id preserved)
- ✅ AgentInstance (all status fields preserved)
- ✅ Session (all status fields preserved)
- ✅ AgentExecution (phase, error preserved)
- ✅ All other resources using BuildUpdateState

**Risk Assessment**:
- ✅ Low risk - aligns with Java behavior
- ✅ Fixes critical bug
- ✅ Simplifies code (removes 100+ lines)
- ✅ No schema changes
- ✅ No data migration needed

### Performance Impact

**Before Fix**:
- Unnecessary gRPC calls in pipeline
- Complex duplicate checking queries
- Multiple list operations

**After Fix**:
- Direct store access (faster)
- Simple failure paths (no complex queries)
- Fewer operations overall

## Debugging Tools Created

### 1. `tools/badger-inspect.go`

Inspect BadgerDB database contents:

```bash
# View all agents
go run tools/badger-inspect.go agent

# View all agent instances
go run tools/badger-inspect.go agent-instance

# View all keys
go run tools/badger-inspect.go all
```

**Features**:
- Decodes proto messages to readable JSON
- Shows all fields (metadata, spec, status)
- Essential for debugging state issues

**Usage Example**:
```bash
$ go run tools/badger-inspect.go agent
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Key: agent/agt-1768940821543198000
Size: 347 bytes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "metadata": {
    "id": "agt-1768940821543198000",
    "name": "pr-reviewer",
    "slug": "pr-reviewer"
  },
  "status": {
    "default_instance_id": "ain-1768940931959458000"  ← Visible!
  }
}
```

### 2. `tools/decode-manifest.go`

Decode proto manifest files:

```bash
go run tools/decode-manifest.go ~/stigmer-project/.stigmer/agent-manifest.pb
```

**Use case**: Inspect agent/workflow manifests during development.

## Technical Details

### Proto Reflection for Status Preservation

```go
func copyStatusFromExisting[T proto.Message](merged, existing T) error {
    // Use proto reflection to access status field generically
    existingMsg := existing.ProtoReflect()
    existingStatusField := existingMsg.Descriptor().Fields().ByName("status")
    
    // Get entire status value
    existingStatus := existingMsg.Get(existingStatusField)
    
    // Copy entire field to merged (not individual fields!)
    mergedMsg := merged.ProtoReflect()
    mergedStatusField := mergedMsg.Descriptor().Fields().ByName("status")
    mergedMsg.Set(mergedStatusField, existingStatus)
    
    return nil
}
```

**Why proto reflection**:
- Works for ANY resource type (Agent, Session, Execution, etc.)
- No type-specific code needed
- Copies entire status object atomically
- Matches Java's field descriptor approach

### Status vs Audit

**Status** (entire system state):
```protobuf
message AgentStatus {
  string default_instance_id = 1;  // System state
  ExecutionPhase phase = 2;        // System state
  repeated Condition conditions = 3; // System state
  ApiResourceAudit audit = 4;      // WHO/WHEN info
}
```

**Audit** (who/when metadata):
```protobuf
message ApiResourceAudit {
  ApiResourceAuditInfo spec_audit = 1;   // Who/when for spec
  ApiResourceAuditInfo status_audit = 2; // Who/when for status
}
```

**Key Point**: Audit is a **small subset** of status, not the entire thing!

## Flow Comparison

### Create Flow (Both Java and Go)

```
Input (from user):
  metadata: {name: "pr-reviewer"}
  spec: {instructions: "..."}
  status: {} ← Empty or user-provided (ignored)

Pipeline:
1. ResolveSlug: metadata.slug = "pr-reviewer"
2. CheckDuplicate: Verify doesn't exist
3. BuildNewState:
   - Generate ID
   - Clear status (ignore user input)
   - Set audit (created_by, created_at)
4. Persist: Save to database
5. CreateDefaultInstance: Create instance
6. UpdateAgentStatusWithDefaultInstance:
   - agent.status.default_instance_id = "ain-xxx"
   - Save again

Result:
  metadata: {id, name, slug}
  spec: {...}
  status: {
    default_instance_id: "ain-xxx"  ✅
    audit: {created_by, created_at}
  }
```

### Update Flow (Java - Working)

```
Input (from user):
  metadata: {id: "agt-xxx", name: "pr-reviewer"}
  spec: {instructions: "updated..."}
  status: {} ← User shouldn't set this

Pipeline:
1. LoadExisting: Load from database
2. BuildUpdateState:
   - Clear status from INPUT ✅
   - Preserve ENTIRE status from existing ✅
   - Update audit within preserved status ✅
3. Persist: Save merged resource

Result:
  metadata: {id, name, slug}
  spec: {... updated spec ...}
  status: {
    default_instance_id: "ain-xxx"  ✅ PRESERVED
    audit: {created_by, created_at, updated_by, updated_at}
  }
```

### Update Flow (Go - Before Fix - Broken)

```
Input (from user):
  Same as Java

Pipeline:
1. LoadExisting: Load from database ✅
2. BuildUpdateState:
   - Clear status from INPUT ✅
   - Clear status from MERGED ❌ BUG!
   - Update audit (but status is empty) ❌
3. Persist: Save without system state

Result:
  metadata: {id, name, slug}
  spec: {... updated spec ...}
  status: {
    # default_instance_id: LOST! ❌
    audit: {created_by, created_at, updated_by, updated_at}
  }
```

### Update Flow (Go - After Fix - Working)

```
Input (from user):
  Same as Java

Pipeline:
1. LoadExisting: Load from database ✅
2. BuildUpdateState:
   - Clear status from INPUT ✅
   - Preserve ENTIRE status from existing ✅
   - Update audit within preserved status ✅
3. Persist: Save merged resource

Result:
  metadata: {id, name, slug}
  spec: {... updated spec ...}
  status: {
    default_instance_id: "ain-xxx"  ✅ PRESERVED
    audit: {created_by, created_at, updated_by, updated_at}
  }
```

## Metrics

**Code Changes**:
- Lines added: ~60 (status preservation + debugging tools)
- Lines removed: ~120 (buggy duplicate handling)
- Net reduction: -60 lines
- Files modified: 3 core files
- Tools created: 2 debugging utilities

**Build Verification**: ✅ Compiled successfully

**Time to Root Cause**: ~2 hours (multiple false starts)

**Debugging Iterations**:
1. Slug vs name hypothesis (wrong)
2. Duplicate handling (wrong)
3. Comparison with Java (found it!)

## Related Issues

### This Fix Resolves

- ✅ Agent execution failures after first run
- ✅ Default instance "already exists" errors
- ✅ Status field loss during updates
- ✅ All resources losing system state on update

### Previous Attempts (Wrong Fixes)

Referenced changelogs with wrong diagnoses:
- `2026-01-21-191705-fix-default-instance-duplicate-error.md` - Added duplicate handling (wrong approach)
- `2026-01-21-200728-fix-default-instance-slug-name-mismatch.md` - Slug vs name (wrong diagnosis)

**Lesson**: The previous "fixes" addressed symptoms, not the root cause.

## Summary

**The Problem**: BuildUpdateState cleared entire status field, losing all system state  
**The Root Cause**: Misunderstood update semantics - status should be preserved, not cleared  
**The Fix**: Preserve entire status from existing resource, update only audit fields (matching Java)  
**The Result**: Agents work reliably across multiple runs, status persists correctly

This fix aligns Go with Java behavior and makes the update pipeline work correctly for ALL resource types.

---

**Classification**: Bug Fix (Critical)  
**Severity**: High (blocking agent executions after first run)  
**Priority**: Immediate (core framework bug affecting all resources)  
**Breaking Changes**: None (fixes broken behavior to match expected behavior)  
**API Changes**: None (internal pipeline fix only)  
**Build Status**: ✅ Verified (compiled successfully)  
**Testing**: ✅ Verified (first, second, third runs all work)
