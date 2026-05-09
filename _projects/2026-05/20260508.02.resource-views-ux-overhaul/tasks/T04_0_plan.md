# Task T04: Phase 3 — Creation/Edit Modernization

**Created**: 2026-05-09 14:00
**Status**: PENDING REVIEW
**Type**: Feature (Phase 3 of 5)

**This plan requires your review before execution**

## Context

Phases 0, 1, and 2 built the foundation — status tokens, empty states, action menus, the `ResourceWorkbench` (table/card/list views, filters, sort, bulk actions), the `ResourceDetailShell` (tabbed detail hubs with action bars, confirm dialogs, delete flows), and the `Tabs` component. Phase 3 transforms Stigmer from a **read-only resource browser** into a **full resource authoring platform**.

Today, the only way to create or edit Agents, Skills, and MCP Servers is through the CLI (`stigmer apply`, `stigmer push skill`) or through the AI chat flow (the "Add Agent" button routes to a draft session). There is no form-based creation, no visual editor, no import dialog, and no template gallery in the Console or SDK.

### What exists today that Phase 3 builds on

| Existing code | What it does | Phase 3 relevance |
|---|---|---|
| `parseResourceYaml` / `serializeResourceYaml` | Round-trip YAML serialization for Agent and McpServer resources | Import/export foundation — already handles snake_case/camelCase conversion |
| `useApplyResource` | Applies parsed YAML to an org via `stigmer.agent.apply()` / `stigmer.mcpServer.apply()` | Backend write path already works — Phase 3 forms call the same apply methods |
| `useAgentSetup` / `agentSetupReducer` | Agent selection + env var resolution state machine (idle → resolving → needsEnvVars → ready) | Pattern to follow — `useReducer` + typed discriminated union for multi-step flows |
| `useMcpServerSetup` / `mcpServerSetupReducer` | Multi-server credential orchestration (loading → needsSetup → ready) | Same pattern, but for multi-entry state |
| `McpServerConnectDialog` | OAuth connect flow for MCP servers | Existing MCP auth UI — Phase 3 wraps this into the creation flow |
| `ResourceWorkbench` | Collection browsing with no create action slot | Needs a `headerAction` prop for the "Create" button |
| `ResourceDetailShell` + `ResourceActionBar` | Detail page layout with primary + overflow actions | Edit flows launched from the detail page "Edit" action |
| `CreateApiKeyForm`, `CreateOrganizationForm` | Existing form components in the SDK | Pattern examples for SDK-first form components |

## Design Decision: Where the "Create" Action Lives

**Recommendation: Workbench header slot + route-based creation page.**

### The rationale

The creation entry point must satisfy three contexts simultaneously:

1. **Empty state** — A new user with zero agents sees the empty state and needs a prominent "Create agent" CTA. This already exists in the workbench (`emptyTitle` + `emptyDescription`) but lacks an action button.

2. **Populated list** — A user with 50 agents needs a persistent "Create" button that is always visible, not buried in a menu. It should be in the toolbar area, not floating above the workbench in the page header.

3. **Command palette** (Phase 5) — "Create agent" will be a palette command that routes to the same destination.

**Why the button belongs IN the workbench, not above it:**

Right now, `AgentListPage` has a page-level header with "Add Agent" above the workbench. This creates two problems:
- The workbench's empty state shows "No agents yet" but the only CTA is a separate link far above it — poor proximity (Fitts's Law).
- Platform builders embedding `ResourceWorkbench` into their own apps would need to separately add a create button. The workbench should be self-contained.

The workbench should accept an optional `headerAction` prop (a `ReactNode` slot) that it renders in its toolbar, right-aligned next to the view mode switcher. This keeps the workbench self-contained for SDK consumers while giving the Console a natural place for "Create agent."

**Why the creation flow should be a dedicated route, not a dialog:**

- Agent creation is complex — the research report identifies 8 wizard steps (Basics → Instructions → Model/Runtime → Tools → Skills → Env Vars → Test → Review). A dialog cannot hold this.
- A route (`/library/agents/new`) supports deep linking, browser back/forward, and URL sharing ("here, finish setting up this agent").
- This matches the patterns of Vercel (`/new`), Supabase (table creation page), Stripe (product creation page), and Cloudscape (multi-page create pattern).
- Simpler resources (quick skill upload, MCP server from marketplace) can use a dialog as a shortcut that pre-fills and routes to the full page, but the full page is the canonical creation surface.

