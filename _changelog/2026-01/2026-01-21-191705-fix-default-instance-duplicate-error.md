# Fix: Default Instance Already Exists Error

**Date**: 2026-01-21  
**Category**: Bug Fix + Self-Healing Improvement  
**Scope**: Agent Execution Creation, Agent Creation  
**Impact**: High (blocking issue for executions)

## Problem

Agent execution creation failed with "already exists" error when attempting to create a default agent instance:

```
✗ Failed to create execution: failed to create execution: rpc error: code = Unknown desc = 
pipeline step CreateDefaultInstanceIfNeeded failed: failed to create default instance: 
rpc error: code = Unknown desc = pipeline step CheckDuplicate failed: AgentInstance with 
slug 'pr-reviewer-default' already exists (id: ain-1768940931959458000)
```

## Root Cause

The issue occurred due to inconsistent state:

1. A default agent instance (`{agent-slug}-default`) existed in the database
2. However, the agent's `status.default_instance_id` field was **not populated**
3. When creating an agent execution:
   - The system checked `agent.status.default_instance_id`
   - Found it empty, attempted to create default instance
   - Creation failed with duplicate error

This scenario happens when:
- Agent creation succeeded in creating instance but failed during status update
- System crash/interruption between instance creation and status update
- Manual instance creation with default naming pattern

## Solution Implemented

Implemented **graceful self-healing fallback mechanism** in three files:

### 1. Enhanced Agent Instance Client

**File**: `backend/services/stigmer-server/pkg/downstream/agentinstance/client.go`

Added query capabilities to the downstream client:

```go
type Client struct {
    conn        *grpc.ClientConn
    client      agentinstancev1.AgentInstanceCommandControllerClient
    queryClient agentinstancev1.AgentInstanceQueryServiceClient  // NEW
}

func (c *Client) GetByAgent(ctx context.Context, agentID string) (*agentinstancev1.AgentInstanceList, error) {
    // Query all instances for a specific agent
}
```

**Why**: Needed ability to query existing instances when creation fails with duplicate error.

### 2. Fixed Agent Execution Creation

**File**: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go`

Modified `createDefaultInstanceIfNeededStep` pipeline step:

```go
// Try to create default instance
createdInstance, err := s.agentInstanceClient.CreateAsSystem(ctx.Context(), instanceRequest)
if err != nil {
    // NEW: Check if error is "already exists"
    if isAlreadyExistsError(err) {
        // Fetch all instances for this agent
        instanceList, _ := s.agentInstanceClient.GetByAgent(ctx.Context(), agentID)
        
        // Find the default instance by slug match
        for _, instance := range instanceList.GetItems() {
            if instance.GetMetadata().GetName() == expectedSlug {
                createdInstance = instance  // Use existing instead of failing
                break
            }
        }
    } else {
        return err  // Other errors still fail
    }
}

