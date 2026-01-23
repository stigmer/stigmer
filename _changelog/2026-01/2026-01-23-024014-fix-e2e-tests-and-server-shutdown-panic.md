# Fix E2E Tests and Server Shutdown Panic

**Date**: 2026-01-23  
**Type**: Bug Fix + Test Improvement  
**Scope**: Backend Server + E2E Tests  
**Impact**: Critical panic fixed, test reliability improved

## Summary

Fixed a critical panic during server shutdown (`atomic.Value` cannot store `nil`) and improved e2e test robustness by replacing fragile CLI output parsing with direct gRPC API queries using slug-based lookups.

## Problems Solved

### 1. Server Shutdown Panic (Critical)

**Issue**: Server crashed during shutdown in e2e tests with panic:
```
panic: sync/atomic: store of nil value into Value
at temporal_manager.go:495
```

**Root Cause**: `atomic.Value.Store(nil)` is not allowed in Go. The code attempted to clear the Temporal client reference during shutdown by storing `nil`, which causes a panic.

**Impact**: 
- All e2e tests failed due to panic during cleanup
- Server couldn't shut down gracefully
- Tests showed "exit status 2" and panic stack traces

### 2. Fragile Test Implementation

**Issue**: Tests extracted agent IDs by parsing CLI text output using string matching:
```go
// OLD: Fragile text parsing
agentID := extractIDFromOutput(cliOutput)
if strings.Contains(line, "code-reviewer") && strings.Contains(line, "ID:") {
    // Parse and extract ID...
}
```

**Problems**:
- Substring matching bug: `"code-reviewer"` matched `"code-reviewer-pro"`, extracting same ID for both
- Fragile: Breaks if output format changes
- Semantically wrong: Counted text occurrences instead of actual agents (4 occurrences for 2 agents)
- Tests presentation layer, not actual backend state

**Failing Tests**:
- `TestApplyBasicAgent` - Agent name mismatch due to substring bug
- `TestApplyAgentCount` - Expected 2 agents, found 4 text occurrences
- `TestRunFullAgent` - Expected org="my-org", got org="local"

### 3. Incorrect Test Expectations

**Issue**: Tests expected `org = "my-org"` but backend always sets `org = "local"` in local mode.

**Root Cause**: The deployer intentionally overwrites org field to match backend mode (local vs cloud).

## Solutions Implemented

### 1. Fixed Server Shutdown Panic

**File**: `backend/services/stigmer-server/pkg/server/temporal_manager.go`

**Change**:
```go
// Close client
currentClient := tm.GetClient()
if currentClient != nil {
    log.Debug().Msg("Closing Temporal client")
    currentClient.Close()
    // Note: No need to clear atomic.Value during shutdown
    // (storing nil in atomic.Value causes panic)
}
```

**Why**: During shutdown, clearing the atomic reference is unnecessary. The `GetClient()` method already handles `nil` checks gracefully. Removing the `Store(nil)` eliminates the panic.

**Result**: Server now shuts down cleanly without panic.

### 2. Created Robust API Query Helper

**File**: `test/e2e/helpers_test.go`

**New Helper Function**:
```go
// GetAgentBySlug queries an agent by slug and organization via gRPC API
// This is the proper way to verify agents by slug in tests
func GetAgentBySlug(serverPort int, slug string, org string) (*agentv1.Agent, error) {
    // Connect and create client
    client := agentv1.NewAgentQueryControllerClient(conn)
    
    // Query by reference (slug + org)
    agent, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
        Scope: apiresource.ApiResourceOwnerScope_organization,
        Org:   org,
        Kind:  apiresourcekind.ApiResourceKind_agent,
        Slug:  slug,
    })
    return agent, err
}
```

**Why**: 
- Agent slugs are **known in advance** (from test data)
- Tests actual backend state via gRPC API
- Robust against CLI output format changes
- Semantically correct: Query by slug, not parse text

### 3. Replaced All Agent ID Extractions

**Files Updated**:
- `test/e2e/basic_agent_apply_test.go`
- `test/e2e/basic_agent_run_test.go`
- `test/e2e/e2e_run_full_test.go`

**Before (Fragile)**:
```go
// Parse CLI output to extract ID
var agentID string
for _, line := range strings.Split(output, "\n") {
    if strings.Contains(line, "code-reviewer") && strings.Contains(line, "ID:") {
        agentID = extractID(line) // Substring matching bug!
    }
}
agent, _ := GetAgentViaAPI(serverPort, agentID)
```

**After (Robust)**:
```go
// Query directly by slug
org := "local"
agent, err := GetAgentBySlug(serverPort, "code-reviewer", org)
// No text parsing needed!
```

**Specific Changes**:

**`TestApplyBasicAgent`**:
- Removed 30+ lines of ID extraction logic
- Now queries both agents by slug: `"code-reviewer"` and `"code-reviewer-pro"`
- Direct API verification of agent properties

**`TestApplyAgentCount`**:
- Removed fragile text occurrence counting (`strings.Count(output, "ID: agt-")`)
- Now queries 2 specific agents by slug
- Verifies invalid agent was NOT deployed
- Semantically correct: 2 agents deployed = 2 API queries succeed

**`TestRunBasicAgent`**:
- Removed ID extraction from apply output
- Queries agent by slug `"code-reviewer"` before running it

**`TestRunFullAgent`**:
- Removed ID extraction from apply output
- Queries agent by slug `"code-reviewer-pro"` before running it

