---
name: Workflow Internal Package
overview: Create internal/cli/workflow/ package with get.go, delete.go, display.go, and BUILD.bazel - mirroring the agent package patterns exactly, with workflow-specific gRPC client calls.
todos:
  - id: create-get-go
    content: Create internal/cli/workflow/get.go with GetFromBackend() and Get() functions
    status: completed
  - id: create-delete-go
    content: Create internal/cli/workflow/delete.go with DeleteFromBackend(), Delete(), and result types
    status: completed
  - id: create-display-go
    content: Create internal/cli/workflow/display.go with all display functions (table/yaml/json)
    status: completed
  - id: create-build-bazel
    content: Create internal/cli/workflow/BUILD.bazel with correct dependencies
    status: completed
  - id: verify-build
    content: Verify package builds successfully with bazel build
    status: completed
isProject: false
---

# Workflow Internal Package Foundation

## Context

This is Sub-task 1 of Phase 2, creating the foundational `internal/cli/workflow/` package. This package will be consumed by the command layer (`cmd/stigmer/root/workflow_*.go` files) in subsequent sub-tasks.

**Architectural Principle**: The internal package handles gRPC communication and display formatting. The command layer handles flag parsing and orchestration. This separation follows the Single Responsibility Principle enforced by the coding guidelines.

---

## Package Structure

```
client-apps/cli/internal/cli/workflow/
├── get.go          (~85 lines)  - Fetch workflow via gRPC
├── delete.go       (~78 lines)  - Delete workflow via gRPC
├── display.go      (~150 lines) - Output formatting (table/yaml/json)
└── BUILD.bazel                  - Bazel build definition
```

---

## 1. get.go - Workflow Retrieval (~85 lines)

**Mirrors**: [internal/cli/agent/get.go](client-apps/cli/internal/cli/agent/get.go)

**Key Functions**:


| Function                           | Purpose                                     | Lines |
| ---------------------------------- | ------------------------------------------- | ----- |
| `GetFromBackend(conn, orgID, ref)` | Fetch workflow via gRPC, routing ID vs slug | ~40   |
| `Get(opts *GetOptions)`            | Structured wrapper with validation          | ~15   |


**Implementation Details**:

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

**Types**:

- `GetOptions` struct: `Reference`, `OrgID`, `Conn`

**Error Handling**: All errors wrapped with `errors.Wrap()` containing operation context (e.g., "failed to get workflow by ID 'wfl_xxx'").

---

## 2. delete.go - Workflow Deletion (~78 lines)

**Mirrors**: [internal/cli/agent/delete.go](client-apps/cli/internal/cli/agent/delete.go)

**Key Functions**:


| Function                              | Purpose                            | Lines |
| ------------------------------------- | ---------------------------------- | ----- |
| `DeleteFromBackend(conn, workflowID)` | Low-level gRPC delete call         | ~20   |
| `Delete(opts *DeleteOptions)`         | Structured wrapper with validation | ~25   |


**Implementation Details**:

```go
// Uses WorkflowCommandController.Delete()
client := workflowv1.NewWorkflowCommandControllerClient(conn)
deleted, err := client.Delete(ctx, &workflowv1.WorkflowId{Value: workflowID})
```

**Types**:

- `DeleteOptions` struct: `WorkflowID`, `Conn`
- `DeleteResult` struct: `Workflow *workflowv1.Workflow`

**Design Note**: The delete method returns the deleted workflow for display purposes, allowing confirmation of what was deleted.

---

## 3. display.go - Output Formatting (~150 lines)

**Mirrors**: [internal/cli/agent/display.go](client-apps/cli/internal/cli/agent/display.go)

**Key Functions**:


