# Workflow Internal Package Foundation - Phase 2 Sub-task 1

**Date**: February 1, 2026

## Summary

Created the foundational `internal/cli/workflow/` package mirroring the agent package patterns exactly. This package provides gRPC communication and display formatting utilities for workflow resources, establishing the infrastructure layer that command-layer components will consume in subsequent sub-tasks.

This is the first sub-task of Phase 2 (Workflow Command Restructuring), which aims to provide a dedicated `stigmer workflow` command group with consistent UX across all resource types.

## Problem Statement

With Phase 1 complete (Agent YAML-First Foundation), the CLI now has a full-featured `stigmer agent` command group. However, workflow operations remain scattered across root-level commands (`run`, `apply`), creating inconsistent UX and making the CLI harder to discover and learn.

### Pain Points

- No dedicated `stigmer workflow` command group - operations are at root level
- Inconsistent command patterns between agents and workflows
- No infrastructure for workflow-specific CLI operations (get, delete, list, search)
- Missing foundational layer for workflow command implementation

## Solution

Created a complete internal package for workflow operations following the exact architectural patterns established in the agent package:

**Architecture**: 
- **Internal package** handles gRPC communication and display formatting
- **Command layer** (future sub-tasks) handles flag parsing and orchestration
- Clean separation follows Single Responsibility Principle from coding guidelines

**Key Design**: Workflows are SDK-synthesized (not YAML-first like agents), so no `applier.go`, `loader.go`, or `validator.go` files are needed.

## Implementation Details

### Package Structure

```
client-apps/cli/internal/cli/workflow/
├── get.go          (84 lines)  - Workflow retrieval via gRPC
├── delete.go       (77 lines)  - Workflow deletion via gRPC
├── display.go      (194 lines) - Output formatting (table/yaml/json)
└── BUILD.bazel     (25 lines)  - Bazel build definition
```

Total: **380 lines** of production code

### 1. get.go - Workflow Retrieval

**Functions**:
- `GetFromBackend(conn, orgID, ref)` - Fetches workflow via gRPC, automatically routing ID vs slug
- `Get(opts *GetOptions)` - Structured wrapper with validation

**Key Implementation**:
```go
// Uses reference.Parse() for automatic ID detection
parsed, err := reference.Parse(ref, orgID)

if parsed.IsID {
    // Route to WorkflowQueryController.Get()
    result, err = client.Get(ctx, &workflowv1.WorkflowId{Value: parsed.ID})
} else {
    // Route to WorkflowQueryController.GetByReference()
    result, err = client.GetByReference(ctx, &apiresource.ApiResourceReference{
        Org:  parsed.Org,
        Kind: apiresourcekind.ApiResourceKind_workflow,
        Slug: parsed.Slug,
    })
}
```

**Benefits**:
- Supports all reference formats: `my-workflow`, `stigmer/my-workflow`, `wfl_abc123`
- Leverages enum-based ID detection (no hardcoded prefixes)
- Consistent error handling with `errors.Wrap()` providing operation context

### 2. delete.go - Workflow Deletion

**Functions**:
- `DeleteFromBackend(conn, workflowID)` - Low-level gRPC delete call
- `Delete(opts *DeleteOptions)` - Structured wrapper with validation
- `DeleteResult` struct wrapping the deleted workflow

**Key Implementation**:
```go
client := workflowv1.NewWorkflowCommandControllerClient(conn)
deleted, err := client.Delete(ctx, &workflowv1.WorkflowId{Value: workflowID})
```

**Benefits**:
- Returns deleted workflow for display confirmation
- Clean separation of concerns (orchestration vs execution)
- Structured options pattern for testability

### 3. display.go - Output Formatting

**Functions** (9 total):
- `DisplayGetResult()` - Routes to format-specific display
- `displayWorkflowTable()` - Human-readable table format
- `displayWorkflowYAML()` - Full proto as YAML (for editing)
- `displayWorkflowJSON()` - Full proto as JSON (for scripts)
- `DisplayDeleteResult()` - Success message after delete
- `DisplayDeleteConfirmation()` - Pre-delete warning
- `DisplaySearchResult()` - Search output with pagination
- `DisplayListResult()` - List output (for future use)
- `displayWorkflowSummary()` - Internal helper for consistent formatting

**Key Features**:
- Three output formats: table (human-readable), YAML (editable), JSON (scriptable)
- Workflow-specific summary displays: tasks count, version from Document
- Integration with generic `search` package for list/search operations
- Consistent formatting using `cliprint` utilities