**`e2e_run_full_test.go`**:
- Removed `extractAgentID()` helper function (no longer needed)
- Both test cases now use `GetAgentBySlug`

### 4. Fixed Test Expectations

**Change**: Updated org field expectations to match actual backend behavior:
```go
// OLD: Incorrect expectation
s.Equal("my-org", fullAgent.Metadata.Org)

// NEW: Correct expectation with explanation
// Note: In local backend mode, org is always overwritten to "local" regardless of SDK code
s.Equal("local", fullAgent.Metadata.Org)
```

**Why**: The deployer intentionally sets `org = "local"` for local backend mode. This is correct behavior - tests were wrong.

## Technical Details

### Why GetAgentBySlug is Better

**Advantages**:
1. **Known values**: Agent slugs are defined in test data (no runtime extraction needed)
2. **Semantic correctness**: Tests business logic, not presentation
3. **Direct verification**: Queries actual backend state via gRPC
4. **Robust**: Immune to CLI output format changes
5. **Cleaner code**: Removes 50+ lines of fragile parsing logic
6. **No substring bugs**: Exact slug matching, not text search

**Pattern for tests**:
```go
// Known values from test data
slug := "code-reviewer"  // From SDK example
org := "local"           // Backend mode in tests

// Direct API query
agent, err := GetAgentBySlug(serverPort, slug, org)
// Verify properties
s.Equal("code-reviewer", agent.Metadata.Name)
```

### Why atomic.Value Can't Store nil

**Go Restriction**: `atomic.Value` requires a consistent concrete type. Once you store a value of type `T`, all subsequent stores must also be type `T`. Storing `nil` (untyped) violates this.

**Solution**: Don't clear the value during shutdown. The `GetClient()` method already handles the case where `Load()` returns `nil`, so clearing is unnecessary.

## Testing Results

### Before Fixes:
```
--- FAIL: TestE2E (12.25s)
    --- FAIL: TestE2E/TestApplyAgentCount
    --- FAIL: TestE2E/TestApplyBasicAgent
    --- FAIL: TestE2E/TestRunFullAgent
    --- PASS: TestE2E/TestApplyDryRun
    --- PASS: TestE2E/TestRunBasicAgent
    --- PASS: TestE2E/TestRunWithInvalidAgent
FAIL (with panic during shutdown)
```

### After Fixes:
```
--- PASS: TestE2E (11.37s)
    --- PASS: TestE2E/TestApplyAgentCount (1.61s)  ✅
    --- PASS: TestE2E/TestApplyBasicAgent (1.41s)  ✅
    --- PASS: TestE2E/TestApplyDryRun (1.34s)      ✅
    --- PASS: TestE2E/TestRunBasicAgent (2.07s)    ✅
    --- PASS: TestE2E/TestRunFullAgent (2.09s)     ✅
    --- PASS: TestE2E/TestRunWithInvalidAgent (2.09s) ✅
PASS (clean shutdown, no panic)
```

**All tests passing!** 🚀

## Code Quality Improvements

### Lines of Code Reduced
- **Removed**: ~80 lines of fragile parsing logic
- **Added**: 28 lines of robust API helper
- **Net**: -52 lines, +100% reliability

### Test Maintainability
- **Before**: Tests break if CLI output format changes
- **After**: Tests only break if backend behavior changes (correct)

### Code Clarity
```go
// Before: What is this doing?
for _, line := range lines {
    if strings.Contains(line, agentName) && strings.Contains(line, "ID:") {
        start := strings.Index(line, "ID: ")
        // ... 10 more lines of string manipulation
    }
}

// After: Crystal clear
agent, err := GetAgentBySlug(serverPort, "code-reviewer", "local")
```

## Files Changed

**Backend**:
- `backend/services/stigmer-server/pkg/server/temporal_manager.go` - Fixed shutdown panic

**Test Infrastructure**:
- `test/e2e/helpers_test.go` - Added `GetAgentBySlug` helper

**Test Cases**:
- `test/e2e/basic_agent_apply_test.go` - Removed ID extraction, use slug queries
- `test/e2e/basic_agent_run_test.go` - Removed ID extraction, use slug queries  
- `test/e2e/e2e_run_full_test.go` - Removed `extractAgentID()`, use slug queries

## Lessons Learned

### Testing Best Practices

**Don't test presentation, test state**:
- ❌ Parse CLI output strings
- ✅ Query actual backend state via API

**Use known values**:
- ❌ Extract dynamic values from output
- ✅ Use known slugs/names from test data

**Test the right thing**:
- ❌ Count text occurrences: `strings.Count(output, "ID: agt-")` = 4 for 2 agents
- ✅ Query actual count: 2 distinct agents exist in backend

### Go atomic.Value Pattern

**Don't try to clear atomic.Value**:
- ❌ `atomicValue.Store(nil)` → panic
- ✅ Leave value as-is, handle `nil` check in getter

**Pattern for shutdown**:
```go
// Just close the resource, don't clear the atomic reference
if resource != nil {
    resource.Close()
    // No need to: atomic.Store(nil)
}
```

## Impact

**Stability**: Critical panic eliminated - server shuts down cleanly  
**Reliability**: Tests now robust against output format changes  
**Maintainability**: 52 fewer lines of fragile parsing code  
**Correctness**: Tests verify actual backend state, not presentation  
**Pattern**: Established `GetAgentBySlug` as standard approach for tests  

**Future Tests**: Should follow this pattern - query by known slugs, don't parse output.
