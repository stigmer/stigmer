# Fix SDK Test Failures - Compilation Errors and Nil Slice Handling

**Date**: 2026-01-24  
**Type**: Test Quality Improvement  
**Scope**: SDK (Go) - Agent and Workflow packages

## Summary

Fixed three categories of SDK test failures identified by `make test-sdk`:
1. Compilation errors in workflow tests (field name mismatches)
2. Nil slice handling in agent proto conversion
3. Slug auto-generation in agent metadata

These fixes improve test reliability and SDK code quality without changing user-facing behavior.

## Changes

### 1. Workflow Test Compilation Errors ✅

**Problem**: Proto integration test failed to compile due to outdated field names after API evolution.

**Files**:
- `sdk/go/workflow/proto_integration_test.go`

**Fixes**:

#### ListenTaskConfig Field Update (Line 286)
```go
// Before (compilation error)
Config: &ListenTaskConfig{
    Event: "user-action",  // ❌ Field removed in API update
}

// After
Config: &ListenTaskConfig{
    To: &types.ListenTo{
        Mode: "one",
        Signals: []*types.SignalSpec{
            {Id: "user-action", Type: "signal"},
        },
    },
}
```

#### RunTaskConfig Field Update (Line 318)
```go
// Before (compilation error)
Config: &RunTaskConfig{
    WorkflowName: "sub-workflow",  // ❌ Field renamed
}

// After
Config: &RunTaskConfig{
    Workflow: "sub-workflow",  // ✅ Current field name
}
```

**Impact**: Workflow package now compiles successfully. Tests can run.

**Test Results**:
- Before: Build failed with 2 compilation errors
- After: Build succeeds, workflow tests execute

### 2. Nil Slice Handling in Agent Proto Conversion ✅

**Problem**: Agent proto conversion functions returned `nil` instead of empty slices for optional collections, causing proto fields to serialize as `null` instead of `[]`.

**Root Cause**: Go best practice for proto/JSON serialization is to use empty slices `[]` rather than `nil` for empty collections.

**Files**:
- `sdk/go/agent/proto.go`

**Fixes** (3 functions updated):

#### convertSkillsToRefs (Line 82)
```go
// Before
func convertSkillsToRefs(skills []skill.Skill) ([]*apiresource.ApiResourceReference, error) {
    if len(skills) == 0 {
        return nil, nil  // ❌ Returns nil
    }
    // ...
}

// After
func convertSkillsToRefs(skills []skill.Skill) ([]*apiresource.ApiResourceReference, error) {
    if len(skills) == 0 {
        return []*apiresource.ApiResourceReference{}, nil  // ✅ Returns empty slice
    }
    // ...
}
```

#### convertMCPServers (Line 114)
```go
// Before
func convertMCPServers(servers []mcpserver.MCPServer) ([]*agentv1.McpServerDefinition, error) {
    if len(servers) == 0 {
        return nil, nil  // ❌ Returns nil
    }
    // ...
}

// After
func convertMCPServers(servers []mcpserver.MCPServer) ([]*agentv1.McpServerDefinition, error) {
    if len(servers) == 0 {
        return []*agentv1.McpServerDefinition{}, nil  // ✅ Returns empty slice
    }
    // ...
}
```

#### convertSubAgents (Line 205)
```go
// Before
func convertSubAgents(subAgents []subagent.SubAgent) ([]*agentv1.SubAgent, error) {
    if len(subAgents) == 0 {
        return nil, nil  // ❌ Returns nil
    }
    // ...
}

// After
func convertSubAgents(subAgents []subagent.SubAgent) ([]*agentv1.SubAgent, error) {
    if len(subAgents) == 0 {
        return []*agentv1.SubAgent{}, nil  // ✅ Returns empty slice
    }
    // ...
}
```

**Impact**: Agent proto conversion now produces proper empty arrays instead of null values.

**Test Results**:
- `TestAgentToProto_NilFields` - All 5 subtests pass:
  - `nil_skills` ✅
  - `nil_MCP_servers` ✅
  - `nil_sub-agents` ✅
  - `nil_environment_variables` ✅
  - `all_fields_nil` ✅