**The flow:**

```
Workbench "Create" button
  → Routes to /library/agents/new (Console)
  → or opens an onCreateClick callback (SDK — consumer decides)

The creation page renders the wizard component from @stigmer/react
  → <AgentCreationWizard onComplete={...} onCancel={...} />
```

This keeps the SDK clean: the wizard component is framework-agnostic (no Next.js routing), and the Console handles the route. Platform builders can mount the wizard anywhere they want.

## Phase 3 Sub-Tasks

Phase 3 is decomposed into 7 independently pickable sub-tasks. Each builds on the existing SDK architecture and can be implemented in isolation. Dependencies between sub-tasks are noted — you can pick any task whose dependencies are met.

```
T04-A: ResourceWorkbench creation slot          (no dependencies)
T04-B: Agent creation wizard                    (depends on T04-A)
T04-C: Skill editor with preview                (no dependencies)
T04-D: MCP server creation/config editor        (depends on T04-A)
T04-E: YAML/JSON import/export                  (no dependencies)
T04-F: Template gallery                         (depends on T04-B, T04-D)
T04-G: AI sidecar for forms                     (depends on T04-B, T04-C; needs backend)
```

---

### T04-A: ResourceWorkbench Creation Slot

**Effort**: S (1 session)
**Dependencies**: None
**Backend required**: No

**What**: Add an optional `headerAction` prop to `ResourceWorkbench` that renders in the toolbar area, and add an `emptyAction` prop to the empty state for the primary CTA button. Wire up `AgentListPage`, `SkillListPage`, and `McpServerListPage` to use them.

**Why first**: This is the entry point for all creation flows. Every other sub-task routes from here. It is also small, self-contained, and immediately visible.

**Changes**:

| File | Change |
|---|---|
| `sdk/react/src/resource-workbench/components/ResourceWorkbench.tsx` | Add `headerAction?: ReactNode` prop, render right-aligned in toolbar. Add `emptyAction?: ReactNode` prop, render as CTA button in the empty state. |
| `sdk/react/src/resource-workbench/types.ts` | No type changes needed — props are on the component. |
| `client-apps/web/src/domain/library/agents/AgentListPage.tsx` | Replace the page-level "Add Agent" link with `headerAction={<CreateButton />}` and `emptyAction={<CreateButton />}` on the workbench. Route to `/library/agents/new`. |
| `client-apps/web/src/domain/library/skills/SkillListPage.tsx` | Same pattern — route to `/library/skills/new`. |
| `client-apps/web/src/domain/library/mcp-servers/McpServerListPage.tsx` | Same pattern — route to `/library/mcp-servers/new`. |

**SDK impact**: Two new optional props on `ResourceWorkbench`. Non-breaking. Platform builders can pass their own create button or omit it entirely.

---

### T04-B: Agent Creation Wizard

**Effort**: XL (3-4 sessions)
**Dependencies**: T04-A (for the entry point)
**Backend required**: No (uses existing `stigmer.agent.apply()`)

**What**: Build a multi-step agent creation wizard as an SDK component (`AgentCreationWizard`) with a corresponding Console page (`/library/agents/new`). Also build the shared wizard infrastructure that other creation flows will reuse.

**Research report reference**: Section 5.2 — "Use a progressive wizard for Agents."

**Wizard steps** (from research report, adapted):

| Step | Fields | Complexity |
|---|---|---|
| 1. Basics | Name, slug (auto-generated), description, icon URL, visibility | Simple form |
| 2. Instructions | System prompt / instructions editor (plain textarea initially, CodeMirror later) | Medium — needs adequate height, word count |
| 3. Model & Runtime | Model selector (from model registry), temperature, max tokens, runner pool (optional) | Medium — reuses `useModelRegistry` |
| 4. Tools | MCP server picker + tool selector (reuse existing `McpServerPicker`, `McpToolSelector`) | Complex — composes existing components |
| 5. Skills | Skill picker (reuse existing `SkillPicker`) | Simple — reuses existing component |
| 6. Environment | Env var declarations (key, description, isSecret, optional flags) | Medium — key-value editor |
| 7. Review & Create | YAML preview of the full agent config, create button | Medium — reuses `serializeAgentYaml` |