**Table Format Example**:
```
Workflow: my-workflow

Metadata:
  ID:          wfl_abc123
  Name:        My Workflow
  Slug:        my-workflow
  Org:         stigmer

Spec:
  Description: Automated deployment pipeline
  Tasks:       5
  Version:     1.0.0
```

### 4. BUILD.bazel - Build Definition

**Dependencies**:
- Workflow proto stubs (`//apis/stubs/go/ai/stigmer/agentic/workflow/v1:workflow`)
- Shared proto types (apiresource, apiresourcekind)
- CLI utilities (clierr, cliprint, search)
- Reference package for ID/slug parsing
- External dependencies (grpc, protojson, yaml, errors)

**Visibility**: `["//client-apps/cli:__subpackages__"]` - accessible only within CLI

### Differences from Agent Package

| Aspect | Agent | Workflow | Reason |
|--------|-------|----------|--------|
| Proto package | `agentv1` | `workflowv1` | Different resource types |
| ID type | `AgentId` | `WorkflowId` | Different proto definitions |
| Query client | `AgentQueryControllerClient` | `WorkflowQueryControllerClient` | Different services |
| Command client | `AgentCommandControllerClient` | `WorkflowCommandControllerClient` | Different services |
| Resource kind | `ApiResourceKind_agent` | `ApiResourceKind_workflow` | Enum differentiation |
| ID prefix | `agt_` | `wfl_` | Resource-specific prefixes |
| applier.go | ✅ Has | ❌ No file | Agents are YAML-first, workflows are SDK-synthesized |
| loader.go | ✅ Has | ❌ No file | No YAML loading for workflows |
| validator.go | ✅ Has | ❌ No file | Validation happens in SDK synthesis |

## Benefits

### 1. Consistent Architecture
- Exact mirror of agent package patterns = predictable codebase
- Future contributors understand workflow code immediately after seeing agent code
- Same architectural principles across all resource types

### 2. Code Quality
- All files under 250 lines (coding guideline compliance)
- Every function under 50 lines
- All errors properly wrapped with context
- No hardcoded ID prefixes (uses enum-based detection)

### 3. Build Verification
- Package builds successfully: `bazel build //client-apps/cli/internal/cli/workflow:workflow`
- No linter errors
- Ready for consumption by command layer

### 4. Developer Experience
- Multiple output formats (table/yaml/json) for different use cases
- Clear error messages with operation context
- Consistent display patterns across resources
- Search/list integration prepared

## Impact

### Immediate
- Foundational layer complete for workflow commands
- Sub-task 2 can proceed to create workflow command group
- Infrastructure ready for get, delete, list, search, run commands

### Future
- Enables consistent `stigmer workflow` command UX
- Supports eventual removal of root-level commands
- Establishes patterns for other resource types (skills, MCP servers)

### Team
- Clear reference implementation for workflow-specific CLI operations
- Demonstrates proper layering (internal package vs command layer)
- Shows how to adapt agent patterns for different resource types

## Related Work

**Previous**:
- Phase 1: Agent YAML-First Foundation (7 sub-tasks, all complete)
- Enum-based ID detection refactoring in `pkg/reference`

**Next**:
- Sub-task 2: Workflow command group (`workflow.go`)
- Sub-tasks 3-7: Individual workflow commands (get, delete, list, search, run)
- Sub-task 8: Documentation and cleanup

**Design Context**:
- `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/design-decisions/001-agent-yaml-first-architecture.md`
- Phase 2 Plan: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/plans/phase_2_workflow_commands_069fceed.plan.md`

## Quality Metrics

**Code Organization**:
- ✅ All files under 250 lines
- ✅ All functions under 50 lines
- ✅ Descriptive file names
- ✅ Descriptive function names

**Error Handling**:
- ✅ All errors wrapped with `errors.Wrap()`
- ✅ Specific operation context in error messages

**Architecture**:
- ✅ No business logic beyond gRPC calls and display
- ✅ Clean separation: internal package vs command layer
- ✅ Proper dependency injection via options structs

**Build**:
- ✅ Bazel build successful
- ✅ No linter errors
- ✅ All imports properly organized

---

**Status**: ✅ Production Ready

**Phase 2 Progress**: 1 of 8 sub-tasks complete (12.5%)

**Next**: Sub-task 2 - Create workflow command group and register in root.go