### 3. Slug Auto-Generation in Agent Metadata ✅

**Problem**: When Agent slug field is empty, it should be auto-generated from the agent name during proto conversion.

**Files**:
- `sdk/go/agent/proto.go`

**Fixes**:

#### Added Import
```go
import (
    // ... existing imports ...
    "github.com/stigmer/stigmer/sdk/go/stigmer/naming"
    // ... remaining imports ...
)
```

#### Auto-Generation Logic
```go
// Before (empty slug stays empty)
metadata := &apiresource.ApiResourceMetadata{
    Name:        a.Name,
    Slug:        a.Slug,  // ❌ Empty slug not handled
    Annotations: SDKAnnotations(),
}

// After (auto-generate if empty)
slug := a.Slug
if slug == "" {
    slug = naming.GenerateSlug(a.Name)  // ✅ Generate from name
}

metadata := &apiresource.ApiResourceMetadata{
    Name:        a.Name,
    Slug:        slug,
    Annotations: SDKAnnotations(),
}
```

**Impact**: Agents with empty slug fields get proper slug auto-generated during proto conversion.

**Test Results**:
- `TestAgentToProto_EmptyStringFields` ✅ Pass
  - Empty description remains empty ✅
  - Empty icon URL remains empty ✅
  - Empty slug gets auto-generated ✅

## Test Results Summary

### Before Fixes
```
FAIL: TestWorkflow (build failed - compilation errors)
FAIL: TestAgentToProto_NilFields (5/5 subtests)
FAIL: TestAgentToProto_EmptyStringFields (slug auto-generation)
```

### After Fixes
```
PASS: Workflow package builds successfully
PASS: TestAgentToProto_NilFields (5/5 subtests)
PASS: TestAgentToProto_EmptyStringFields
```

### Remaining Test Failures (Not Addressed)

These failures remain and are tracked separately:
- **Environment variable limits** - `TestAgentToProto_MaximumEnvironmentVars`
- **Data race** - `TestAgent_ConcurrentSkillAddition`
- **Example file issues** - 6 examples with compilation/validation errors
- **Dependency tracking** - `TestIntegration_DependencyTracking`
- **Error message format** - `TestValidationError_ErrorMessage`

## Technical Details

### Why Empty Slices vs Nil?

In Go proto/JSON serialization:
- `nil` slice → serializes as `null` in JSON/proto
- Empty slice `[]` → serializes as `[]` in JSON/proto

Protocol Buffers expect `repeated` fields to be `[]` when empty, not `null`.

### Why Slug Auto-Generation?

Agents created via SDK may omit the slug field (it's optional). The proto conversion layer should auto-generate a slug from the name to ensure the backend has a valid slug for resource identification.

## Quality Improvements

**Code Quality**:
- ✅ Follows Go best practices for proto serialization
- ✅ Proper handling of optional fields
- ✅ Defensive programming (auto-generate missing values)

**Test Quality**:
- ✅ Tests compile and execute
- ✅ Proto conversion edge cases covered
- ✅ Empty/nil handling validated

## Follow-Up Work

Remaining test failures to address in future work:
1. Environment variable limits enforcement
2. Concurrent access data race protection
3. Example file compilation errors
4. Dependency tracking functionality
5. Error message format validation

## Files Changed

**Modified**:
- `sdk/go/workflow/proto_integration_test.go` - Field name updates
- `sdk/go/agent/proto.go` - Nil slice handling + slug auto-generation

**Test Files Affected**:
- `sdk/go/workflow/*_test.go` - Now compile and run
- `sdk/go/agent/edge_cases_test.go` - 6 additional tests passing

## Verification

Run tests:
```bash
cd sdk/go
go test -v ./workflow/      # Compiles successfully
go test -v ./agent/         # 6 more tests passing
```

## Rationale

These fixes were identified by running `make test-sdk` and systematically addressing failures one category at a time:
1. **Compilation errors first** - Blocking all other tests
2. **Nil slice handling second** - Affecting 5 subtests
3. **Slug auto-generation third** - Single focused issue

Incremental approach allowed verification after each fix and maintained focus on one category at a time.
