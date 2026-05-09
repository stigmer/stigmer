# Next Task: 20260508.02.resource-views-ux-overhaul

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260508.02.resource-views-ux-overhaul

**Description**: Transform Stigmer's resource management screens from basic read-only views into state-of-the-art operational hubs. Covers all resource types: Agents, Skills, MCP Servers, Runners, and Settings — with rich list workbenches, tabbed detail pages, manual+AI creation flows, version history, and cross-cutting UX improvements like command palette, keyboard shortcuts, and improved empty states.
**Goal**: Redesign and rebuild all resource management screens in @stigmer/react SDK and the Console to match the quality of best-in-class developer platforms (Vercel, Linear, Supabase, Stripe). Replace the current read-only library views and flat detail pages with a Resource Workbench pattern (table/card/list views, filters, sort, bulk actions, split inspector), tabbed operational detail hubs, dual-path creation (manual forms + AI sidecar), and foundational UX primitives (command palette, action menus, version timelines, dependency graphs).
**Tech Stack**: TypeScript, React 19, @stigmer/react SDK, @stigmer/theme, Tailwind CSS v4, @connectrpc/connect (gRPC), @bufbuild/protobuf, TanStack Table, TanStack Virtual, Radix/React Aria, cmdk, CodeMirror 6, Sonner
**Components**: sdk/react (ResourceWorkbench, ResourceTable, ResourceCards, ResourceList, StatusBadge, FilterBar, ViewSwitcher, BulkActionBar, ResourceInspector, ResourceDetailShell, ResourceActionBar, Tabs, ConfirmDialog, plus all Phase 0 primitives), client-apps/web (library pages, settings pages, runners page, app shell, sidebar), sdk/theme (design tokens, status tokens)

## Current State

- **Status**: In Progress
- **Last Session**: 2026-05-09 — Phase 3 T04-C (Skill Editor with Preview) complete
- **Active Task**: Phase 3 T04-C complete. Next up: T04-D (MCP Server Creation Wizard) or T04-F (Template Gallery, requires T04-D)

## Session Progress (2026-05-09, Session 7)

- Completed Phase 3 sub-task T04-C: Skill Editor with Preview
- Key domain insight: Skills are Anthropic Agent Skills spec directories (not just a single file). The web editor serves the "content author" persona (SKILL.md-only skills — 80% case); complex multi-file skills remain a CLI/Git concern.
- Built `useSkillEditor` behavior hook — content state, metadata form state, dirty tracking, Anthropic spec validation (name format, length limits), frontmatter serialization/parsing with round-trip safety for unknown fields
- Built `usePushSkill` mutation hook — dynamic `import('fflate')` for lazy ZIP creation, packages SKILL.md into a single-entry ZIP artifact, calls `stigmer.skill.push()`
- Built `SkillEditor` component — split-pane layout (textarea editor | live Markdown preview), metadata form (name + description), formatting toolbar (B/I/H/Code/Link/List), keyboard shortcuts (Cmd+B/I/S, Tab indent), 250ms debounced preview with `startTransition`, responsive stacked layout on mobile
- Created Console routes: `/library/skills/new` (create) and `/library/skills/[org]/[slug]/edit` (edit)
- Built `SkillNewPage` and `SkillEditPage` domain components (thin shells mounting SDK component)
- Updated `SkillListPage` "Create skill" button to route to `/library/skills/new` (was `getDraftSessionUrl("skill")`)
- Updated `SkillDetailPage` with "Edit" primary action routing to `/library/skills/[org]/[slug]/edit`
- Added `fflate ^0.8.2` (MIT, ~13KB gzip) as dependency to `@stigmer/react` — dynamically imported, zero cost unless push is called
- All typecheck + lint pass clean (only pre-existing tsdoc ActionMenu warning)
- Design decision: No new backend RPC needed — existing `push` RPC with browser-side ZIP is architecturally correct since skills ARE packages (even single-file ones)

## Session Progress (2026-05-09, Session 6)

- Completed Phase 3 sub-task T04-B: Agent Creation Wizard
- Built shared `resource-creation/` module: `WizardShell`, `WizardNav`, `StepIndicator`, `useWizardState` (generic reducer-based state machine)
- Built `useCreateAgent` mutation hook wrapping `stigmer.agent.apply()`
- Built `AgentCreationWizard` — 3-step condensed wizard (Identity+Instructions, Capabilities, Review)
- Step 1: name, slug (auto-derived), description, icon, visibility, instructions textarea
- Step 2: collapsible sections for MCP servers (uses existing `McpServerPicker`), skills (uses `SkillPicker`), env var declarations (custom key-value editor)
- Step 3: summary card + full YAML preview using new `serializeAgentInputYaml` utility
- Created Console route at `/library/agents/new` with `AgentNewPage` domain component
- Updated `AgentListPage` create button to route to `/library/agents/new` (was `/?draft=agent`)
- Key architectural discovery: `AgentSpec` proto has NO model field — model selection is a runtime concern, not a blueprint field
- All typecheck + lint pass clean (only pre-existing tsdoc ActionMenu warning)
- Design decisions: DD-T04B-001 through DD-T04B-006 documented in plan