| Function                                            | Purpose                                   | Lines |
| --------------------------------------------------- | ----------------------------------------- | ----- |
| `DisplayGetResult(workflow, format)`                | Route to table/yaml/json display          | ~10   |
| `displayWorkflowTable(workflow)`                    | Human-readable table format               | ~25   |
| `displayWorkflowYAML(workflow)`                     | Full proto as YAML                        | ~20   |
| `displayWorkflowJSON(workflow)`                     | Full proto as JSON                        | ~15   |
| `DisplayDeleteResult(result)`                       | Success message after delete              | ~15   |
| `DisplayDeleteConfirmation(workflow)`               | Pre-delete warning                        | ~15   |
| `displayWorkflowSummary(workflow)`                  | Internal helper for consistent formatting | ~20   |
| `DisplaySearchResult(results, query, format, page)` | Search output with pagination             | ~20   |
| `DisplayListResult(results, format, page)`          | List output (for future use)              | ~15   |


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
  Steps:       5
```

**YAML/JSON**: Uses `protojson.MarshalOptions` with `UseProtoNames: true` and `EmitUnpopulated: false`.

---

## 4. BUILD.bazel - Build Definition

**Mirrors**: [internal/cli/agent/BUILD.bazel](client-apps/cli/internal/cli/agent/BUILD.bazel)

**Dependencies**:

```python
deps = [
    # Workflow proto stubs
    "//apis/stubs/go/ai/stigmer/agentic/workflow/v1:workflow",
    # Shared proto types
    "//apis/stubs/go/ai/stigmer/commons/apiresource",
    "//apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind",
    # CLI utilities
    "//client-apps/cli/internal/cli/clierr",
    "//client-apps/cli/internal/cli/cliprint",
    "//client-apps/cli/internal/cli/search",
    "//client-apps/cli/pkg/reference",
    # External
    "@com_github_pkg_errors//:errors",
    "@in_gopkg_yaml_v3//:yaml_v3",
    "@org_golang_google_grpc//:grpc",
    "@org_golang_google_protobuf//encoding/protojson",
]
```

**Visibility**: `["//client-apps/cli:__subpackages__"]`

---

## Key Imports

```go
import (
    workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
    "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
    "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
    "github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
    "github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
    "github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
    "github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
)
```

---

## Quality Checklist (Per Coding Guidelines)

- Every file under 250 lines (target: get.go ~85, delete.go ~78, display.go ~150)
- Every function under 50 lines
- Every error wrapped with `errors.Wrap()` and specific context
- No business logic beyond gRPC calls and display formatting
- File names are descriptive
- Function names describe what they do
- Imports properly organized with blank line separators
- Package builds successfully via Bazel

---

## Testing Strategy

Build verification via Bazel:

```bash
bazel build //client-apps/cli/internal/cli/workflow:workflow
```

Unit tests will be added in Sub-task 8 (Documentation and Cleanup) to maintain focus. The current sub-task focuses on correct implementation that compiles and follows patterns.

---

## Differences from Agent Package


| Aspect            | Agent                                         | Workflow                          |
| ----------------- | --------------------------------------------- | --------------------------------- |
| Proto package     | `agentv1`                                     | `workflowv1`                      |
| ID type           | `AgentId`                                     | `WorkflowId`                      |
| Query client      | `AgentQueryControllerClient`                  | `WorkflowQueryControllerClient`   |
| Command client    | `AgentCommandControllerClient`                | `WorkflowCommandControllerClient` |
| Resource kind     | `ApiResourceKind_agent`                       | `ApiResourceKind_workflow`        |
| ID prefix         | `agt_`                                        | `wfl_`                            |
| No `applier.go`   | Workflows are SDK-synthesized, not YAML-first |                                   |
| No `loader.go`    | Workflows are SDK-synthesized, not YAML-first |                                   |
| No `validator.go` | Validation happens in SDK synthesis           |                                   |


---

## Success Criteria

1. Package compiles with `bazel build`
2. All functions follow agent patterns exactly
3. All errors properly wrapped
4. Display functions support table/yaml/json formats
5. Code adheres to all coding guidelines
6. Ready for consumption by command layer in Sub-task 2

