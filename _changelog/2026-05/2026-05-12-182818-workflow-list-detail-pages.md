# Workflow List and Detail Pages (T08)

**Date**: May 12, 2026

## Summary

Built the complete Workflow UI layer — list page, detail page with tabs, and execution list page — following the SDK-first architecture. Workflows are now a visible, first-class product surface with their own top-level sidebar entry, data hooks, styled components, and console pages. This is the first Phase 1 deliverable in the "Bring Workflows to Foreground" project.

## Problem Statement

Workflows existed only as backend plumbing — proto contracts, codegen, and Temporal integration — with zero UI presence. Users had no way to browse, inspect, or manage workflows through the web console. The platform needed to surface workflows alongside Agents, Skills, and MCP Servers as a peer-level product concept.

### Pain Points

- No workflow list page — users couldn't discover or browse workflows
- No workflow detail page — no way to inspect tasks, instances, or executions
- No execution monitoring — workflow executions were invisible in the UI
- `WorkflowClient` had no `list()` method — a codegen gap prevented programmatic listing
- `useDeleteResource` didn't support workflow kind — deletion was impossible from the UI

## Solution

Built the full feature stack bottom-up across 6 layers, following the established SDK-first architecture (DD-001) and headless-first pattern (DD-003):

1. **Codegen fix** to enable `WorkflowClient.list()` via SearchService
2. **React SDK data hooks** for all workflow data access patterns
3. **React SDK styled components** for embeddable workflow UI widgets
4. **Web console pages** as thin shells over SDK components
5. **Sidebar navigation** with top-level Workflows entry
6. **Barrel exports** and type safety verification

## Implementation Details

### Codegen: WorkflowClient.list() via SearchService

Discovered that `WorkflowClient` was missing a `list()` method that all other listable resources had. Traced the gap to `tools/codegen/proto2schema/main.go` where a `searchListResources` allowlist controlled which resources get `listVia: "SearchService"` in their codegen schema. Added `"workflow": true` to the map and re-ran `make codegen`, generating the `list()` method across Go, TypeScript, Python, and Java SDKs.

### React SDK Data Hooks (5 hooks)

All hooks follow established patterns (`useFetch`, `useResourceList`) and are framework-agnostic:

| Hook | Pattern Source | Data Source |
|------|---------------|-------------|
| `useWorkflow` | `useAgent` | `workflow.getByReference()` |
| `useWorkflowList` | `useAgentList` | `workflow.list()` via SearchService |
| `useWorkflowCount` | `useAgentCount` | `workflow.list()` with count-only |
| `useWorkflowInstances` | Custom | `workflowInstance.getByWorkflow()` |
| `useWorkflowExecutionList` | Custom | `workflowExecution.list()` / `listByWorkflow()` |

### React SDK Styled Components (3 components)

| Component | Purpose |
|-----------|---------|
| `WorkflowExecutionPhaseBadge` | Maps `WorkflowExecutionPhase` enum to colored status badges |
| `WorkflowTaskList` | Renders workflow tasks with kind icons from `TaskKindRegistry` |
| `WorkflowDetailView` | Full detail page with 4 tabs: Overview, Tasks, Instances, Executions |

`WorkflowDetailView` uses `ResourceDetailShell` for layout, ensuring visual consistency with Agent and MCP Server detail pages.

### Web Console Pages (3 pages + layout)

| Route | Component | Description |
|-------|-----------|-------------|
| `/workflows` | `WorkflowListPage` | `ResourceWorkbench` with scope toggle, search, actions |
| `/workflows/[org]/[slug]` | `WorkflowDetailPage` | `WorkflowDetailView` + delete confirmation |
| `/workflows/executions` | `WorkflowExecutionListPage` | `ResourceWorkbench` for all executions |

Client-side navigation uses `WorkflowNavigationProvider`, following the `LibraryNavigationProvider` pattern for virtual routing within the workflow section.

### Sidebar and Navigation

Added "Workflows" as a top-level sidebar entry (between Library and Runners) with the `Workflow` Lucide icon. This placement reflects the user's decision to elevate workflows to peer status with the Library, not nest them under it.

### Type Safety Extensions

- Added `"workflow"` to `DeletableResourceKind` in `useDeleteResource.ts` with the corresponding switch case
- Fixed `ValidationState` usage (proto enum, not string) in `WorkflowDetailView`
- Fixed `optional` field access (proto field is `optional: bool`, not `required`)

## Benefits

- **Workflows visible**: Users can browse, search, filter, and inspect workflows in the web console
- **Execution monitoring**: Workflow executions are listed with phase badges, duration, and timestamps
- **SDK-embeddable**: All hooks and components are in `@stigmer/react`, usable by platform builders outside the console
- **Consistent UX**: Workflows use the same `ResourceWorkbench`, `ResourceDetailShell`, and action patterns as Agents and MCP Servers
- **Full codegen parity**: `WorkflowClient.list()` now works identically to `AgentClient.list()` across all 4 SDK languages

## Impact

- **End users**: Can discover, inspect, and manage workflows through the web console for the first time
- **Platform builders**: Can embed workflow UI components in their own applications via `@stigmer/react`
- **SDK consumers**: `WorkflowClient.list()` available in Go, TypeScript, Python, and Java
- **Architecture**: Validates that the SDK-first pattern scales cleanly to new resource types

## Related Work

- **T02-T07** (Phase 0): Proto contracts this UI is built on — task types, schema registry, budgets, events, artifacts
- **T09** (next): Execution Viewer — will consume the execution list and phase badges built here
- **T13** (upcoming): Backend Implementation — will validate that SearchService indexing works for workflows

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
