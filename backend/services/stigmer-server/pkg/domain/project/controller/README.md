# Project Controller

The Project controller manages Project resources in the Stigmer OSS backend. Project is the aggregate root for SDK-based deployments, enabling atomic reconciliation of embedded resources.

## Overview

Project serves as the deployment unit for the CLI's "Project Track" (SDK synthesis). When a user runs `stigmer apply` with a `stigmer.yaml` file:

1. CLI synthesizes the SDK project into a Project proto
2. Project contains embedded agents, workflows, MCP servers, and skills
3. Controller persists the Project and triggers reconciliation
4. Reconciliation aligns actual state with desired state

## Operations

| Operation | Status | Description |
|-----------|--------|-------------|
| Create | Planned (D1) | Create a new project |
| Update | Planned (D1) | Update an existing project |
| Delete | Planned (D3) | Delete a project |
| Get | Planned (D2) | Get project by ID |
| GetByReference | Planned (D2) | Get project by slug |
| Apply | Planned (D4) | Idempotent create-or-update with reconciliation |

## Architecture

```
stigmer apply (CLI)
       │
       ▼
ProjectController.Apply()
       │
       ├──► Persist Project
       │
       └──► ReconciliationService.Reconcile()
              │
              ├──► Parse DesiredState (from Project.Spec)
              ├──► Fetch ActualState (from repositories)
              ├──► Build DependencyGraph
              ├──► Compute Diff (ReconciliationPlan)
              └──► Execute Plan (create/update/delete resources)
```

## Reconciliation (Phase E)

The reconciliation engine:

1. **Parse Desired State**: Extract embedded resources from `Project.Spec`
   - `spec.agents` → Agent resources to create/update
   - `spec.workflows` → Workflow resources to create/update
   - `spec.mcp_servers` → MCP Server resources to create/update
   - `spec.skills` → Skill references (not created, just validated)

2. **Fetch Actual State**: Query resources owned by this project
   - Resources are tagged with `stigmer.ai/sdk.project` annotation

3. **Build Dependency Graph**: Use proto reflection to find `ApiResourceReference` fields
   - Agents may reference Skills
   - Workflows may reference Agents

4. **Compute Diff**: Determine creates, updates, deletes
   - Compare spec fields only (ignore metadata timestamps)
   - Detect orphans (resources no longer in desired state)

5. **Execute Plan**: Apply changes in topological order
   - Creates/Updates: Dependencies before dependents
   - Deletes: Dependents before dependencies (reverse order)

## Usage

```go
// Create controller
controller := project.NewProjectController(store)

// Register with gRPC server
projectv1.RegisterProjectCommandControllerServer(grpcServer, controller)
projectv1.RegisterProjectQueryControllerServer(grpcServer, controller)
```

## Related Tasks

- **A1**: Controller foundation (this package)
- **A2/A3**: Reconciliation value objects
- **B1-B3**: Dependency graph construction
- **C1/C2**: Diff algorithm and execution order
- **D1-D4**: CRUD and Apply handlers
- **E1/E2**: Reconciliation service and execution engine
