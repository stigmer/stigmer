# Fix Visual Workflow Editor: Task Kind Registry Wiring

**Date**: May 16, 2026

## Summary

Fixed three interconnected issues in the visual workflow editor (empty task palette, missing configuration fields, inability to add nodes) by wiring the `TaskKindRegistryContext` into `StigmerProvider`. All three issues traced to a single root cause: the React context that holds task kind metadata was never populated.

## Problem Statement

The visual workflow editor's three-panel layout was non-functional:

### Pain Points

- **Left panel (task palette) stuck in loading**: Showed invisible skeleton placeholders because `isLoading` was permanently `true` — no task kinds were available to drag onto the canvas
- **Right panel showed "No configurable fields"** for all task kinds including `agent_call`, which actually has 6 configurable fields (agent, org, message, env, config, output) with 4 field groups
- **Cannot add new nodes**: With the palette empty, drag-to-create was impossible; the "+" button on edges hardcodes `agent_call` but the newly inserted node showed no configuration either
- Users could not build or edit workflows visually — the entire visual editing experience was broken

## Solution

Added the `TaskKindRegistryContext.Provider` to `StigmerProvider`, fetching task kind metadata from the `/v1/proxy/task-kind-registry` API endpoint at mount time. This follows the identical pattern already established by `useModelRegistryFetch` for the model registry.

## Implementation Details

**Single file changed**: `sdk/react/src/provider.tsx`

- `fetchTaskKindRegistry()` — HTTP fetch to `/v1/proxy/task-kind-registry`, returns `TaskKindDescriptor[]`
- `parseTaskKindRegistryJson()` — Type-safe parsing of the JSON response with validation of categories, field types, and nested field/group structures
- `useTaskKindRegistryFetch()` — React hook with auth token polling (PKCE race condition handling), exponential backoff retries (1s, 2s, 4s), and manual `refetch` for error recovery
- `TaskKindRegistryContext.Provider` wrapping in `StigmerProvider` JSX tree

**No other files needed changes** — the existing consumers were already correctly wired:
- `WorkflowTaskPalette` reads `useTaskKindRegistry().categories` for palette rendering
- `useWorkflowCanvas.getNodeDescriptor()` looks up descriptors by kind
- `WorkflowInspectorPanel` renders `TaskConfigForm` when `descriptor.fields.length > 0`
- `TaskConfigForm` handles all 8 field types (string, int32, float, bool, enum, struct, repeated, map, message)

## Benefits

- Visual workflow editor is now fully functional: palette shows all 19 task kinds organized by category
- Task configuration forms render with appropriate controls for each field type
- Drag-to-create from palette works for any task kind
- "+" button on edges creates nodes with working configuration panels
- Error states are handled gracefully (retry button in palette on fetch failure)

## Impact

- **Users**: Can now build and configure workflows visually — the visual editor experience works end-to-end
- **SDK consumers**: `TaskKindRegistryContext` is automatically populated; no integration changes needed
- **OSS/local mode**: Graceful degradation — if the endpoint is unavailable, the palette shows an error with retry

---

**Status**: Production Ready
**Commit**: `ec8961983`