**Architecture**:

```
sdk/react/src/resource-creation/
  types.ts                     — WizardStep, WizardState, shared form types
  WizardShell.tsx              — Reusable multi-step wizard layout (steps sidebar + content + nav)
  WizardNav.tsx                — Back / Next / Create buttons with step validation
  StepIndicator.tsx            — Visual step progress indicator
  useWizardState.ts            — useReducer state machine for wizard navigation + data accumulation
  index.ts                     — barrel exports

sdk/react/src/agent/
  AgentCreationWizard.tsx      — Agent-specific wizard composing WizardShell + agent steps
  steps/
    BasicsStep.tsx             — Name, description, icon, visibility
    InstructionsStep.tsx       — Instructions editor
    ModelStep.tsx              — Model selector, temperature, max tokens
    ToolsStep.tsx              — MCP server + tool selection (composes McpServerPicker)
    SkillsStep.tsx             — Skill selection (composes SkillPicker)
    EnvVarsStep.tsx            — Env var declarations editor
    ReviewStep.tsx             — YAML preview + create action
  useCreateAgent.ts            — Mutation hook wrapping stigmer.agent.apply()
  index.ts                     — re-export AgentCreationWizard, useCreateAgent

client-apps/web/
  src/app/library/agents/new/page.tsx   — Console route mounting AgentCreationWizard
```

**Shared wizard infrastructure** (`resource-creation/`):

The `WizardShell` is a reusable layout for any multi-step creation flow. It renders:
- A left sidebar with step names and completion indicators
- A content area for the active step
- Bottom navigation (Back / Next / Create)
- Step validation — "Next" is disabled until the current step passes validation

This shell will be reused by T04-D (MCP server creation) and any future wizard flows.

**Key design decisions to make during implementation**:
- Whether step data is accumulated in wizard state or in individual step components (recommendation: wizard-level `useReducer` with per-step data slices — same pattern as `agentSetupReducer`)
- Whether to support "skip optional steps" or enforce linear progression (recommendation: linear with optional steps visually marked but not skippable — reduces cognitive load)
- How to handle the edit flow (editing an existing agent) — recommendation: same wizard populated with existing data, "Save changes" instead of "Create"

**SDK impact**: New public exports: `AgentCreationWizard`, `useCreateAgent`, `WizardShell`, `WizardNav`, `StepIndicator`, `useWizardState`. All embeddable by platform builders.

---

### T04-C: Skill Editor with Preview

**Effort**: L (2-3 sessions)
**Dependencies**: None
**Backend required**: No (uses existing `stigmer.skill.push*()`)

**What**: Build a split-pane skill editor that lets users write/edit Markdown content with a live rendered preview. Also support skill creation (write from scratch, upload file, import from Git).

**Research report reference**: Section 5.3 — "Skill creation/edit."

**Layout**: Left pane: Markdown editor. Right pane: Rendered preview. Bottom: validation status, word count.

**Components**:

```
sdk/react/src/skill/
  SkillEditor.tsx              — Split-pane editor + preview layout
  SkillEditorToolbar.tsx       — Formatting toolbar (bold, italic, headers, code, link)
  useSkillEditor.ts            — Behavior hook: content state, dirty tracking, save
  useCreateSkill.ts            — Mutation hook wrapping stigmer.skill creation
  useUpdateSkill.ts            — Mutation hook wrapping stigmer.skill update (if API exists)
  index.ts                     — updated exports

client-apps/web/
  src/app/library/skills/new/page.tsx      — Console route for skill creation
  src/app/library/skills/[slug]/edit/page.tsx — Console route for skill editing
```

**Editor choice**: Start with a `<textarea>` + Markdown preview (using existing `react-markdown` from the SDK). Defer CodeMirror 6 integration to a later enhancement. Rationale: CodeMirror is a heavy dependency (DD-013 — lazy load), and a `<textarea>` with live preview is a viable MVP that ships faster and weighs less. CodeMirror can be added as an opt-in upgrade behind `React.lazy`.

**Skill creation entry points** (from research):

