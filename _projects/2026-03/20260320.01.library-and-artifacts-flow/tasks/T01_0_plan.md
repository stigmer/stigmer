# Task T01: Library Page + Execution Artifacts Widget + Draft-to-Apply Flow

**Created**: 2026-03-20
**Status**: Planning (pending review)

## Overview

This project adds three interconnected capabilities to the Stigmer web console:

1. **Library** — A first-class navigation destination for browsing and managing Agents, Skills, and MCP Servers, with sub-routes for each resource type.
2. **Execution Artifacts Widget** — A right-sidebar widget (alongside ExecutionProgress and ExecutionCostSummary) that surfaces execution artifacts, detects Stigmer resources via frontend YAML parsing, and offers an "Apply to [org]" CTA.
3. **Draft-to-Apply Flow** — "Create New" actions in the Library launch pre-filled sessions with system agents (agent-creator, skill-creator, mcp-server-creator), producing artifacts that users review and apply from the widget.

The SDK-first architecture applies: hooks and components are built in `@stigmer/react` first, then consumed by `client-apps/web`. Every new component must work identically in the Stigmer Console and when embedded in a third-party application.

---

## Architecture

### Navigation (Sidebar)

```
[Collapse] [OrgSwitcher]
[+ New Session]
───────────
Library                    ← new, above Recents
───────────
Recents
  Session 1
  Session 2
  ...
───────────
[UserMenu]
```

Single sidebar entry "Library" linking to `/library`. Active when any `/library/*` route is matched.

### Routing

| Route | Purpose | Component source |
|---|---|---|
| `/library` | Landing page — three resource cards with counts + "Create New" shortcuts | `client-apps/web` (page) consuming SDK components |
| `/library/agents` | Agent list with search + org/all toggle | `client-apps/web` (page) consuming `AgentListView` from SDK |
| `/library/skills` | Skill list with search + org/all toggle | `client-apps/web` (page) consuming `SkillListView` from SDK |
| `/library/mcp-servers` | MCP Server list with search + org/all toggle | `client-apps/web` (page) consuming `McpServerListView` from SDK |