// Continue with createdInstance (whether new or existing)
// Update agent status with instance ID
```

**Flow**:
1. Try create → Success → Use new instance ✅
2. Try create → "Already exists" → Fetch existing → Find by slug → Use existing → Update agent status ✅
3. Try create → Other error → Fail ❌

### 3. Fixed Agent Creation

**File**: `backend/services/stigmer-server/pkg/domain/agent/controller/create.go`

Applied same fallback logic to `createDefaultInstanceStep` during agent creation:

```go
// Same pattern: try create, on duplicate fetch existing, use it
```

**Why**: Handles edge case where agent is recreated or instance was manually created.

## Technical Details

### Helper Function

Added `isAlreadyExistsError()` helper in both files:

```go
func isAlreadyExistsError(err error) bool {
    if err == nil {
        return false
    }
    errMsg := strings.ToLower(err.Error())
    return strings.Contains(errMsg, "already exists")
}
```

**Approach**: String matching on error message (acceptable for gRPC errors with consistent formatting).

### Instance Lookup Strategy

When "already exists" error occurs:

1. **Query all instances** for the agent using `GetByAgent(agentID)`
2. **Filter by slug pattern**: Find instance where `slug == "{agent-slug}-default"`
3. **Use found instance**: Treat as if we created it
4. **Update agent status**: Populate `status.default_instance_id`
5. **Continue execution**: No failure, just recovery

### Why GetByAgent() Instead of Direct Slug Lookup?

Current BadgerDB store doesn't have slug-based indexes, only:
- List all resources of a kind
- Get by ID

`GetByAgent()` filters all agent instances client-side. For local OSS usage (small datasets), this is acceptable.

**Future optimization**: Add slug-based index if performance becomes an issue.

## Benefits

### 1. Self-Healing

System automatically recovers from inconsistent state:
- Instance exists but status not updated → **Fixed automatically**
- No manual intervention needed
- Agent status gets updated correctly

### 2. Idempotent Operations

Can retry operations without failures:
- First attempt: Creates instance
- Subsequent attempts: Find and use existing instance
- Both succeed with same result

### 3. Robust Edge Case Handling

Handles multiple scenarios gracefully:
- Previous creation crashed mid-pipeline
- Manual instance creation with default slug
- Concurrent creation attempts (both succeed)

### 4. User Experience

Before:
```
❌ Failed to create execution
User: "Why did this fail? The agent exists!"
User: Searches database, finds orphaned instance
User: Manually updates agent status
User: Retries execution
```

After:
```
✅ Execution created successfully
System: Found existing default instance
System: Updated agent status automatically
```

## Testing

To verify the fix:

1. **Reproduce scenario** (if orphaned instance still exists):
   ```bash
   stigmer run
   # Select agent with orphaned instance
   ```

2. **Expected behavior**:
   - Detects existing default instance
   - Updates agent status
   - Creates execution successfully
   - Logs: "Found existing default instance"

3. **Verify status update**:
   ```bash
   stigmer get agent {agent-name} -o yaml
   # Check: status.default_instance_id should be populated
   ```

## Edge Cases Handled

| Scenario | Behavior | Result |
|----------|----------|--------|
| Instance exists, status empty | Fetch instance, update status | ✅ Success |
| Instance doesn't exist | Create new instance | ✅ Success |
| Multiple instances for agent | Find one matching default slug | ✅ Success |
| Default slug not found despite error | Return clear error | ❌ Fail with diagnostic |
| Other creation errors | Return original error | ❌ Fail normally |
| Concurrent creation attempts | One creates, others find existing | ✅ Both succeed |

## Architecture Notes

### Downstream Client Pattern

This fix demonstrates proper use of downstream clients:

```go
// Agent execution domain calls agent instance domain via client
agentInstanceClient.CreateAsSystem(...)  // Create
agentInstanceClient.GetByAgent(...)      // Query