| Path | How it works |
|---|---|
| Write from scratch | Opens the editor with an empty document |
| Upload file | File input → reads content → opens editor with content pre-filled |
| Import from Git (deferred) | Requires backend API — not in initial scope |
| Generate with AI (deferred) | Depends on T04-G (AI sidecar) |

**Integration with existing `SkillDetailView`**: The current `SkillDetailView` has a Preview/Source toggle (from Phase 2). The "Edit" primary action on the detail page should route to the edit page, which renders `SkillEditor` pre-populated with the existing content.

**SDK impact**: New public exports: `SkillEditor`, `useSkillEditor`, `useCreateSkill`. Embeddable — a platform builder could let their users create skills from within their own app.

---

### T04-D: MCP Server Creation/Config Editor

**Effort**: XL (3-4 sessions)
**Dependencies**: T04-A (for the entry point)
**Backend required**: Partial (existing `stigmer.mcpServer.apply()` works; marketplace browse may need new API)

**What**: Build a visual MCP server creation and configuration flow. Covers both "connect a new server" (from scratch or marketplace) and "edit an existing server's configuration."

**Research report reference**: Section 5.4 — "MCP server creation/edit."

**Creation modes**:

| Mode | Flow | Priority |
|---|---|---|
| Custom server | URL/transport → auth config → tool discovery → policies | P0 — core flow |
| Import config | Paste or upload YAML → parse → review → create | P0 — reuses `parseResourceYaml` |
| Marketplace connect (deferred) | Browse marketplace → select → OAuth → choose tools | P1 — needs marketplace API |
| AI-assisted (deferred) | Natural language → config | Depends on T04-G |

**Architecture**:

```
sdk/react/src/mcp-server/
  McpServerCreationWizard.tsx  — Wizard composing WizardShell (from T04-B)
  steps/
    ConnectionStep.tsx         — Server type (stdio/http), URL, command, args
    AuthStep.tsx               — OAuth app selection, env var declarations, auth config
    ToolDiscoveryStep.tsx      — Displays discovered tools, enable/disable, approval policies
    ReviewStep.tsx             — YAML preview + create action
  useCreateMcpServer.ts        — Mutation hook wrapping stigmer.mcpServer.apply()
  index.ts                     — updated exports

client-apps/web/
  src/app/library/mcp-servers/new/page.tsx  — Console route
```

**Tool exposure matrix** (from research): On the existing `McpServerDetailView`, add a tool management table showing tool name, schema (viewable), enabled/disabled toggle, and approval policy. This enhances the existing detail page.

**Key considerations**:
- Reuse the existing `McpServerConnectDialog` for the OAuth flow — it already handles the connect/callback cycle
- The creation wizard should support both stdio and HTTP server types with appropriate field sets
- Tool discovery happens after connection config is provided — the wizard fetches discovered tools on the ToolDiscovery step

**SDK impact**: New public exports: `McpServerCreationWizard`, `useCreateMcpServer`. The tool management components enhance the existing `McpServerDetailView`.

---

### T04-E: YAML/JSON Import/Export

**Effort**: L (1-2 sessions)
**Dependencies**: None
**Backend required**: No

**What**: Add "Import YAML/JSON" and "Export YAML/JSON" actions across all resource types. Import creates a new resource from a config file. Export downloads the current resource as a YAML file.

**Research report reference**: Section 5.5 — "Import/export and GitOps."

**What already exists**:
- `parseResourceYaml()` — parses Agent and McpServer YAML into SDK input types
- `serializeAgentYaml()` / `serializeMcpServerYaml()` — serialize proto resources to YAML
- `useApplyResource()` — applies parsed YAML to an org
- `detectStigmerResource()` — detects if content is a Stigmer resource YAML

**What needs to be built**:

| Component | Location | What it does |
|---|---|---|
| `ImportResourceDialog` | `sdk/react/src/library/` | Dialog with a text area (paste YAML) + file upload. Detects kind, shows preview, confirms org, applies. |
| `useExportResource` | `sdk/react/src/library/` | Hook that serializes a resource to YAML and triggers a file download (or copies to clipboard). |
| Export action in `ResourceActionBar` | Detail pages | "Export YAML" action added to the kebab overflow menu on agent and MCP server detail pages. |
| Import action in workbench | List pages | "Import YAML" option in the create button dropdown (or as a separate toolbar action). |