Sub-routes are URL-shareable, bookmarkable, and support browser back/forward. This follows developer conventions (GitHub, AWS Console, Vercel) where resource type navigation uses distinct URLs — not tabs on a single page (Jakob's Law).

### Data flow

```
┌─────────────────────────────────────────────────────────────┐
│  @stigmer/react (SDK — embeddable)                          │
│                                                             │
│  Hooks (headless — data + behavior):                        │
│    useAgentList(org, scope)    → paginated agent list       │
│    useSkillList(org, scope)    → paginated skill list       │
│    useMcpServerList(org, scope)→ paginated mcp server list  │
│    useResourceCount(org)       → counts for landing page    │
│    useExecutionArtifacts(exec) → artifact list + content    │
│    useApplyResource(org)       → apply parsed resource YAML │
│    useDetectStigmerResource()  → parse YAML, detect kind    │
│                                                             │
│  Components (styled — drop-in):                             │
│    ResourceListView            → generic list for any type  │
│    ArtifactCard                → single artifact preview    │
│    ArtifactsWidget             → right-sidebar widget       │
│    ArtifactPreviewModal        → full YAML preview + apply  │
│    ResourceCountCard           → card with icon + count     │
│    ScopeToggle                 → org/all switch             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  client-apps/web (Console — routing + page layout)          │
│                                                             │
│  Pages:                                                     │
│    /library         → LibraryLanding (3 cards + shortcuts)  │
│    /library/agents  → AgentListPage (uses ResourceListView) │
│    /library/skills  → SkillListPage                         │
│    /library/mcp-servers → McpServerListPage                 │
│                                                             │
│  Layout:                                                    │
│    Sidebar.tsx      → add Library link above Recents        │
│    SessionPage.tsx  → add ArtifactsWidget to right sidebar  │
└─────────────────────────────────────────────────────────────┘
```

### Execution Artifacts Widget (right sidebar)

The widget sits in the session detail page's right sidebar, alongside `ExecutionProgress` and `ExecutionCostSummary`:

```
┌─ Right Sidebar ──────────────────┐
│                                  │
│  ┌─ Progress ─────────────────┐  │
│  │ Phase: running  ████░░ 67% │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌─ Cost ─────────────────────┐  │
│  │ Tokens: 12,450  $0.04      │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌─ Artifacts ────────────────┐  │
│  │                            │  │
│  │ 📄 pr-review-agent.yaml   │  │
│  │    Agent detected          │  │
│  │    [Preview]  [Download]   │  │
│  │    [Apply to my-org]       │  │
│  │                            │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

The widget:
- Appears only when `execution.status.artifacts.length > 0`
- Lists each artifact with name, size, kind
- For each artifact, fetches content via `downloadUrl` and attempts YAML detection
- Detected Stigmer resources show a type badge + "Apply to [org]" CTA
- "Preview" opens the `ArtifactPreviewModal`
- Apply CTA is prominent only when execution is in a terminal phase (completed/failed)
- During streaming, artifacts appear but Apply is secondary (avoids applying intermediate outputs)

### Stigmer Resource Detection (frontend)

```
fetchArtifactContent(artifact.downloadUrl)
       │
       ▼
  Is it YAML?
       │
   ┌───┴───┐
   NO      YES
   │        │
   │        ▼
   │   Parse YAML → check for:
   │     apiVersion: ai.stigmer.agentic/*
   │     kind: Agent | McpServer | Workflow
   │        │
   │    ┌───┴───┐
   │   NO      YES
   │    │       │
   │    │       ▼
   │    │   StigmerResourceArtifact
   │    │   → "Apply to [org]" CTA
   │    │
   │    ▼
   │   GenericArtifact
   │   → "Download" only
   │
   ▼
  Is it a directory artifact?
       │
   ┌───┴───┐
   NO      YES
   │        │
   │        ▼
   │   Contains SKILL.md?
   │        │
   │    ┌───┴───┐
   │   NO      YES
   │    │       │
   │    │       ▼
   │    │   StigmerSkillArtifact
   │    │   → "Push Skill to [org]" CTA
   │    │
   │    ▼
   │   GenericDirectoryArtifact
   │   → "Download ZIP" only
   │
   ▼
  GenericArtifact → "Download" only
```

Detection is resilient: if YAML parsing fails, falls back to generic download. No errors surfaced for non-Stigmer artifacts.

### Apply Action

When user clicks "Apply to [org]":

1. **For Agent/McpServer YAML**: Parse YAML → extract fields → call `stigmer.agent.apply(input)` or `stigmer.mcpServer.apply(input)`
2. **For Skill packages**: Download directory artifact (ZIP) → call `stigmer.skill.push(input)` with the package content
3. Show inline status: applying → success (with link to resource in Library) / error (with message)

### "Create New" Flow (Draft Session)

When user clicks **"+ Create New Agent"** (or Skill, or MCP Server) in the Library:

```
User clicks "Create New Agent"
       │
       ▼
Console creates a new session pre-configured with:
  - agentRef: { org: "stigmer", slug: "agent-creator" }
       │
       ▼
Navigates to / (SessionLauncher) with pre-filled state
  - Agent picker shows "agent-creator" selected
  - Message placeholder: "Describe the agent you want to create..."
       │
       ▼
User types description → sends
       │
       ▼
Regular session flow → /sessions/{id}
       │
       ▼
System agent runs, produces YAML artifact
       │
       ▼
Artifacts widget detects Agent YAML → "Apply to [org]"
       │
       ▼
User clicks Preview → reviews YAML in modal → clicks Apply
       │
       ▼
Agent created. Success state links to /library/agents.
```

This reuses the existing session infrastructure entirely. No new wizard UI. The system agents handle the complexity.

### "Edit" Flow (Phase 2 — Conversation-Based)

For agents and MCP servers (single YAML):
1. User clicks "Edit" on a resource in the Library
2. Console fetches current YAML → attaches as execution attachment
3. Pre-fills session with appropriate system agent + attachment
4. User describes changes → agent produces updated complete YAML → Apply

For skills (multi-file packages):
1. Console fetches complete skill package → attaches all files
2. Pre-fills session with `stigmer/skill-creator` + attachments
3. **Skill-creator agent instructions require writing the COMPLETE updated package** (including unmodified files) to the output directory
4. All files appear as artifacts → complete package can be pushed

This depends on attachment support in the SessionComposer, which is Phase 2 scope.

---

## Resource List View Design

### Flat list with scope toggle

```
┌─────────────────────────────────────────────────────────────┐
│  ← Library / Agents                              [+ Create] │
│                                                             │
│  [Search...                              ] [Org ▾ | All]   │
│                                                             │
│  pr-review-agent            my-org     v1.2   3 mcp  2 sk  │
│  code-analysis-agent        my-org     v1.0   1 mcp  1 sk  │
│  deployment-agent           my-org     v2.1   2 mcp  0 sk  │
│  agent-creator              stigmer    system               │
│  skill-creator              stigmer    system               │
│  mcp-server-creator         stigmer    system               │
│  ...                                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- **Default scope**: Org only (user's resources)
- **"All" scope**: Includes `stigmer` system resources + public resources
- No grouping by org/system — flat list, sorted alphabetically
- Each row shows: name, org, version/tag, dependency counts (where applicable)
- Search uses existing `useAgentSearch` / `useSkillSearch` / `useMcpServerSearch` hooks
- Clicking a row navigates to resource detail (Phase 2; for Phase 1, row is informational only)

### Scope toggle

A segmented control (not a dropdown): `[Org] [All]`

- "Org" = filter to `org == activeOrg`
- "All" = no org filter (shows everything user has access to)
- Persisted in localStorage per resource type: `stigmer:library:{type}:scope`

---

## Artifact Preview Modal

```
┌──────────────────────────────────────────────────────────────┐
│  ✕                                                           │
│                                                              │
│  📄 pr-review-agent.yaml                                     │
│  ┌─ Stigmer Agent detected ─────────────────────────────┐   │
│  │                                                       │   │
│  │  apiVersion: ai.stigmer.agentic/v1                    │   │
│  │  kind: Agent                                          │   │
│  │  metadata:                                            │   │
│  │    name: pr-review-agent                              │   │
│  │    org: my-org                                        │   │
│  │  spec:                                                │   │
│  │    instructions: |                                    │   │
│  │      You are a senior code reviewer...                │   │
│  │    mcp_server_usages:                                 │   │
│  │      - mcp_server_ref:                                │   │
│  │          org: my-org                                  │   │
│  │          slug: github                                 │   │
│  │                                                       │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│                          [Copy]  [Download]  [Apply to org]  │
└──────────────────────────────────────────────────────────────┘
```

- Syntax-highlighted YAML/Markdown (read-only) with scroll for long content
- Resource detection badge at top when Stigmer resource is detected
- Primary CTA: "Apply to [org]" — right-aligned (Fitts's Law)
- Secondary: Copy (to clipboard), Download (save to disk)
- After Apply: success state replaces button with "Applied" + link to resource in Library
- Error state: inline error message with retry
- Keyboard: Escape to close, focus trap (A11y), Tab through actions

---

## Task Breakdown

### Phase 1: Library Pages + Navigation (Foundation)

**Goal**: Ship the Library landing page and resource list pages accessible from the sidebar. Flat lists with search and org/all scope toggle.

#### T01.1 — `useAgentList` data hook
- **File**: `sdk/react/src/agent/useAgentList.ts` (new)
- Wraps `stigmer.agent.list()` with org + scope filtering
- Returns: `{ agents, isLoading, error, refetch, hasMore, loadMore }`
- Supports pagination (cursor-based, matching SDK `ListParams`)
- `scope` parameter: `"org"` (default) or `"all"`

#### T01.2 — `useSkillList` data hook
- **File**: `sdk/react/src/skill/useSkillList.ts` (new)
- Same pattern as `useAgentList` but wraps `stigmer.skill.list()`
- Returns: `{ skills, isLoading, error, refetch, hasMore, loadMore }`

#### T01.3 — `useMcpServerList` data hook
- **File**: `sdk/react/src/mcp-server/useMcpServerList.ts` (new)
- Same pattern, wraps `stigmer.mcpServer.list()`
- Returns: `{ mcpServers, isLoading, error, refetch, hasMore, loadMore }`

#### T01.4 — `useResourceCount` data hook
- **File**: `sdk/react/src/library/useResourceCount.ts` (new)
- Fetches counts for all three resource types in parallel
- Uses `stigmer.agent.list({ org, limit: 0 })` (or equivalent count-only call) for each
- Returns: `{ agentCount, skillCount, mcpServerCount, isLoading }`
- Used by the Library landing page cards

#### T01.5 — `ScopeToggle` component
- **File**: `sdk/react/src/library/ScopeToggle.tsx` (new)
- Segmented control: `[Org] [All]`
- Props: `value: "org" | "all"`, `onChange: (scope) => void`
- Styled with `--stgm-*` tokens, keyboard accessible
- Compact enough for the list header alongside search

#### T01.6 — `ResourceListView` component
- **File**: `sdk/react/src/library/ResourceListView.tsx` (new)
- Generic list component parameterized by resource type
- Props: `items`, `isLoading`, `error`, `onItemClick?`, `renderRow`, `emptyState`
- Handles loading skeletons, error state, empty state
- Search input integrated (controlled by parent)
- `ScopeToggle` integrated
- Keyboard navigable list items (A11y)
- Does NOT handle routing — parent page handles `onItemClick`

#### T01.7 — `ResourceCountCard` component
- **File**: `sdk/react/src/library/ResourceCountCard.tsx` (new)
- Card showing resource type icon + label + count
- Props: `icon`, `label`, `count`, `href?`, `onClick?`
- Loading state (skeleton for count)
- Used on the Library landing page

#### T01.8 — Barrel exports for library module
- **File**: `sdk/react/src/library/index.ts` (new)
- **File**: `sdk/react/src/index.ts` (modify) — add library module exports
- Export all hooks and components from the library module

#### T01.9 — Sidebar update
- **File**: `client-apps/web/src/components/layout/Sidebar.tsx` (modify)
- Add "Library" link between "New Session" and "Recents"
- Icon: `BookOpen` or `Library` from lucide-react
- Active state when pathname starts with `/library`

#### T01.10 — Library landing page
- **File**: `client-apps/web/src/app/library/page.tsx` (new)
- **File**: `client-apps/web/src/app/library/layout.tsx` (new) — shared layout with breadcrumbs
- Three `ResourceCountCard` cards (Agents, Skills, MCP Servers)
- "Create New" shortcuts below cards (one per resource type)
- Uses `useResourceCount` hook
- Clicking a card navigates to the corresponding list route

#### T01.11 — Agent list page
- **File**: `client-apps/web/src/app/library/agents/page.tsx` (new)
- Breadcrumb: Library / Agents
- Uses `useAgentList` + `ResourceListView`
- Agent-specific row rendering: name, org, version, mcp/skill counts
- "+ Create New" button → navigates to pre-filled SessionLauncher

#### T01.12 — Skill list page
- **File**: `client-apps/web/src/app/library/skills/page.tsx` (new)
- Same pattern as agents but for skills
- Skill-specific row: name, org, tag, content hash

#### T01.13 — MCP Server list page
- **File**: `client-apps/web/src/app/library/mcp-servers/page.tsx` (new)
- Same pattern as agents but for MCP servers
- MCP-specific row: name, org, transport type (stdio/http), tool count

### Phase 2: Execution Artifacts Widget + Apply Flow

**Goal**: Ship the artifacts widget in the session right sidebar with Stigmer resource detection and Apply CTA.

#### T02.1 — `useExecutionArtifacts` data hook
- **File**: `sdk/react/src/execution/useExecutionArtifacts.ts` (new)
- Extracts artifacts from `execution.status.artifacts`
- For each artifact: fetches content via `downloadUrl` (text artifacts only, with size guard)
- Returns: `{ artifacts, isLoading }` where each artifact includes `{ meta, content?, detectedResource? }`

#### T02.2 — `useDetectStigmerResource` behavior hook
- **File**: `sdk/react/src/library/useDetectStigmerResource.ts` (new)
- Input: artifact content (string) + artifact kind (file/directory)
- For file artifacts: attempt YAML parse → check `apiVersion` + `kind`
- For directory artifacts: check for SKILL.md presence in the content/manifest
- Returns: `{ isResource: boolean, resourceKind?: "agent" | "mcpServer" | "skill", parsedResource?: object }`
- Resilient: never throws, returns `{ isResource: false }` on parse failure

#### T02.3 — `useApplyResource` behavior hook
- **File**: `sdk/react/src/library/useApplyResource.ts` (new)
- Input: detected resource kind + parsed content + org
- Calls appropriate SDK method:
  - `"agent"` → `stigmer.agent.apply(input)`
  - `"mcpServer"` → `stigmer.mcpServer.apply(input)`
  - `"skill"` → `stigmer.skill.push(input)`
- Returns: `{ apply, isApplying, result, error }`
- `result` includes the created/updated resource ID for linking to Library

#### T02.4 — `ArtifactCard` component
- **File**: `sdk/react/src/execution/ArtifactCard.tsx` (new)
- Renders a single artifact in the widget
- Shows: file name, size, kind badge
- If Stigmer resource detected: resource type badge ("Agent", "Skill", "MCP Server")
- Actions: "Preview" button, "Download" link
- If Stigmer resource + execution terminal: "Apply to [org]" primary CTA
- If Stigmer resource + execution still running: Apply shown but secondary/disabled
- Apply status: idle → applying (spinner) → applied (success + link) → error (message + retry)

#### T02.5 — `ArtifactPreviewModal` component
- **File**: `sdk/react/src/execution/ArtifactPreviewModal.tsx` (new)
- Full-screen modal with artifact content
- Syntax-highlighted YAML/Markdown (use a lightweight highlighter — `prismjs` or similar)
- Resource detection badge at top
- Actions at bottom: Copy, Download, Apply to [org]
- Keyboard: Escape to close, focus trap, Tab through actions
- Scroll for long content
- Themed via `--stgm-*` tokens

#### T02.6 — `ArtifactsWidget` component
- **File**: `sdk/react/src/execution/ArtifactsWidget.tsx` (new)
- Container for `ArtifactCard` list
- Collapses when no artifacts
- Header: "Artifacts" with count badge
- Scrollable when many artifacts
- Props: `executionId`, `org`, `isTerminal` (from parent execution state)

#### T02.7 — Barrel exports
- **File**: `sdk/react/src/execution/index.ts` (modify) — add artifact exports
- **File**: `sdk/react/src/index.ts` (modify) — re-export artifact components

#### T02.8 — SessionPage integration
- **File**: `client-apps/web/src/app/sessions/[id]/SessionPage.tsx` (modify)
- Add `ArtifactsWidget` to the right sidebar panel below `ExecutionCostSummary`
- Wire `executionId` and `org` from session context
- Widget renders only when artifacts exist

### Phase 3: "Create New" Draft Flow

**Goal**: "Create New" buttons in Library launch pre-filled sessions with system agents.

#### T03.1 — Pre-filled session navigation helper
- **File**: `client-apps/web/src/lib/draft-session.ts` (new)
- Utility: `getDraftSessionUrl(resourceType: "agent" | "skill" | "mcp-server")` → returns URL with query params
- Maps resource type to system agent ref:
  - `"agent"` → `{ org: "stigmer", slug: "agent-creator" }`
  - `"skill"` → `{ org: "stigmer", slug: "skill-creator" }`
  - `"mcp-server"` → `{ org: "stigmer", slug: "mcp-server-creator" }`
- Encodes agent ref as query params on `/` (home/SessionLauncher)

#### T03.2 — SessionLauncher pre-fill support
- **File**: `client-apps/web/src/components/session/SessionLauncher.tsx` (modify)
- Read query params on mount: `?draft=agent` (or `skill`, `mcp-server`)
- If draft param present: auto-select the system agent in the AgentPicker
- Clear query params after consuming (avoid stale state on refresh)

#### T03.3 — Wire "Create New" buttons in Library pages
- **Files**: `client-apps/web/src/app/library/agents/page.tsx`, `skills/page.tsx`, `mcp-servers/page.tsx` (modify)
- **File**: `client-apps/web/src/app/library/page.tsx` (modify)
- "Create New" buttons use `getDraftSessionUrl()` to navigate to pre-filled SessionLauncher

---

## SDK Placement Summary

### New hooks (7) — all in `@stigmer/react`

| Hook | Module | Purpose |
|---|---|---|
| `useAgentList` | `agent/` | Paginated agent list with scope |
| `useSkillList` | `skill/` | Paginated skill list with scope |
| `useMcpServerList` | `mcp-server/` | Paginated MCP server list with scope |
| `useResourceCount` | `library/` | Resource counts for landing page |
| `useExecutionArtifacts` | `execution/` | Artifact list with content fetching |
| `useDetectStigmerResource` | `library/` | YAML parsing + Stigmer resource detection |
| `useApplyResource` | `library/` | Apply detected resource to org |

### New components (6) — all in `@stigmer/react`

| Component | Module | Purpose |
|---|---|---|
| `ScopeToggle` | `library/` | Org/All segmented control |
| `ResourceListView` | `library/` | Generic resource list with search + scope |
| `ResourceCountCard` | `library/` | Landing page card with count |
| `ArtifactCard` | `execution/` | Single artifact in widget |
| `ArtifactsWidget` | `execution/` | Right-sidebar artifact container |
| `ArtifactPreviewModal` | `execution/` | Full preview modal with Apply |

### New pages (5) — in `client-apps/web`

| Page | Route | Purpose |
|---|---|---|
| Library landing | `/library` | Three cards + shortcuts |
| Agent list | `/library/agents` | Agent resource list |
| Skill list | `/library/skills` | Skill resource list |
| MCP Server list | `/library/mcp-servers` | MCP server resource list |
| Library layout | `/library/layout.tsx` | Shared breadcrumb layout |

### Modified files (4)

| File | Change |
|---|---|
| `sdk/react/src/index.ts` | Add library + artifact exports |
| `client-apps/web/src/components/layout/Sidebar.tsx` | Add Library link |
| `client-apps/web/src/app/sessions/[id]/SessionPage.tsx` | Add ArtifactsWidget |
| `client-apps/web/src/components/session/SessionLauncher.tsx` | Pre-fill support |

---

## Execution Order

Phase 1 (Library pages) and Phase 2 (Artifacts widget) are **independent** and can be built in parallel.

Phase 3 (Draft flow) depends on:
- Phase 1 (Library pages with "Create New" buttons)
- Phase 2 (Artifacts widget to review/apply the output)
- The existing AgentPicker in SessionComposer (already shipped)

Recommended order: **Phase 1 + Phase 2 in parallel → Phase 3**

---

## Future Phases (Not in Scope)

### Phase 4: Edit Flow + Attachments
- Attachment support in SessionComposer (`useUploadAttachment` hook, attachment UI)
- "Edit" button on resource detail → auto-attached edit session
- Skill-creator agent instruction updates for complete package output
- Depends on attachment infrastructure

### Phase 5: Resource Detail View
- `/library/agents/{slug}`, `/library/skills/{slug}`, `/library/mcp-servers/{slug}`
- Read-only detail: YAML view, metadata, dependency graph, recent sessions
- YAML editing via conversation ("Edit" button → draft session with attachment)
- Version history / diff viewer

### Phase 6: Marketplace / Public Discovery
- Browse public resources from other orgs
- Import/fork resources into user's org
- Ratings, usage stats, documentation

---

## Open Questions

1. **Resource count API**: Does `agent.list({ limit: 0 })` return a total count without fetching resources? If not, we may need a lightweight count endpoint or fall back to `list({ limit: 1 })` and use the total from the response metadata. Need to verify the `ListResult` type from `@stigmer/sdk`.

2. **Artifact content size guard**: When fetching artifact content for YAML detection, we should impose a size limit (e.g., skip content fetch for artifacts > 1MB). What's a reasonable threshold? Most agent/MCP YAML files are <10KB, so 256KB should be generous without risking browser memory issues.

3. **YAML parser for browser**: We need a YAML parser that works in the browser. Options: `yaml` (npm package, ~50KB gzipped, full spec), `js-yaml` (~30KB, widely used). Recommendation: `yaml` — it's the modern choice with better TypeScript types and full YAML 1.2 support.

4. **Syntax highlighting**: For the ArtifactPreviewModal, we need YAML/Markdown highlighting. Options: `prismjs` (~10KB core + language), `highlight.js` (~30KB), `shiki` (heavy but beautiful). Recommendation: `prismjs` — lightweight, sufficient for preview, and we can add languages incrementally.

5. **Skill directory artifact detection**: For directory artifacts (ZIP), detecting SKILL.md requires either: (a) downloading and inspecting the ZIP contents in the browser, or (b) having the backend include a file manifest in the artifact metadata. Option (b) is cleaner but requires a backend change. For Phase 1, we could use option (a) with a size guard, or flag all directory artifacts generically.

---

## Design Decisions to Record

- **DD-001**: Library above Recents in sidebar (primary affordance > temporal context)
- **DD-002**: Sub-routes over tabs for resource types (URL shareability, Jakob's Law)
- **DD-003**: Flat list with scope toggle over grouped-by-org (simplicity, reduced cognitive load)
- **DD-004**: Frontend resource detection over backend (isolation, no backend changes needed)
- **DD-005**: Modal for artifact preview over slide-over (decision gate pattern, focused review)
- **DD-006**: Draft sessions reuse existing session infra (no new wizard UI, SDK-aligned)
- **DD-007**: Agent writes complete package for skill edits (avoids partial update problem)

---

## Notes

- Every new hook must include JSDoc documenting its purpose, return type, and usage example
- Every new component must use `--stgm-*` tokens exclusively (no hardcoded colors/sizes)
- All components must be keyboard navigable and screen-reader compatible
- The `library/` module in `@stigmer/react` is new — define its barrel exports carefully as a public API contract
- Resource detection logic must be defensive: malformed YAML, missing fields, and unexpected artifact content must all gracefully fall back to generic artifact display

## Review Process

**What happens next**:
1. **You review this plan** — consider the architecture, phasing, and design decisions
2. **Provide feedback** — concerns, changes, missing requirements
3. **I'll revise the plan** — incorporating your feedback
4. **You approve** — explicit go-ahead
5. **Execution begins** — tracked in T01_3_execution.md

**Please consider**:
- Does the three-phase breakdown align with your priorities?
- Is the SDK placement correct for each hook/component?
- Are the open questions blocking, or can we make default choices and iterate?
- Any concerns about the artifact detection approach (frontend YAML parsing)?
- Does the "Create New" flow via pre-filled SessionLauncher feel right?
