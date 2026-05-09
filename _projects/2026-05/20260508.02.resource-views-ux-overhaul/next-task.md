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
- **Last Session**: 2026-05-09 (Session 15) — Phase 4 T05-D implemented (multi-file diff viewer)
- **Active Task**: **T05-E** — Backend API Requirements Doc (next). T05-A through T05-D complete.
- **Phase 3 status**: T04-A through T04-F complete. T04-G (AI Sidecar) deferred pending backend spike.
- **Phase 4 status**: T05-A, T05-B, T05-C, and T05-D complete. T05-E remaining.

## Session Progress (2026-05-09, Session 15)

- Completed Phase 4 sub-task **T05-D: Multi-File Diff Viewer for Skill Versions**
- 6 new `--stgm-diff-*` theme tokens (light + dark) mapped to Tailwind via `--color-diff-*`
- Extracted `fetchAndUnpackArtifact()` shared utility; refactored `useSkillArtifact` to use it
- `computeDiff()` and `computeMultiFileDiff()` — pure functions wrapping jsdiff, producing typed hunk/file-level diffs
- 4 new generic diff UI components: `DiffViewer` (accessible table), `DiffFileList` (M/A/D badges), `DiffSummary` (live region), `MultiFileDiffView` (composed with file navigation)
- `useSkillVersions` extended with `getArtifactKey(versionHash)` lookup from proto data
- `useSkillDiff(fromKey, toKey)` — parallel artifact fetch + multi-file diff with 10MB size guard
- `SkillDiffDialog` — native `<dialog>` composing `useSkillDiff` + `MultiFileDiffView`
- `SkillDetailView` wired: `onCompare` → artifact key lookup → open dialog
- Enhanced `VersionTimeline` compare-mode: info bar ("Select another version...") + cancel button + first-selection dashed border + "A" badge
- All new types, hooks, components exported from `@stigmer/react` barrel
- Verify: `npm run typecheck -w @stigmer/react` + `npm run lint -w @stigmer/react` + `npm run lint -w client-apps/web` all clean

## Session Progress (2026-05-09, Session 14)