// Benefits:
// - Domain separation (execution doesn't access instance store directly)
// - Full gRPC interceptor chain (validation, logging, etc.)
// - Migration-ready (can swap to network gRPC later)
```

### Pipeline Step Design

The fix stays within pipeline step boundaries:

```go
func (s *createDefaultInstanceIfNeededStep) Execute(ctx) error {
    // Try create
    // On duplicate: fetch existing
    // Update agent status
    // Store in context for next step
    return nil  // Success either way
}
```

**Philosophy**: Pipeline steps should be resilient and self-healing where possible.

## Files Modified

### Modified Files (3)

1. **`backend/services/stigmer-server/pkg/downstream/agentinstance/client.go`**
   - Added `queryClient` field
   - Added `GetByAgent()` method
   - Enables querying instances by agent ID

2. **`backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go`**
   - Added `isAlreadyExistsError()` helper
   - Enhanced `createDefaultInstanceIfNeededStep` with fallback logic
   - Handles duplicate instance gracefully

3. **`backend/services/stigmer-server/pkg/domain/agent/controller/create.go`**
   - Added `isAlreadyExistsError()` helper
   - Enhanced `createDefaultInstanceStep` with fallback logic
   - Prevents failures during agent recreation

### Documentation Created (1)

4. **`_cursor/fix-summary.md`**
   - Detailed explanation of the fix
   - Root cause analysis
   - Testing instructions
   - Future improvements

## Metrics

**Lines changed**: ~180 lines (added)
**Files modified**: 3 code files + 1 doc
**Test coverage**: Manual testing (automated tests TBD)

## Log Messages

New log messages to watch for:

**Warning** (recovery in progress):
```
Default instance already exists, fetching existing instance
```

**Info** (recovery successful):
```
Found existing default instance
Successfully ensured default instance exists
```

**Debug** (status update):
```
Updated agent status with default_instance_id
```

## Future Improvements

### Optional Enhancements

1. **Transaction Support**
   - Make instance creation + status update atomic
   - Would prevent this scenario entirely
   - Requires transaction support in BadgerDB wrapper

2. **Slug Index**
   - Add slug-based index to store
   - Enable `GetBySlug()` instead of filtering all instances
   - Performance improvement for large datasets

3. **Repair Command**
   - `stigmer repair agents` to fix all orphaned instances
   - Batch operation to heal inconsistent state
   - Useful for migration/recovery scenarios

4. **Status Consistency Check**
   - Periodic validation that `status.default_instance_id` points to valid instance
   - Log warnings for broken references
   - Auto-heal detected inconsistencies

5. **Automated Tests**
   - Unit test for `isAlreadyExistsError()` helper
   - Integration test simulating orphaned instance scenario
   - Verify fallback logic execution

## Decision Rationale

### Why Not Use Transactions?

**Considered**: Wrapping instance creation + status update in transaction

**Decided**: Fallback mechanism instead

**Reasoning**:
- BadgerDB transactions are complex for cross-resource operations
- Fallback is simpler and handles all edge cases (including manual instances)
- Self-healing is valuable even with transactions (handles manual operations)
- Can add transactions later without removing fallback

### Why Not Delete and Recreate?

**Considered**: Delete existing instance, create new one

**Decided**: Find and use existing instance

**Reasoning**:
- Existing instance might have references (sessions, executions)
- Safer to reuse than delete
- Matches user intent ("I want a default instance")
- Avoids cascading issues

### Why String-Based Error Checking?

**Considered**: gRPC status codes, error types

**Decided**: String matching on "already exists"

**Reasoning**:
- gRPC errors from in-process calls wrapped generically
- "already exists" message is consistent from CheckDuplicate step
- Simple, readable, maintainable
- Can refine to status codes later if needed

## Impact Assessment

### User Impact

**High positive impact**:
- ✅ Unblocks agent execution creation
- ✅ No manual database surgery needed
- ✅ Transparent recovery (just works)

### System Impact

**Low risk**:
- ✅ Additive change (no existing functionality removed)
- ✅ Only affects error path (success path unchanged)
- ✅ Graceful fallback (still fails on real errors)

### Performance Impact

**Minimal**:
- ⚠️ Extra query on duplicate error (rare occurrence)
- ⚠️ Client-side filtering (acceptable for local usage)
- ✅ No impact on success path

## Related Issues

This fix resolves:
- Agent execution failures with "already exists" error
- Orphaned agent instances without status reference
- Manual instance creation conflicts

This fix enables:
- Reliable agent execution creation
- Idempotent operations
- Self-healing system behavior

## Lessons Learned

### Always Design for Inconsistency

Distributed systems (even local ones with multiple resources) can end up in inconsistent states:
- Process crashes
- Errors mid-operation
- Manual interventions

**Learning**: Add self-healing mechanisms proactively, not reactively.

### Pipeline Steps Should Be Resilient

Pipeline steps should handle edge cases gracefully:
- Check for existing resources before creating
- Provide fallback paths for expected errors
- Update all related state atomically where possible

**Learning**: "Create or find existing" is often better than "create or fail".

### Query Capabilities Are Infrastructure

The ability to query resources by relationships (GetByAgent) is core infrastructure:
- Enables self-healing patterns
- Supports debugging and diagnostics
- Foundation for consistency checks

**Learning**: Query patterns should be first-class in downstream clients.

## Summary

Transformed a **hard failure** into **graceful recovery**:

**Before**: "Instance already exists" → ❌ **FAIL**  
**After**: "Instance already exists" → ✅ **Find and use it**

System now automatically heals from inconsistent state, making agent operations more reliable and user-friendly.

---

**Classification**: Bug Fix + Self-Healing Improvement  
**Severity**: High (was blocking)  
**Priority**: Critical (fixed immediately)  
**Breaking Changes**: None  
**API Changes**: None (additive only)