**Integration points**:
- `AgentDetailView` — add "Export YAML" to the action menu (uses `serializeAgentYaml`)
- `McpServerDetailView` — add "Export YAML" to the action menu (uses `serializeMcpServerYaml`)
- `AgentListPage` — add "Import" option alongside the create button
- `McpServerListPage` — add "Import" option alongside the create button
- The `ImportResourceDialog` composes `useApplyResource` (already handles the apply RPC)

**SDK impact**: New public exports: `ImportResourceDialog`, `useExportResource`. Non-breaking additions.

---

### T04-F: Template Gallery

**Effort**: L (2 sessions)
**Dependencies**: T04-B (agent wizard), T04-D (MCP server wizard)
**Backend required**: Partial (templates could be static JSON initially, API-backed later)

**What**: Build a template gallery that offers pre-built agent and MCP server configurations as starting points for the creation wizards.

**Research report reference**: Section 5.2 step 1 mentions "template" as a creation entry point.

**Architecture**:

```
sdk/react/src/resource-creation/
  TemplateGallery.tsx          — Grid of template cards with search/filter
  TemplateCard.tsx             — Individual template preview card
  types.ts                     — ResourceTemplate type (name, description, category, config)
  templates/
    agent-templates.ts         — Static agent template definitions
    mcp-server-templates.ts    — Static MCP server template definitions
  useTemplateGallery.ts        — Hook for filtering/searching templates
  index.ts                     — updated exports
```

**How it integrates**:
- The creation page (`/library/agents/new`) shows a **landing screen** before the wizard: "Start from scratch" / "Start from template" / "Import YAML"
- Selecting a template pre-fills the wizard steps with the template's configuration
- The wizard clearly shows which fields came from the template vs. user-edited (for transparency)

**Template format** (static, in-code for MVP):
```typescript
interface ResourceTemplate {
  id: string;
  name: string;
  description: string;
  category: string;       // e.g. "Customer Support", "Code Review", "Data Analysis"
  icon?: string;
  config: AgentInput;     // or McpServerInput — the pre-filled form data
}
```

**Key decision**: Templates are static TypeScript objects bundled in the SDK for the MVP. This avoids a backend dependency and ships fast. A template marketplace backed by an API is a natural evolution but is out of scope for Phase 3.

**SDK impact**: New public exports: `TemplateGallery`, `TemplateCard`, `ResourceTemplate` type. Platform builders can provide their own templates array.

---

### T04-G: AI Sidecar for Forms

**Effort**: XL (4-5 sessions)
**Dependencies**: T04-B (agent wizard), T04-C (skill editor)
**Backend required**: Yes — needs a backend endpoint for AI-assisted generation

**What**: Add an AI assistant panel alongside the creation/editing forms that can generate, suggest, validate, and explain configuration fields. The user stays in control — AI produces suggestions that the user reviews and accepts or modifies.

**Research report reference**: Section 5.1 — "Inside manual flows, include an AI sidecar."

**IMPORTANT: This sub-task has the largest unknowns and requires the most collaboration.**

**Interaction model** (from research):
- The AI sidecar is a persistent panel (right side or bottom) alongside the form
- Users can ask: "Generate initial instructions," "Suggest MCP tools for a GitHub integration," "Validate my env vars," "Explain what this config does"
- AI responses produce **structured patches** — not raw text replacements. The user sees a diff of what would change and accepts or rejects.
- Every AI suggestion is traceable — when version history is added (Phase 4), AI-generated changes are tagged with provenance.

**Architecture (conceptual — needs design discussion)**:

```
sdk/react/src/ai-sidecar/
  AiSidecar.tsx                — Panel layout with prompt input and suggestion cards
  SuggestionCard.tsx           — Shows a proposed change with accept/reject
  useAiSuggestion.ts           — Behavior hook: sends prompt + current form state → receives suggestion
  types.ts                     — AiSuggestion, SuggestionPatch, etc.
  index.ts                     — barrel exports
```