- Completed Phase 4 sub-task **T05-C: Skill Version Timeline**
- Proto-first approach: Added `ListSkillVersionsInput`, `SkillVersionEntry`, `ListSkillVersionsResponse` messages to `io.proto` and `listVersions` RPC to `query.proto`
- Ran `make codegen` (OSS) and `make protos` (Cloud) — generated TS, Go, Python, Java stubs. `SkillClient.listVersions()` now exists across all SDKs.
- New `version-history/` module in `@stigmer/react` with 4 files: `types.ts`, `VersionTimeline.tsx`, `VersionTimelineEntry.tsx`, `index.ts`
- **`VersionTimeline`** — generic accessible timeline component with WAI-ARIA `role="list"`, loading skeleton, empty state, compare-mode selection support (for T05-D), keyboard navigation
- **`VersionTimelineEntry`** — single row: truncated hash badge, relative time, actor avatar, tag badge, "current" indicator, git provenance with commit link
- **`useSkillVersions`** — data hook using `useFetch` + generated `listVersions` RPC. Maps proto `SkillVersionEntry` to generic `VersionEntry`. Catches gRPC `UNIMPLEMENTED` (code 12) and returns empty state (graceful degradation).
- **`SkillDetailView`** — conditional "Versions" built-in tab (same pattern as Agent's "Dependencies" tab). Tab appears only when `useSkillVersions` returns non-empty data. New `onVersionSelect` prop for consumer navigation.
- All new types, hook, and components exported from `@stigmer/react` barrel
- Verify: `npm run typecheck -w @stigmer/react` + `npm run lint -w @stigmer/react` + `npm run lint -w client-apps/web` all clean

## Session Progress (2026-05-09, Session 13)

- Completed Phase 4 sub-task **T05-B: Agent Dependency Graph**
- New `dependency-graph/` module in `@stigmer/react` with 5 files: `types.ts`, `useDependencyGraph.ts`, `DependencyGraph.tsx`, `DependencyTreeNode.tsx`, `index.ts`
- **`useDependencyGraph`** — pure transformation hook: `AgentSpec` → `DependencyTree`. Memoized, zero fetching. Handles asymmetry where sub-agents reference MCP servers by slug string (`mcpAccess.mcpServer`) vs parent's `ApiResourceReference`.
- **`DependencyGraph`** — accessible CSS tree container with WAI-ARIA tree roles (`role="tree"`, `role="treeitem"`, `role="group"`), arrow-key navigation, `Home`/`End` jump
- **`DependencyTreeNode`** — recursive node component. Root agent node always expands children. Sub-agent nodes are collapsible with chevron. MCP servers and skills are clickable leaf nodes. Kind-specific colored badges using `--stgm-status-*` tokens.
- **`AgentDetailView`** — `AGENT_BUILT_IN_TABS` replaced with dynamic `builtInTabs` memoized on `noDeps`. Conditional "Dependencies" tab appears only when agent has MCP servers, skills, or sub-agents. Single-tab suppression preserved for agents with zero dependencies.
- **`handleNodeClick`** routes `mcp-server` nodes to `onMcpServerClick` and `skill` nodes to `onSkillClick` — reusing existing callbacks, zero Console changes
- All new types, hook, and component exported from `@stigmer/react` barrel
- Verify: `npm run typecheck -w @stigmer/react` + `npm run lint -w @stigmer/react` + `npm run lint -w client-apps/web` all clean

## Session Progress (2026-05-09, Session 12)

- Completed Phase 4 sub-task **T05-A: Detail Page Tabbed Infrastructure**
- Added `AdditionalTab` type (`TabItem` + `content`) in `resource-detail/types.ts`; exported from `resource-detail/index.ts` and root `@stigmer/react` barrel
- Added internal `useDetailTabs` hook — uncontrolled-by-default, controlled when both `activeTab` + `onTabChange`; single-tab suppression (no tab bar until 2+ tabs)
- **`AgentDetailView`**: built-in tab `overview`; props `additionalTabs`, `activeTab`, `onTabChange`, `defaultTab`; wires `ResourceDetailShell` tabs when extensions exist
- **`SkillDetailView`**: built-in tab `content`; extracted `SkillOverview` for main body; same extension API as agent
- Console pages unchanged — zero UI regression until consumers pass `additionalTabs`
- Verify: `npm run lint -w @stigmer/react` + `npm run typecheck -w @stigmer/react` clean (full `make check` still hits pre-existing tsdoc ActionMenu warnings)

## Session Progress (2026-05-09, Session 11)

- Completed Phase 3 sub-task T04-F: Template Gallery
- Built `ResourceTemplate<TData>` generic type with `TemplateCategory` union and `TEMPLATE_CATEGORY_LABELS` map
- Created 5 agent templates: Customer Support, Code Review, Data Analysis, Content Writer, DevOps Assistant
- Created 4 MCP server templates: GitHub, Slack, PostgreSQL, Filesystem
- Built `useTemplateFilter` headless hook — category filtering + text search, memoized, independently importable
- Built `TemplateCard` — clickable card with deterministic colored initial avatar, category badge, keyboard a11y
- Built `TemplateGallery` — searchable card grid with category tabs, arrow-key navigation between tabs
- Built `CreationPicker` — "step 0" landing with scratch/template/import option cards, inline gallery transition
- Added `initialData?: Partial<TData>` prop to both `AgentCreationWizard` and `McpServerCreationWizard`
- Exported `AgentWizardData` and `McpServerWizardData` types from SDK barrel
- Updated Console `AgentNewPage` and `McpServerNewPage` with picking -> wizard state machine
- Removed planned string-based icon field — SDK has zero lucide-react dependency; uses initial avatars instead
- Fixed `hover:bg-accent/50` opacity modifier violations (lint rule `stigmer/no-token-opacity-modifiers`)
- All typecheck + lint pass clean (only pre-existing tsdoc ActionMenu warning)

## Session Progress (2026-05-09, Session 10)

- UX polish pass: resource card icons and form input visibility
- Created `ResourceAvatar` component — icon image with `bg-muted` container + `object-contain`, colored initial fallback, hidden for skills
- Added `--stgm-input-bg` design token to `sdk/theme` (light: white, dark: card-level gray `oklch(0.205)`)
- Mapped as `--color-input-bg` in Tailwind theme → `bg-input-bg` utility class
- Applied `bg-input-bg` to all wizard step form inputs (IdentityStep, CapabilitiesStep, IdentityTransportStep, EnvironmentAuthStep)
- Added token to all 5 theme presets (corporate, fintech, friendly, monochrome, startup)
- Wired `ResourceAvatar` into `DefaultCardContent` and `DefaultRowContent` in `ResourceWorkbench.tsx`
- Exported `ResourceAvatar` and `ResourceAvatarProps` from SDK barrel
- Design rule established: `--stgm-input-bg` is for inputs on page-level backgrounds; inputs inside popovers/dialogs/cards keep `bg-background`
- All typecheck + lint pass clean

## Session Progress (2026-05-09, Session 9)

- Completed Phase 3 sub-task T04-D: MCP Server Creation Wizard
- Architectural decision DD-T04D-001: Blueprint-only wizard — tool discovery stays as a post-creation detail-page concern (blueprint/runtime separation)
- Built `useCreateMcpServer` mutation hook wrapping `stigmer.mcpServer.apply()`
- Built `McpServerCreationWizard` — 3-step wizard reusing shared `WizardShell` from T04-B
- Step 1: IdentityTransportStep — name, slug, description, icon, visibility, transport type radio (HTTP vs Stdio), conditional transport fields
- Step 2: EnvironmentAuthStep — env var declarations + collapsible OAuth auth config
- Step 3: ReviewStep — summary card + YAML preview via `serializeMcpServerInputYaml()`
- Extracted `EnvVarEntry` and `KeyValueEntry` types to shared `resource-creation/types.ts`
- Created Console route `/library/mcp-servers/new` with `McpServerNewPage`
- Updated `McpServerListPage` create button to route to wizard
- All typecheck + lint pass clean (only pre-existing tsdoc ActionMenu warning)

## Session Progress (2026-05-09, Session 8)

- Revised T04-C: Replaced in-browser Skill editor with upload-only flow + file browser
- Key UX decision: Skills are Anthropic Agent Skills spec directory packages. Users author locally (IDE) and upload the finished ZIP. Console is for upload + view, not authoring.
- Removed: `SkillEditor`, `useSkillEditor`, `SkillEditPage`, edit route, "Edit" action from detail page
- Rewrote `usePushSkill` — now accepts raw `Uint8Array` ZIP bytes (simpler, no SKILL.md construction)
- Built `useSkillUpload` — upload validation hook (ZIP magic bytes, SKILL.md extraction, frontmatter parsing, Anthropic spec name/description validation)
- Built `SkillUploader` — two-phase UI (drag-and-drop zone → preview with file list + rendered SKILL.md → confirm push)
- Built `useSkillArtifact` — data hook fetching skill ZIP via `getArtifact` RPC using `status.artifactStorageKey`, unpacks with fflate
- Built `SkillFileBrowser` — file tree + content viewer split pane (Markdown rendered for .md files, raw code for others)
- Updated `SkillDetailView` to show `SkillFileBrowser` when `artifactStorageKey` is available (replaces the simple source/rendered toggle for the full package browser)
- Updated `SkillListPage` button text to "Upload skill"
- All skill-specific files pass typecheck + lint clean

## Session Progress (2026-05-09, Session 7)

- Initial T04-C implementation (Skill Editor with Preview) — subsequently replaced in Session 8

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

- **DD-T05D-001**: `useSkillDiff` takes artifact storage keys directly. Consumer (SkillDetailView) does hash-to-key lookup via `getArtifactKey()`. Keeps diff hook simple and independently usable.
- **DD-T05D-002**: `diff` (jsdiff) as direct dependency (~8KB gzip, MIT). `structuredPatch()` returns hunks with line-level changes.
- **DD-T05D-003**: Multi-file diff with file navigation. SKILL.md prioritized. Summary bar + file list + per-file unified diff.
- **DD-T05D-004**: Shared `fetchAndUnpackArtifact()` extracted. Both `useSkillArtifact` and `useSkillDiff` use it.
- **DD-T05D-005**: Unified diff only in v1. Side-by-side deferred. `DiffViewer` accepts `mode` prop for future extension.
- **DD-T05D-006**: Compare-mode UX — info bar with cancel, dashed border + "A" badge on first selection.
- **DD-T05D-TOKENS**: Diff tokens inherit from `tokens.css`, not per-preset — diff colors carry universal semantic meaning.
- **DD-T05C-001**: Conditional tab visibility — "Versions" only appears when `useSkillVersions` returns non-empty data. Avoids broken state before backend ships.
- **DD-T05C-002**: Generic `VersionEntry` is a presentation-layer type owned by the SDK, not a proto-generated type. The hook maps FROM proto TO generic. This enables reuse across resource types.
- **DD-T05C-003**: `VersionTimeline` supports `onCompare` from day one (for T05-D), but the compare UI is not wired until T05-D ships. The prop exists, the callback fires, but no visual indication of compare-mode selection yet.
- **DD-T05C-004**: Hook catches gRPC UNIMPLEMENTED (code 12) and treats it as empty — not as an error. This is the graceful degradation contract with the backend team.
- **DD-T05C-005**: The `SkillVersionEntry` proto includes `artifact_storage_key` per version — enables T05-D to fetch historical artifacts for diffing without a new RPC.
- **DD-T05B-001**: Dependency graph is a built-in conditional tab in `AgentDetailView`, not a Console `additionalTab`. Data is intrinsic to `AgentSpec`; all SDK consumers benefit; existing click callbacks flow naturally.
- **DD-T05B-002**: CSS tree rendering (not SVG spatial graph). Accessible, responsive, zero-dep, right-sized for typical 3-15 node trees.
- **DD-T05B-003**: No status indicators in v1. Would require N+1 fetches for each referenced resource. Defer until batch status endpoint exists.
- **DD-T05B-004**: Tree semantics, not DAG. Same MCP server in parent and sub-agent shown in both locations — matches user mental model.
- **DD-T05A-001**: Tab state — uncontrolled by default; controlled when both `activeTab` and `onTabChange` are provided (Console can sync to URL later).
- **DD-T05A-002**: Single-tab suppression — no tab strip when only the built-in tab exists (no visual regression).
- **DD-T05A-003**: `additionalTabs` carries both `TabItem` metadata and `content` for consumer-provided panels (T05-B/C mount points).
- **DD-T04F-001**: Creation landing page as "step 0" — local state transition in Console page, not a route change. Consolidates blank/template/import paths.
- **DD-T04F-002**: Templates are static TypeScript objects in the SDK — no backend API, platform builders pass own arrays.
- **DD-T04F-003**: Wizard `initialData` prop merges with defaults via spread — non-breaking, enables template pre-fill and future duplicate flows.
- **DD-T04F-004**: No template provenance tracking yet — deferred to reduce complexity; core value is pre-filling.
- **DD-T04F-ICON**: Removed planned string-based icon field from `ResourceTemplate` — SDK has zero lucide-react dependency; uses deterministic colored initials matching `ResourceAvatar` pattern.
- **DD-INPUT-BG-001**: New `--stgm-input-bg` design token for form input backgrounds — applied via theme tokens, not hardcoded classes. Platform builders can override.
- **DD-AVATAR-001**: ResourceAvatar uses `bg-muted` container + `object-contain` for SVG icons, ensuring visibility regardless of SVG fill color. Skills are hidden (no icon, no placeholder).
- **DD-T04C-001**: Skills are upload-only on web. No in-browser editor. Users author skills locally (IDE with proper tooling) and upload the finished ZIP package. Console role is upload + view, not authoring.
- **DD-T04C-002**: `fflate` (MIT, ~13KB) used for ZIP decompression — reading uploaded ZIPs for validation and reading artifact ZIPs for the file browser.
- **DD-T04C-003**: The upload flow validates against Anthropic spec before push: SKILL.md must exist at root, frontmatter must have valid name (lowercase+hyphens, max 64 chars).
- **DD-T04C-004**: File browser on detail page uses `status.artifactStorageKey` → `getArtifact()` RPC → fflate unzip → navigable file tree with content viewer.
- **DD-T04C-005**: No edit page. No "Edit" action. If users want to update a skill, they modify locally and re-upload.
- **DD-T03-001**: ResourceDetailShell receives pre-fetched data via props, not own data fetching — resource-specific hooks already exist with different parameters
- **DD-T03-002**: ConfirmDialog uses native `<dialog>` element for modals — consistent with existing McpServerDetailView BYOA dialog pattern, no new dependency needed
- **DD-T03-003**: McpServerDetailView uses ResourceActionBar directly (not full ResourceDetailShell) — preserves its complex MCP-specific header with validation state, slug display, lastDiscoveredAt
- **DD-T03-004**: Skill source toggle is a view-mode radio group within the content section, not a tab — follows the "tabs earn their place" principle

## Next Steps

1. ~~**T05-A: Detail Page Tabbed Infrastructure**~~ — Done (Session 12).
2. ~~**T05-B: Agent Dependency Graph**~~ — Done (Session 13). Built-in conditional tab with CSS tree, zero Console changes.
3. ~~**T05-C: Skill Version Timeline**~~ — Done (Session 14). Proto-first: `listVersions` RPC + generic `VersionTimeline` component + conditional built-in tab. Graceful degradation until backend ships.
4. ~~**T05-D: Diff Viewer**~~ — Done (Session 15). Multi-file diff with file navigation, shared artifact utility, generic diff infrastructure, compare-mode UX.
5. **T05-E: Backend API Requirements Doc** — Design spike documenting what backend needs to deliver.

**Deferred**: T04-G (AI Sidecar), Agent/MCP versioning, audit log, usage charts, RBAC.

## Context for Resume

- **Phase 4 plan** is at `_projects/2026-05/20260508.02.resource-views-ux-overhaul/tasks/T05_0_plan.md`
- T04-D plan is at `.cursor/plans/t04-d_mcp_server_wizard_dd816c0c.plan.md`
- T04-C plan is at `.cursor/plans/t04-c_skill_editor_d5bb689b.plan.md`
- T04-B plan is at `.cursor/plans/t04-b_agent_creation_wizard_2144757f.plan.md`
- T04-E plan is at `.cursor/plans/t04-e_import_export_0a7026b6.plan.md`
- Phase 2 plan is at `.cursor/plans/phase_2_detail_hubs_cd21ecab.plan.md`
- Phase 1 plan is at `.cursor/plans/t02_resource_workbench_927d6980.plan.md`
- Phase 0 plan is at `_projects/2026-05/20260508.02.resource-views-ux-overhaul/tasks/T01_0_plan.md`
- Research report at `_projects/2026-05/20260508.02.resource-views-ux-overhaul/research.resource-views-ux-overhaul/04.report.gpt.md`
- Research report dependency graphs section ~line 948, version history ~line 1255
- `ResourceListView` is deprecated but still in the codebase — can be removed once all references are gone
- The `resource-workbench/` module is the canonical resource collection architecture
- The `resource-detail/` module is the canonical resource detail architecture
- The `resource-creation/` module is the canonical wizard/creation architecture (shared by agent + MCP server wizards)
- Key discovery: `AgentSpec` proto has no model field — model is a runtime concern at execution/instance level
- Key discovery: `McpServerAuthInput` is not exported from `@stigmer/sdk` — use `NonNullable<McpServerInput["auth"]>` for auth serialization
- Key discovery: `SkillAuditRepo.findAllBySkillId()` already stores version history — just needs RPC surface
- Key decision: Agent/MCP versioning deferred — GitOps covers most users; validate UX with Skills first
- Key decision: Dependency graph uses CSS tree (not SVG spatial graph) — agents typically have 3-15 dependency nodes; CSS is accessible and responsive
- Key decision: Dependency graph is a built-in conditional tab, not `additionalTab` — intrinsic agent data, all SDK consumers benefit
- The `dependency-graph/` module is the canonical dependency visualization architecture
- The `version-history/` module is the canonical version timeline AND diff architecture (generic — works for any versioned resource)
- The diff infrastructure (`computeDiff`, `computeMultiFileDiff`, `DiffViewer`, `MultiFileDiffView`) is generic and ready for Agent/MCP versioning
- Key discovery: `diff` (jsdiff) v8 ships own TypeScript types — no `@types/diff` needed
- Key decision: Diff theme tokens inherit from `tokens.css`, not per-preset — universal semantic meaning
- T05-D plan is at `.cursor/plans/t05-d_diff_viewer_bfd02016.plan.md`
- T05-C plan is at `.cursor/plans/t05-c_skill_version_timeline_503bef68.plan.md`
- T05-B plan is at `.cursor/plans/t05-b_dependency_graph_4bba9a9f.plan.md`
- Key discovery: `StigmerError.connectCode` preserves the raw gRPC code — use `connectCode === 12` to detect UNIMPLEMENTED
- Key discovery: `make codegen` on OSS generates TS types + all SDK clients; `make protos` on cloud generates Go stubs for backend
- Key decision: Version timeline is generic (`VersionEntry` type) — skill-specific hook maps proto → generic, enabling future Agent/MCP versioning with the same component

## Essential Files to Review

### 0u. Multi-File Diff Viewer (Phase 4 T05-D)
```
sdk/react/src/version-history/
  types.ts (DiffLine, DiffHunk, FileDiffEntry, MultiFileDiffResult)
  computeDiff.ts, computeMultiFileDiff.ts
  DiffViewer.tsx, DiffFileList.tsx, DiffSummary.tsx, MultiFileDiffView.tsx

sdk/react/src/skill/
  internal/fetchAndUnpackArtifact.ts
  useSkillDiff.ts, SkillDiffDialog.tsx
```

### 0v. Skill Version Timeline (Phase 4 T05-C)
```
sdk/react/src/version-history/
  types.ts, VersionTimeline.tsx, VersionTimelineEntry.tsx, index.ts

sdk/react/src/skill/
  useSkillVersions.ts
```

### 0w. Agent Dependency Graph (Phase 4 T05-B)
```
sdk/react/src/dependency-graph/
  types.ts, useDependencyGraph.ts, DependencyGraph.tsx, DependencyTreeNode.tsx, index.ts
```

### 0x. Template Gallery (Phase 3 T04-F)
```
sdk/react/src/resource-creation/
  templates/types.ts, templates/agent-templates.ts, templates/mcp-server-templates.ts, templates/index.ts
  useTemplateFilter.ts, TemplateCard.tsx, TemplateGallery.tsx, CreationPicker.tsx
```

### 0y. MCP Server Creation Wizard (Phase 3 T04-D)
```
sdk/react/src/mcp-server/
  useCreateMcpServer.ts, McpServerCreationWizard.tsx
  steps/types.ts, steps/IdentityTransportStep.tsx, steps/EnvironmentAuthStep.tsx, steps/ReviewStep.tsx

client-apps/web/src/app/library/mcp-servers/new/page.tsx
client-apps/web/src/domain/library/mcp-servers/McpServerNewPage.tsx
```

### 0z. Skill Upload + File Browser (Phase 3 T04-C)
```
sdk/react/src/skill/
  usePushSkill.ts, useSkillUpload.ts, useSkillArtifact.ts
  SkillUploader.tsx, SkillFileBrowser.tsx

client-apps/web/src/app/library/skills/new/page.tsx
client-apps/web/src/domain/library/skills/SkillNewPage.tsx
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
6. [ ] Continue with Phase 4 (T05-E Backend API Requirements Doc — final sub-task)

## Quick Commands

After loading context:
- "Continue with Phase 4 T05-E" - Backend API requirements doc (final sub-task)
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