## Session Progress (2026-05-09, Session 5)

- Completed Phase 3 sub-task T04-E: YAML/JSON Import/Export
- Created `useExportResource` hook — headless export with copyYaml, copyJson, downloadYaml, downloadJson + memoized serialized strings
- Created `useImportResource` hook — file reading, format detection (YAML/JSON), validation preview, apply via SDK
- Created `ImportResourceDialog` — native `<dialog>` styled component with file picker, preview card, error display
- Wired export actions into AgentDetailPage and McpServerDetailPage (kebab "export" group)
- Wired import button (Upload icon) into AgentListPage and McpServerListPage workbench toolbars
- Updated SDK barrel exports in `library/index.ts` and root `index.ts`
- All typecheck + lint pass clean (only pre-existing tsdoc ActionMenu warning)
- Design decisions: DD-T04E-001 through DD-T04E-005 documented in plan

## Session Progress (2026-05-09, Session 4)

- Completed Phase 3 sub-task T04-A: ResourceWorkbench Creation Slot
- Added `children?: ReactNode` prop to `EmptyState` (SDK public API — non-breaking)
- Added `headerAction?: ReactNode` and `emptyAction?: ReactNode` props to `ResourceWorkbench`
- Refactored all 3 Console list pages (Agent, Skill, MCP Server) to use the new workbench slots
- Moved "Add X" buttons from page-level headers into the workbench toolbar + empty state CTA
- Buttons still route to existing draft session URLs (will point to `/library/*/new` when T04-B/C/D land)
- All typecheck + lint pass clean (`make check` — only pre-existing tsdoc ActionMenu warning)

## Session Progress (2026-05-09, Session 3)

- Completed full Phase 2 implementation (T03, all 6 sub-tasks)
- Promoted internal `Tabs` component to public SDK API at `sdk/react/src/tabs/`
- Built `resource-detail/` module: `ResourceDetailShell`, `ResourceActionBar`, `ConfirmDialog`, `useCopyResource`, `useConfirmAction`, `useDeleteResource`
- Refactored `AgentDetailView` to use `ResourceDetailShell` with action bar (Edit primary, Copy ID, Copy slug, Delete)
- Refactored `SkillDetailView` to use `ResourceDetailShell` with source/rendered toggle (Preview/Source)
- Added `ResourceActionBar` to `McpServerDetailView` (kept MCP-specific header — lowest-risk approach)
- Created new `RunnerDetailView` + `useRunner` hook + Console route at `/runners/[id]`
- Wired `ConfirmDialog` + `useDeleteResource` across all 4 detail pages with toast feedback
- Fixed lint warnings (opacity modifiers on tokens → dedicated hover tokens)
- All typechecks and lint pass clean across both `@stigmer/react` and `client-apps/web`

## Key Decisions Made (This Session)

- **DD-T04C-001**: No new backend RPC for skill creation. The existing `push` RPC with browser-side ZIP is architecturally correct — skills ARE directory packages, even single-file ones. An `apply`-style RPC would be domain-incorrect.
- **DD-T04C-002**: `fflate` (MIT, ~13KB) added as dependency to `@stigmer/react`, dynamically imported inside `usePushSkill.push()` — zero cost for consumers who only read skills.
- **DD-T04C-003**: The web editor serves "content author" persona (SKILL.md-only, 80% case). Complex multi-file skills are a CLI/Git concern, viewable but not editable on web.
- **DD-T04C-004**: Metadata (name, description) is a form, not raw frontmatter. Users never see YAML — the hook handles serialization. Unknown frontmatter fields are preserved on round-trip.
- **DD-T04C-005**: Single-screen editor (not a wizard). Skills are documents, not multi-step configurations. The `WizardShell` infra is not the right fit here.
- **DD-T04C-006**: Preview uses the same `MARKDOWN_COMPONENTS` + `REMARK_PLUGINS` pipeline as `SkillDetailView` — WYSIWYG fidelity between editor and detail view.
- **DD-T03-001**: ResourceDetailShell receives pre-fetched data via props, not own data fetching — resource-specific hooks already exist with different parameters
- **DD-T03-002**: ConfirmDialog uses native `<dialog>` element for modals — consistent with existing McpServerDetailView BYOA dialog pattern, no new dependency needed
- **DD-T03-003**: McpServerDetailView uses ResourceActionBar directly (not full ResourceDetailShell) — preserves its complex MCP-specific header with validation state, slug display, lastDiscoveredAt
- **DD-T03-004**: Skill source toggle is a view-mode radio group within the content section, not a tab — follows the "tabs earn their place" principle

## Next Steps

1. **T04-D: MCP Server Creation Wizard** — Visual MCP server configuration flow (reuses `WizardShell` from T04-B)
2. **T04-F: Template Gallery** — Depends on T04-B (done) and T04-D
3. **T04-G: AI Sidecar** — Needs backend design spike first

## Context for Resume

