# Session Notes: 2026-05-12 — T08: Workflow List and Detail Pages

## Accomplishments

- **T08 COMPLETE** — Built the full Workflow UI layer: list page, detail page (with tabs), and execution list page
- Followed the SDK-first architecture (DD-001) faithfully: data hooks → styled components → thin console shells
- Added Workflows as a top-level sidebar entry, elevating them from invisible backend plumbing to first-class product surface

## Implementation (6 Layers, Bottom-Up)

### Layer 1: Codegen Fix — WorkflowClient.list()
- **Gap discovered**: `WorkflowClient` had no `list()` method — other resources (Agent, Skill, McpServer) used `SearchService` for listing but Workflow was omitted
- **Root cause**: `tools/codegen/proto2schema/main.go` had a `searchListResources` allowlist that didn't include `workflow`
- **Fix**: Added `"workflow": true` to the allowlist + re-ran `make codegen`
- **Files**: `tools/codegen/proto2schema/main.go`, `tools/codegen/schemas/services/workflow.json`
- **Result**: `WorkflowClient.list()` generated across Go, TS, Python, Java SDKs

### Layer 2: React SDK Data Hooks (5 new files)
- `useWorkflow.ts` — single workflow by org/slug via `getByReference()`
- `useWorkflowList.ts` — paginated list via `SearchService` with scope/search
- `useWorkflowCount.ts` — total count for workbench header
- `useWorkflowInstances.ts` — instances for a specific workflow via `getByWorkflow()`
- `useWorkflowExecutionList.ts` — executions (global or per-workflow) with pagination

### Layer 3: React SDK Styled Components (3 new files)
- `WorkflowExecutionPhaseBadge.tsx` — status badges mapping `WorkflowExecutionPhase` enum to color/label
- `WorkflowTaskList.tsx` — compact task display with kind icons from `TaskKindRegistry`
- `WorkflowDetailView.tsx` — composed detail view using `ResourceDetailShell` with 4 tabs (Overview, Tasks, Instances, Executions)

### Layer 4: Web Console Pages (9 new files)
- Route shells: `app/workflows/{layout,page}.tsx`, `[org]/[slug]/page.tsx`, `executions/page.tsx`
- Domain components: `WorkflowListPage`, `WorkflowDetailPage`, `WorkflowExecutionListPage`, `WorkflowLayout`, `workflow-navigation.tsx`, `WorkflowBreadcrumb`

### Layer 5: Sidebar Navigation
- Added top-level "Workflows" entry between Library and Runners using `Workflow` Lucide icon
- Added scope persistence key for workflows

### Layer 6: Barrel Exports + Type Safety
- Updated `sdk/react/src/index.ts` with all new workflow exports
- Extended `useDeleteResource` to support `"workflow"` kind
- Fixed `ValidationState` (enum, not string) and `optional` (not `required`) field access in `WorkflowDetailView`

## Decisions Made

1. **Workflows as top-level sidebar item** (user decision) — not nested under Library, reflecting their importance as a product surface
2. **WorkflowInstance embedded as tab** (user decision) — instances appear on the Workflow detail page's "Instances" tab, not as standalone routes
3. **Export actions deferred** — `useExportResource` only supports Agent and McpServer; no `serializeWorkflowYaml` exists yet, so YAML/JSON export is not wired for workflows
4. **Pagination model**: Workflow execution list uses `totalPages` (not `nextPageToken` cursor-based pagination), matching the proto contract

## Key Code Changes

| File | Change |
|------|--------|
| `tools/codegen/proto2schema/main.go` | Added `workflow` to search-listable resources |
| `sdk/react/src/workflow/` | 8 new files (5 hooks, 3 components) |
| `sdk/react/src/index.ts` | Barrel exports for all workflow hooks/components |
| `sdk/react/src/resource-detail/useDeleteResource.ts` | Added `"workflow"` to `DeletableResourceKind` |
| `client-apps/web/src/app/workflows/` | 4 Next.js route files |
| `client-apps/web/src/domain/workflow/` | 6 domain component files |
| `client-apps/web/src/domain/_shared/layout/Sidebar.tsx` | Workflows sidebar entry |
| `client-apps/web/src/domain/library/scope-persistence.ts` | Workflows scope key |

## Open Questions

- **Search indexing**: Does the backend already index Workflow resources in SearchService? If not, `list()` will return empty results until T13 backend implementation
- **Workflow YAML export**: Should we add `serializeWorkflowYaml` in a future task?

## Next Session Plan

- **T09: Execution Viewer** — timeline, event log, artifact panel (consumes T06 events + T07 artifacts)
- Consider interleaving with **T13: Backend Implementation** if search indexing gaps block T08 verification
