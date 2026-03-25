# Resource Visibility Toggle — Full-Stack Implementation

**Date**: March 25, 2026

## Summary

Added a dedicated `updateVisibility` RPC to Skill, Agent, and MCP Server command controllers across the entire stack — proto definitions, Go backend (OSS), Java backend (Cloud with FGA integration), generated SDK clients (TypeScript, Go, Python, Java), React SDK hooks and components, and Console wiring. This enables users to toggle resources between private and public visibility directly from the web UI.

## Problem Statement

Skills applied via seed pack default to `visibility_private`, and there was no mechanism anywhere in the platform to change a resource's visibility after creation. The existing full-resource `update` RPCs on Agent and McpServer could technically carry a visibility change, but Skill had no `update` RPC at all (it's artifact-versioned via `push`), and the existing Agent/McpServer update handlers in the Java Cloud backend did not sync FGA authorization tuples when visibility changed — a latent bug.

### Pain Points

- No way to make skills public after uploading them via seed pack or CLI push
- No dedicated visibility management API — relying on full-resource updates risks read-modify-write race conditions
- FGA tuples were not synced when visibility changed via existing Agent/McpServer update RPCs (Cloud authorization bug)
- Read-only "Public" badges in detail views with no interactive controls

## Solution

Introduced a targeted `updateVisibility` RPC on all three resource command controllers, following the existing `updateDiscoveredCapabilities` pattern on McpServer. This avoids conflicts with Skill's artifact-versioned model, prevents race conditions on Agent/McpServer, and provides a clean place to wire FGA tuple management.

## Implementation Details

### Proto Layer (apis/)
- Added `UpdateVisibilityInput` message to `commons/apiresource/io.proto` with `resource_id` (required) and `visibility` (validated enum, rejects unspecified)
- Added `updateVisibility` RPC to `SkillCommandController`, `AgentCommandController`, and `McpServerCommandController` with `can_edit` authorization
- Ran `make protos` in both `stigmer` and `stigmer-cloud` repos — regenerated stubs across Go, Java, TypeScript, Python, Dart

### Go Backend (stigmer-server)
- Created `update_visibility.go` in each controller package (skill, agent, mcpserver)
- Pipeline: validate proto → load by ID → set visibility → update audit fields → persist → index search
- Follows the existing `UpdateDiscoveredCapabilities` pattern with context-key-based state passing

### Java Backend (stigmer-cloud)
- Created `SkillUpdateVisibilityHandler`, `AgentUpdateVisibilityHandler`, `McpServerUpdateVisibilityHandler`
- Each extends `CustomOperationHandlerV2<UpdateVisibilityInput, T>` with inner step classes
- Pipeline: validate → load → authorize (FGA can_edit) → set visibility → persist → update FGA tuples → transform → send
- FGA tuple management: creates `resource#viewer@identity_account:*` on PRIVATE→PUBLIC, deletes on PUBLIC→PRIVATE

### FGA Bug Fix (stigmer-cloud)
- Wired `updateSteps.updateVisibilityTuples` into existing `AgentUpdateHandler` and `McpServerUpdateHandler` after the persist step — this was missing, causing FGA tuples to be out of sync when visibility changed via the full-resource update RPC

### React SDK (@stigmer/react)
- `useUpdateVisibility(kind, resourceId)` — behavior hook that calls the correct SDK client method based on resource kind, manages loading/error state
- `VisibilityToggle` — segmented control component (Private/Public) with inline confirmation for publicize action, WAI-ARIA Radio Group, spinner during pending, dark mode support
- Integrated into `SkillDetailView`, `AgentDetailView`, `McpServerDetailView` — when `onVisibilityChange` prop is provided, renders interactive toggle; when omitted, falls back to read-only badge (backward compatible)
- Extended `onResourceLoad` callback to include resource `id` alongside `name`

### Console (client-apps/web)
- Wired `useUpdateVisibility` hook into `SkillDetailPage`, `AgentDetailPage`, `McpServerDetailPage`
- Each page captures `resourceId` from `onResourceLoad`, passes `updateVisibility` and `isPending` to the SDK detail view

## Benefits

- **Users can now manage visibility** for all three resource types from the web console
- **Skills are no longer stuck as private** after seed pack apply
- **No race conditions** — targeted mutation avoids full-resource read-modify-write cycles
- **FGA consistency** — both new and existing update paths now correctly sync authorization tuples
- **Platform builders** can use `useUpdateVisibility` hook and `VisibilityToggle` component independently in embedded UIs
- **Backward compatible** — existing consumers of detail views see no change unless they opt into the new `onVisibilityChange` prop

## Impact

- **Proto**: 4 files changed (1 new message, 3 new RPCs)
- **Generated stubs**: ~80 files regenerated across Go, Java, TypeScript, Python, Dart
- **Go backend**: 3 new handler files
- **Java backend**: 3 new handler files + 2 bug-fix edits
- **React SDK**: 2 new files (hook + component) + 4 files modified (3 detail views + barrel exports)
- **Console**: 3 files modified
- **Total**: ~90 files changed, ~1,800 lines added

## Related Work

- Seed pack behavior is unchanged — skills default to private on push, agents/mcpservers carry their YAML visibility
- The `ScopeToggle` (Org/All) for list filtering remains independent and unchanged
- `UpdateVisibilityTuplesStep` in Java Cloud was already implemented but unwired — now properly integrated

---

**Status**: Production Ready
**Timeline**: Single session implementation