- T04-C plan is at `.cursor/plans/t04-c_skill_editor_d5bb689b.plan.md`
- T04-B plan is at `.cursor/plans/t04-b_agent_creation_wizard_2144757f.plan.md`
- T04-E plan is at `.cursor/plans/t04-e_import_export_0a7026b6.plan.md`
- Phase 2 plan is at `.cursor/plans/phase_2_detail_hubs_cd21ecab.plan.md`
- Phase 1 plan is at `.cursor/plans/t02_resource_workbench_927d6980.plan.md`
- Phase 0 plan is at `_projects/2026-05/20260508.02.resource-views-ux-overhaul/tasks/T01_0_plan.md`
- Research report at `_projects/2026-05/20260508.02.resource-views-ux-overhaul/research.resource-views-ux-overhaul/04.report.gpt.md`
- The research report's Phase 3 roadmap (after line 1191) defines the Creation/Edit Modernization deliverables
- `ResourceListView` is deprecated but still in the codebase — can be removed once all references are gone
- The `resource-workbench/` module is the canonical resource collection architecture
- The `resource-detail/` module is the canonical resource detail architecture
- The `resource-creation/` module is the canonical wizard/creation architecture (reusable by T04-D)
- Key discovery: `AgentSpec` proto has no model field — model is a runtime concern at execution/instance level

## Essential Files to Review

### 0z. Skill Editor with Preview (Phase 3 T04-C)
```
sdk/react/src/skill/
  useSkillEditor.ts, usePushSkill.ts, SkillEditor.tsx

client-apps/web/src/app/library/skills/new/page.tsx
client-apps/web/src/app/library/skills/[org]/[slug]/edit/page.tsx
client-apps/web/src/domain/library/skills/SkillNewPage.tsx
client-apps/web/src/domain/library/skills/SkillEditPage.tsx
```

### 0a. Agent Creation Wizard (Phase 3 T04-B)
```
sdk/react/src/resource-creation/
  types.ts, index.ts, useWizardState.ts, WizardShell.tsx, WizardNav.tsx, StepIndicator.tsx

sdk/react/src/agent/
  AgentCreationWizard.tsx, useCreateAgent.ts
  steps/types.ts, steps/IdentityStep.tsx, steps/CapabilitiesStep.tsx, steps/ReviewStep.tsx

client-apps/web/src/app/library/agents/new/page.tsx
client-apps/web/src/domain/library/agents/AgentNewPage.tsx
```

### 0b. Import/Export Module (Phase 3 T04-E)
```
sdk/react/src/library/
  useExportResource.ts, useImportResource.ts, ImportResourceDialog.tsx
```

### 1. Resource Detail Module (Phase 2)
```
sdk/react/src/resource-detail/
  types.ts, index.ts
  ResourceDetailShell.tsx, ResourceActionBar.tsx, ConfirmDialog.tsx
  useCopyResource.ts, useConfirmAction.ts, useDeleteResource.ts
```

### 2. Promoted Tabs Module
```
sdk/react/src/tabs/
  Tabs.tsx, index.ts
```

### 3. Refactored Detail Views
```
sdk/react/src/agent/AgentDetailView.tsx
sdk/react/src/skill/SkillDetailView.tsx
sdk/react/src/mcp-server/McpServerDetailView.tsx
sdk/react/src/runner/RunnerDetailView.tsx (new)
sdk/react/src/runner/useRunner.ts (new)
```

### 4. Console Detail Pages
```
client-apps/web/src/domain/library/agents/AgentDetailPage.tsx
client-apps/web/src/domain/library/skills/SkillDetailPage.tsx
client-apps/web/src/domain/library/mcp-servers/McpServerDetailPage.tsx
client-apps/web/src/domain/runner/RunnerDetailPage.tsx (new)
client-apps/web/src/app/runners/[id]/page.tsx (new route)
```

### 5. Resource Workbench Module (Phase 1)
```
sdk/react/src/resource-workbench/
  types.ts, index.ts
  hooks/useResourceCollection.ts, useResourceFilters.ts, useResourceSelection.ts, useViewPreference.ts
  components/ResourceWorkbench.tsx, ResourceTable.tsx, ResourceCards.tsx, ResourceList.tsx,
            FilterBar.tsx, ViewSwitcher.tsx, BulkActionBar.tsx, ResourceInspector.tsx,
            StatusBadge.tsx, ColumnHeader.tsx, SelectionCheckbox.tsx
```

### 6. Project Documentation
- **README**: `_projects/2026-05/20260508.02.resource-views-ux-overhaul/README.md`

## Knowledge Folders to Check

### Design Decisions
```
_projects/2026-05/20260508.02.resource-views-ux-overhaul/design-decisions/
```

### Coding Guidelines
```
_projects/2026-05/20260508.02.resource-views-ux-overhaul/coding-guidelines/
```

### Wrong Assumptions
```
_projects/2026-05/20260508.02.resource-views-ux-overhaul/wrong-assumptions/
```

### Don't Dos
```
_projects/2026-05/20260508.02.resource-views-ux-overhaul/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any new design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with Phase 3: Creation/Edit Modernization

## Quick Commands

After loading context:
- "Continue with Phase 3" - Start the Creation/Edit Modernization implementation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
