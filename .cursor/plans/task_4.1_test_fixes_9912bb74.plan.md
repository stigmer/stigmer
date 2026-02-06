---
name: Task 4.1 Test Fixes
overview: Fix all pre-existing test failures across SDK packages after unified pattern changes. Address duplicate file issues, update protobuf enum references, and ensure full SDK test suite passes.
todos:
  - id: diagnose-mcpserver
    content: Compare mcpserver/server.go vs mcpserver.go, identify duplicate, check git history
    status: completed
  - id: fix-mcpserver-duplicate
    content: Delete duplicate MCPServer file, verify builds and tests pass
    status: completed
  - id: fix-examples-scope
    content: Remove ApiResourceReference.Scope checks, use Org field convention instead
    status: completed
  - id: fix-examples-enums
    content: Update all WorkflowTaskKind enum references to snake_case names
    status: completed
  - id: validate-individual
    content: Test mcpserver, examples, templates packages individually
    status: completed
  - id: validate-full-sdk
    content: "Run full SDK test suite: go build ./... && go test ./... && go vet ./..."
    status: completed
  - id: verify-integration
    content: Run integration tests to ensure packages work together
    status: completed
isProject: false
---

# Task 4.1: Fix Pre-existing Test Failures

## Overview

After applying the unified Name/Slug/Args pattern across all SDK resources (Agent, MCPServer, Skill, Workflow), we need to fix pre-existing test failures to ensure the entire SDK builds and tests cleanly. This task addresses build failures, outdated enum references, and ensures all packages work together seamlessly.

## Current Test Failures Identified

### Critical Issues

1. **MCPServer Package - Duplicate File Declarations**
  - **Problem**: Both `server.go` and `mcpserver.go` exist with identical content
  - **Error**: Multiple "redeclared in this block" errors for `McpServerArgs`, `Context`, `MCPServer`, `Stdio`, `HTTP`, and all methods
  - **Impact**: Blocks compilation of entire SDK (FAIL build)
  - **Root Cause**: During Task 3.2, likely created new file instead of refactoring existing one
  - **Files**: `[sdk/go/mcpserver/server.go](sdk/go/mcpserver/server.go)`, `[sdk/go/mcpserver/mcpserver.go](sdk/go/mcpserver/mcpserver.go)`
2. **Examples Test - Outdated Protobuf Enum References**
  - **Problem**: Test code references old enum constant names that don't exist
  - **Errors**:
    - `ApiResourceReference.Scope` field doesn't exist (proto removed this field)
    - `ApiResourceOwnerScope_platform`, `_organization`, `_identity_account` enums undefined
    - `WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH` wrong naming (actual: `WorkflowTaskKind_switch_case`)
    - Similar issues for `_FOR`, `_TRY`, `_FORK`, `_AGENT_CALL` (actual: `for_each`, `try_catch`, `fork`, `agent_call`)
  - **Impact**: `examples_test.go` fails to compile
  - **Root Cause**: Proto schema evolved, enum naming changed from SCREAMING_SNAKE to snake_case
  - **File**: `[sdk/go/examples/examples_test.go](sdk/go/examples/examples_test.go)`
3. **Templates Test - Cascading Build Failure**
  - **Problem**: `TestTemplatesCompile` fails because it tries to build code that imports mcpserver package
  - **Impact**: Template validation fails (BasicAgent, BasicWorkflow, AgentAndWorkflow tests)
  - **Root Cause**: Cascading failure from MCPServer duplicate files issue
  - **File**: `[sdk/go/templates/templates_test.go](sdk/go/templates/templates_test.go)`

### Protobuf Schema Changes to Address

Based on analysis of generated code:

**ApiResourceReference** (from `apis/stubs/go/ai/stigmer/commons/apiresource/io.pb.go`):

- Has fields: `Org`, `Kind`, `Slug`, `Version`
- Does NOT have `Scope` field (removed in proto evolution)

**WorkflowTaskKind** (from `apis/stubs/go/ai/stigmer/agentic/workflow/v1/enum.pb.go`):

- Uses snake_case naming: `switch_case`, `for_each`, `try_catch`, `fork`, `agent_call`
- NOT SCREAMING_SNAKE_CASE: ~~`WORKFLOW_TASK_KIND_SWITCH`~~

## Implementation Steps

### Step 1: Fix MCPServer Duplicate Files

**Diagnosis Required**:

- Compare `mcpserver/server.go` vs `mcpserver/mcpserver.go` (likely identical)
- Determine which file is the canonical version
- Check git history to understand which was original

**Fix Strategy**:

- Keep ONE file (likely `mcpserver.go` based on package naming convention)
- Delete the duplicate file
- Verify all imports and references work

**Files to Modify**:

- Delete: `sdk/go/mcpserver/server.go` (or `mcpserver.go` if that's the duplicate)

### Step 2: Fix Examples Test Enum References

**Changes Required in `[examples_test.go](sdk/go/examples/examples_test.go)**`:

1. **Remove ApiResourceReference.Scope checks** (lines ~203-210):
  ```go
   // OLD (REMOVE):
   switch usage.McpServerRef.Scope {
   case apiresource.ApiResourceOwnerScope_platform:
       hasPlatform = true
   // ... etc
  ```
   **New Approach**: Check by `Org` field convention instead:
2. **Update WorkflowTaskKind enum constants** (multiple locations):
  - Line ~316: `WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH` → `workflowv1.WorkflowTaskKind_switch_case`
  - Line ~346: `WorkflowTaskKind_WORKFLOW_TASK_KIND_FOR` → `workflowv1.WorkflowTaskKind_for_each`
  - Line ~376: `WorkflowTaskKind_WORKFLOW_TASK_KIND_TRY` → `workflowv1.WorkflowTaskKind_try_catch`
  - Line ~406: `WorkflowTaskKind_WORKFLOW_TASK_KIND_FORK` → `workflowv1.WorkflowTaskKind_fork`
  - Lines ~472, 502: `WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL` → `workflowv1.WorkflowTaskKind_agent_call`

**Correct Import Required**:

```go
import (
    workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
)
```

### Step 3: Verify Cascading Fixes

Once Steps 1-2 are complete, the templates test should automatically pass since it's a cascading failure.

**Validation**:

```bash
cd sdk/go
go build ./...        # Should succeed
go test ./...         # All tests should pass
```

## Quality Standards

This is foundation-level work for a world-class platform. Each fix must meet these standards:

### Code Quality

- **No Quick Hacks**: Fix root causes, not symptoms
- **Consistent Naming**: Follow proto schema conventions exactly
- **Type Safety**: Use correct proto package imports and qualified names
- **Clear Intent**: Comments explain WHY the proto schema evolved

### Testing Rigor

- **Full Build**: `go build ./...` must succeed for ALL packages
- **Full Test Suite**: `go test ./...` must pass 100%
- **No Warnings**: `go vet ./...` must be clean
- **Zero Linter Errors**: No new linter warnings introduced

### Documentation

- **Git Commit Messages**: Explain what proto changes motivated the fix
- **Code Comments**: Document proto schema evolution where non-obvious
- **Migration Notes**: If examples break, document the migration path

## Validation Plan

### Phase 1: Individual Package Validation

```bash
# MCPServer package
cd sdk/go/mcpserver && go build ./... && go test ./...

# Examples package
cd sdk/go/examples && go build ./... && go test ./...

# Templates package (depends on above)
cd sdk/go/templates && go build ./... && go test ./...
```

### Phase 2: Full SDK Validation

```bash
cd sdk/go
go build ./...       # All packages build
go test ./...        # All tests pass
go vet ./...         # No vet warnings
```

### Phase 3: Integration Validation

```bash
# Verify integration scenarios still work
cd sdk/go && go test -v -run TestIntegration
```

## Expected Outcomes

### Immediate Results

- ✅ All packages compile successfully (`go build ./...`)
- ✅ All tests pass (`go test ./...`)
- ✅ No vet warnings (`go vet ./...`)
- ✅ Templates test validates all examples

### Code Health

- Zero duplicate file declarations
- Proto enum references match current schema
- Examples demonstrate correct API usage
- Clean build across all SDK packages

### Foundation Quality

- World-class test coverage maintained
- No technical debt introduced
- Clear migration path for users
- Solid foundation for Tasks 4.2 (update examples) and 4.3 (update docs)

## Risk Mitigation

### Potential Issues

1. **Other Hidden Enum References**
  - **Risk**: More tests may reference outdated enums
  - **Mitigation**: Run full `go test ./...` and address all failures
  - **Detection**: Grep for `WORKFLOW_TASK_KIND_` pattern across codebase
2. **Import Cycle Issues**
  - **Risk**: Fixing imports might create cycles
  - **Mitigation**: Use qualified imports, avoid package-level deps
  - **Detection**: Build will fail with clear error
3. **Breaking Example Code**
  - **Risk**: Example code in comments might be outdated
  - **Mitigation**: Task 4.2 will update all examples comprehensively
  - **Note**: This task focuses on TEST code, not example code

## Philosophical Approach

This task embodies the principle: **"Quality compounds, technical debt decays."**

We're not just fixing tests - we're ensuring the SDK remains a joy to use and maintain. Every fix should make the codebase BETTER, not just "working." This means:

- **Precision**: Use exact proto types, not approximations
- **Clarity**: Code explains intent, not just mechanics
- **Consistency**: Follow established patterns from Agent/Environment
- **Durability**: Fixes should survive future proto evolution

Remember: These foundations will support thousands of developers building on Stigmer. Make them proud to use our SDK.