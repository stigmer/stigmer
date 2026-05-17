# Library visibility unification, scope UX, and workflow T03 planning

**Date**: May 12, 2026

## Summary

MCP server detail pages now use the same `ResourceDetailShell` header pattern as agents and skills, with optional slots for richer headers. The visibility control is easier to read at a glance. Library list and composer pickers gained clearer org-vs-community scope behavior, including persisted scope on desktop lists. The bring-workflows project gained an approved T03 task-type plan and updated `next-task.md` for the next implementation batch.

## Problem Statement

Resource visibility looked inconsistent between library detail pages because the MCP server view used a custom header instead of the shared shell. The segmented visibility control made the private state hard to distinguish from the unselected segment. Separately, list and picker scope controls needed a simpler model and durable preferences where appropriate.

### Pain Points

- MCP detail header layout diverged from agent/skill, so visibility sat in a different visual context.
- Private vs public in `VisibilityToggle` was asymmetric (public read clearly; private did not).
- Scope toggling in pickers and lists did not match the mental model or persistence expectations.

## Solution

- Extend `ResourceHeaderMeta` and `ResourceDetailShell` with `nameElement`, `qualifiedSlug`, `headerMetaExtra`, and `headerBanner`; migrate `McpServerDetailView` onto the shell and remove the bespoke header.
- Evolve `VisibilityToggle` with lock/globe affordances and a distinct selected style for private.
- Replace the library `ScopeToggle` segmented control with a single checkbox-style control; wire desktop list pages to `scope-persistence.ts`; let agent/MCP/skill pickers manage scope locally with `ScopeToggle` and default org scope in `SessionComposer`.

## Implementation Details

- **SDK**: `sdk/react/src/resource-detail/types.ts`, `ResourceDetailShell.tsx`, `McpServerDetailView.tsx`, `VisibilityToggle.tsx`, `ScopeToggle.tsx`, `AgentPicker.tsx`, `McpServerPicker.tsx`, `SkillPicker.tsx`, `SessionComposer.tsx`.
- **Web**: `LibraryLanding.tsx`, `McpServerListPage.tsx` (library domain).
- **Desktop**: `AgentListPage.tsx`, `McpServerListPage.tsx`, `SkillListPage.tsx`, new `scope-persistence.ts`.
- **Project**: `_projects/2026-05/20260508.01.bring-workflows-to-foreground/next-task.md`, new `tasks/T03_0_plan.md`.

## Benefits

- Consistent header chrome and visibility placement across agent, skill, and MCP server details.
- Faster recognition of private vs public without changing the toggle API or public-confirmation flow.
- Predictable library scope on desktop and explicit scope in session pickers.

## Impact

- **Users**: Clearer library and session attachment flows; aligned detail headers.
- **Developers**: One shell pattern for new resource types; optional header extension points documented in types.

## Related Work

- Bring Workflows to the Foreground: Phase 0 T03 plan for new workflow task types (`tasks/T03_0_plan.md`).
- Prior unified-visibility design discussion (ResourceDetailShell + `VisibilityToggle`).

---

**Status**: Production ready (pending merge and CI on the integrating branch)  
**Timeline**: Single session bundle (SDK + web + desktop + project docs)