**Open questions that need collaborative resolution**:
1. **Backend API**: What endpoint handles AI suggestions? Is it a new RPC, or does it go through the existing session/execution flow? This needs backend design.
2. **Suggestion format**: How are structured patches represented? JSON Patch (RFC 6902)? A custom format? This affects both the backend response and the frontend diff rendering.
3. **Scope**: Should the sidecar work for ALL resource types, or start with agents only?
4. **Streaming**: Should suggestions stream in (like chat), or arrive as complete responses?
5. **Context**: How much of the current form state is sent to the AI? Full spec? Just the active step?

**Recommendation**: Defer this sub-task until T04-B and T04-C are complete. By then, the form architecture will be stable, and the open questions can be answered with concrete code to reference. Start with a design spike rather than full implementation.

**SDK impact**: New public exports: `AiSidecar`, `useAiSuggestion`. Major feature that requires careful API design — should not be rushed.

---

## Recommended Execution Order

The sub-tasks have a natural progression:

```
Session 1:  T04-A  (Workbench creation slot — small, unblocks everything)
Session 2:  T04-E  (YAML/JSON import/export — builds on existing code, quick win)
Session 3-4: T04-B (Agent creation wizard — the centerpiece, including shared wizard infra)
Session 5-6: T04-C (Skill editor with preview)
Session 7-8: T04-D (MCP server creation wizard)
Session 9:  T04-F  (Template gallery — needs wizards to exist)
Session 10+: T04-G (AI sidecar — needs design spike, backend coordination)
```

But you should pick what feels right. The dependency graph is the constraint, not the order above.

## Principles

1. **SDK-first** — All creation components go in `@stigmer/react`. Console pages are thin wrappers that mount SDK components and handle routing.
2. **Headless-first** — Wizard state hooks (`useWizardState`, `useCreateAgent`) are independently importable. Platform builders who want custom UI use the hooks; those who want drop-in use the styled components.
3. **Incremental, not monolithic** — Each sub-task ships independently. An agent wizard without a template gallery is useful. Import/export without AI sidecar is useful.
4. **Generated types are source of truth** — Form data types derive from `@stigmer/protos` via `@stigmer/sdk`. No hand-written duplicates of `AgentInput`, `McpServerInput`, etc.
5. **Accessible** — All form controls have labels, error messages, and keyboard navigation. Wizard steps are keyboard-navigable. The skill editor supports keyboard shortcuts for formatting.
6. **Themeable** — All components use `--stgm-*` tokens. No hardcoded colors.
7. **No autonomous architecture decisions** — Any surprise encountered during implementation (unexpected API shape, missing backend endpoint, component that doesn't compose cleanly) gets surfaced for discussion. No brute-forcing.

## Success Criteria for Phase 3

- [ ] Users can create an Agent from the Console via a multi-step wizard
- [ ] Users can create/edit a Skill with a live Markdown preview
- [ ] Users can create an MCP Server via a visual configuration wizard
- [ ] Users can import Agent/McpServer configs from YAML/JSON files
- [ ] Users can export existing Agent/McpServer configs as YAML files
- [ ] A template gallery offers starting points for common agent patterns
- [ ] All new components are in `@stigmer/react` with clean public exports
- [ ] All new components work in dark mode and respect `--stgm-*` tokens
- [ ] All new components are keyboard-navigable and screen-reader friendly
- [ ] `make check` (typecheck + lint) passes clean after each sub-task

## Notes

- The deep research report is at `_projects/2026-05/20260508.02.resource-views-ux-overhaul/research.resource-views-ux-overhaul/04.report.gpt.md`
- Phase 2 plan is at `.cursor/plans/phase_2_detail_hubs_cd21ecab.plan.md`
- Phase 1 plan is at `.cursor/plans/t02_resource_workbench_927d6980.plan.md`
- Phase 0 plan is at `_projects/2026-05/20260508.02.resource-views-ux-overhaul/tasks/T01_0_plan.md`
- **IMPORTANT**: Only document in knowledge folders after ASKING for permission

## Review Process

**What happens next**:
1. **You review this plan** — Consider the scope, ordering, dependencies, and the create-action design decision
2. **Provide feedback** — Any concerns, additions, things to defer, or disagreements with the recommendation
3. **Pick a sub-task** — Tell me which T04-X to start with
4. **I'll create a detailed execution plan** for that sub-task (e.g., `T04-A_execution.md`)
5. **Execution begins** — One sub-task at a time, with checkpoints
