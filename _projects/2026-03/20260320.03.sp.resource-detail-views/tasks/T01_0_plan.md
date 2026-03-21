# Task T01: Resource Detail View Pages

**Created**: 2026-03-20
**Status**: PENDING REVIEW
**Type**: Sub-Project of 20260320.01.library-and-artifacts-flow (Phase 5)

## Objective

Implement read-only detail view pages for the three Library resource types — Agent, Skill, and MCP Server — following the SDK-first architecture. Each resource type gets a data hook in `@stigmer/react`, an embeddable detail view component in `@stigmer/react`, and a Console page in `client-apps/web`.

This is a low-risk, zero-backend-dependency subproject that connects existing infrastructure: the TypeScript SDK already has typed `get`/`getByReference` methods for all three resource types, the list pages already exist with a wired `onItemClick` prop on `ResourceListView`, and the breadcrumb already handles arbitrary URL depth.

---

## Existing Infrastructure (What We're Building On)

### Already built — SDK (`@stigmer/react`)

| Asset | Location | Notes |
|-------|----------|-------|
| `useAgentList` | `sdk/react/src/agent/useAgentList.ts` | Paginated list hook |
| `useSkillList` | `sdk/react/src/skill/useSkillList.ts` | Paginated list hook |
| `useMcpServerList` | `sdk/react/src/mcp-server/useMcpServerList.ts` | Paginated list hook |
| `ResourceListView` | `sdk/react/src/library/ResourceListView.tsx` | Has `onItemClick` prop (not wired by list pages yet) |
| `ScopeToggle` | `sdk/react/src/library/ScopeToggle.tsx` | Org/All toggle |
| `useStigmer()` | `sdk/react/src/hooks/` | Provides typed SDK client |

### Already built — Console (`client-apps/web`)

| Asset | Location | Notes |
|-------|----------|-------|
| Agent list page | `client-apps/web/src/app/library/agents/AgentListPage.tsx` | Uses `useAgentList` + `ResourceListView` |
| Skill list page | `client-apps/web/src/app/library/skills/SkillListPage.tsx` | Same pattern |
| MCP Server list page | `client-apps/web/src/app/library/mcp-servers/McpServerListPage.tsx` | Same pattern |
| Library breadcrumb | `client-apps/web/src/app/library/LibraryBreadcrumb.tsx` | Dynamic from URL segments, handles arbitrary depth |
| Library layout | `client-apps/web/src/app/library/layout.tsx` | Wraps children with `LibraryBreadcrumb` |

### Already built — TypeScript SDK (`@stigmer/sdk`)

| Method | Description |
|--------|-------------|
| `stigmer.agent.getByReference({ org, slug })` | Returns typed `Agent` with full spec + status |
| `stigmer.skill.getByReference({ org, slug, version? })` | Returns typed `Skill` with spec + status |
| `stigmer.mcpServer.getByReference({ org, slug })` | Returns typed `McpServer` with spec + status |

### Gap: What's Missing

1. **No single-resource data hooks** — `useAgent(org, slug)`, `useSkill(org, slug)`, `useMcpServer(org, slug)` do not exist
2. **No detail view pages** — no routes at `/library/agents/[slug]`, `/library/skills/[slug]`, `/library/mcp-servers/[slug]`
3. **List items are not clickable** — `onItemClick` is supported by `ResourceListView` but never passed by the list pages

---

## Scope

### In Scope

- 3 data hooks in `@stigmer/react` for fetching single resources
- 3 embeddable detail view components in `@stigmer/react`
- 3 Console pages in `client-apps/web` consuming the SDK components
- Wiring `onItemClick` on existing list pages to navigate to detail routes
- Barrel export updates

### Explicitly Out of Scope

- Raw YAML view / toggle (structured view only — YAML toggle can be layered on later)
- Version history / diff viewer (needs additional API work)
- Edit flow / "Edit" button (depends on Phase 4 attachment support)
- Dependency graph visualization (future enhancement)
- Recent sessions for a resource (cross-aggregate query)
- Any backend changes

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  @stigmer/react (SDK — embeddable)                                  │
│                                                                     │
│  Data Hooks (headless):                                             │
│    useAgent(org, slug)         → { agent, isLoading, error }        │
│    useSkill(org, slug, ver?)   → { skill, isLoading, error }        │
│    useMcpServer(org, slug)     → { mcpServer, isLoading, error }    │
│                                                                     │
│  Detail View Components (styled, drop-in):                          │
│    AgentDetailView             → full agent detail with sections     │
│    SkillDetailView             → skill content + metadata            │
│    McpServerDetailView         → config + discovered tools           │
│                                                                     │
│  Component Strategy:                                                │
│    Each component uses its hook internally by default.               │
│    <AgentDetailView org="acme" slug="my-agent" /> just works.       │
│    No Console dependencies. Themed via --stgm-* tokens.             │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  client-apps/web (Console — routing + page shell)                   │
│                                                                     │
│  Pages:                                                             │
│    /library/agents/[slug]       → AgentDetailPage                   │
│    /library/skills/[slug]       → SkillDetailPage                   │
│    /library/mcp-servers/[slug]  → McpServerDetailPage               │
│                                                                     │
│  Wiring:                                                            │
│    AgentListPage     → onItemClick → router.push(detail route)      │
│    SkillListPage     → onItemClick → router.push(detail route)      │
│    McpServerListPage → onItemClick → router.push(detail route)      │
└─────────────────────────────────────────────────────────────────────┘
```

### URL Scheme

| Route | Slug Source | Example |
|-------|------------|---------|
| `/library/agents/[slug]` | `SearchResult.slug` from list | `/library/agents/pr-review-agent` |
| `/library/skills/[slug]` | `SearchResult.slug` from list | `/library/skills/code-style-guide` |
| `/library/mcp-servers/[slug]` | `SearchResult.slug` from list | `/library/mcp-servers/github` |

The `slug` is the URL-friendly identifier unique within an org. The `org` comes from the active org context (`useActiveOrgSlug()`), same as the list pages.

### Resource Reference Resolution

Detail pages resolve the resource using `getByReference(org, slug)`, not `get(id)`. This keeps URLs human-readable and shareable. The slug is stable (part of the resource's identity), while the ID is opaque.

---

## Detail View Design (Per Resource Type)

### Agent Detail View

The agent is a blueprint — a configuration document that defines what an agent can do. The detail view surfaces its complete configuration in structured sections.

```
┌────────────────────────────────────────────────────────────────┐
│  ← Library / Agents / pr-review-agent                          │
│                                                                │
│  ┌─ Header ──────────────────────────────────────────────────┐ │
│  │  🤖 pr-review-agent                            Public     │ │
│  │  acme · Created Mar 15 · Updated Mar 19                   │ │
│  │  A senior code reviewer that checks PRs for quality...    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─ Instructions ────────────────────────────────────────────┐ │
│  │  You are a senior code reviewer. Analyze the provided     │ │
│  │  PR diff and produce a structured review covering:        │ │
│  │  - Code correctness                                       │ │
│  │  - Performance implications                               │ │
│  │  ...                                                      │ │
│  │  [Show more]                                              │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─ MCP Servers (2) ────────────────────────────────────────┐ │
│  │  🖥 acme/github           5 tools enabled                │ │
│  │  🖥 acme/jira             3 tools enabled                │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─ Skills (1) ─────────────────────────────────────────────┐ │
│  │  ⚡ acme/code-style-guide                                │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─ Sub-Agents (1) ─────────────────────────────────────────┐ │
│  │  ▸ security-scanner                                      │ │
│  │    "Focused security review of the changes"              │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─ Environment Variables ──────────────────────────────────┐ │
│  │  GITHUB_TOKEN     required  "GitHub PAT for API access"  │ │
│  │  JIRA_API_KEY     required  "Jira API key"               │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

**Sections** (in order):
1. **Header** — Name, org, icon (if present), description, visibility badge, audit timestamps (created/updated)
2. **Instructions** — The system prompt. Monospace, collapsible (show first ~8 lines by default with "Show more"). This is the core content of an agent.
3. **MCP Server Usages** — List of referenced MCP servers with org/slug and tool configuration summary (count of enabled tools, any approval overrides). Each entry links to the MCP server's detail page.
4. **Skills** — List of skill references with org/slug. Each entry links to the skill's detail page.
5. **Sub-Agents** — Expandable list showing sub-agent name, description, and (on expand) instructions, MCP access config, model override.
6. **Environment Variables** — Table of env spec entries: variable name, required/optional, description.

Sections with zero items are omitted entirely (not shown with "None" — reduces visual noise per aesthetic-minimalist design heuristic).

### Skill Detail View

The skill is a knowledge package. The SKILL.md content IS the skill — rendering it as formatted markdown is the primary value of this view.

```
┌────────────────────────────────────────────────────────────────┐
│  ← Library / Skills / code-style-guide                         │
│                                                                │
│  ┌─ Header ──────────────────────────────────────────────────┐ │
│  │  ⚡ code-style-guide                           Private    │ │
│  │  acme · Tag: stable · Ready ✓                             │ │
│  │  Code style guidelines for TypeScript projects            │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─ Skill Content ──────────────────────────────────────────┐ │
│  │                                                           │ │
│  │  # Code Style Guide                                       │ │
│  │                                                           │ │
│  │  ## TypeScript Conventions                                │ │
│  │  - Use `const` by default, `let` only when mutation...    │ │
│  │  - Prefer `interface` over `type` for object shapes...    │ │
│  │  ...                                                      │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─ Version ────────────────────────────────────────────────┐ │
│  │  Hash: a1b2c3d4e5f6...  (SHA256)                         │ │
│  │  Git: github.com/acme/skills @ main (abc1234)             │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

**Sections** (in order):
1. **Header** — Name, org, description, visibility badge, tag, state badge (Ready/Uploading/Failed with color), audit timestamps
2. **Skill Content** — SKILL.md rendered as formatted markdown. This is the primary content area. Uses a markdown renderer with appropriate styling.
3. **Version Info** — Version hash (truncated, full on hover/click), git provenance (remote URL, ref, commit short hash, subdirectory if present). Omitted when git provenance is not set.

**Markdown rendering consideration**: We need a lightweight markdown renderer for the SKILL.md content. Options to evaluate during implementation: `react-markdown` (widely used, ~12KB gzipped), or a simpler approach if the codebase already has markdown rendering elsewhere. This decision should be made during T01.5 implementation based on what's already available in the dependency tree.

### MCP Server Detail View

The MCP server is an integration point. The discovered tools list is the most valuable section — it answers the question every user asks: "What can this server do?"

```
┌────────────────────────────────────────────────────────────────┐
│  ← Library / MCP Servers / github                              │
│                                                                │
│  ┌─ Header ──────────────────────────────────────────────────┐ │
│  │  🖥 github                                     Public     │ │
│  │  acme · Validated ✓ · Last discovered Mar 19              │ │
│  │  GitHub integration for PR management and code review     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─ Server Configuration ───────────────────────────────────┐ │
│  │  Type: stdio                                              │ │
│  │  Command: npx @stigmer/mcp-github                         │ │
│  │  Args: --verbose                                          │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─ Tools (12) ─────────────────────────────────────────────┐ │
│  │                                                           │ │
│  │  create_pull_request                                      │ │
│  │  Create a new pull request on a repository                │ │
│  │                                                           │ │
│  │  get_pull_request                                         │ │
│  │  Get details of a pull request by number                  │ │
│  │                                                           │ │
│  │  list_commits                                             │ │
│  │  List commits on a branch or pull request                 │ │
│  │                                                           │ │
│  │  ...                                                      │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─ Environment Variables ──────────────────────────────────┐ │
│  │  GITHUB_TOKEN     required  "GitHub PAT for API access"  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─ Tags ───────────────────────────────────────────────────┐ │
│  │  github  source-control  pr-management                   │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

**Sections** (in order):
1. **Header** — Name, org, icon (if present), description, visibility badge, validation state badge (Valid/Invalid/Unknown), last discovered timestamp, audit timestamps
2. **Server Configuration** — Server type (stdio or HTTP) with type-specific fields:
   - stdio: command, args, working directory
   - HTTP: URL, timeout
3. **Discovered Tools** — List of tools with name (monospace) and description. Count in section header. This is the star section. If the server has resource templates, show those too.
4. **Environment Variables** — Same pattern as Agent (table of env spec entries). Omitted if empty.
5. **Tags** — Pill badges. Omitted if empty.

**Validation state** — If `validation_state` is INVALID, show the validation message as a warning banner above the sections. This surfaces server configuration problems clearly.

---

## Shared Component Patterns

### Detail Section Component

All three detail views share a common section pattern: a titled, collapsible card with content. Rather than creating a formal shared component for this (premature abstraction), each detail view implements sections inline using consistent styling patterns. If, during implementation, the repetition becomes significant, we can extract a `DetailSection` component — but only when the pattern is proven, not predicted.

### Resource Detail Header

The header pattern (name + org + badges + timestamps + description) is identical across all three types except for type-specific badges (state for Skill, validation for MCP Server). Consider whether a shared `ResourceDetailHeader` component makes sense during implementation — if the overlap is >80%, extract it; if the type-specific differences create prop explosion, keep them separate.

### Cross-Linking Between Detail Pages

MCP server usages in the Agent detail view and skill refs in the Agent detail view are references to other resources. These should be rendered as clickable links that navigate to the corresponding detail pages:
- `acme/github` in an agent's MCP usages → `/library/mcp-servers/github`
- `acme/code-style-guide` in an agent's skill refs → `/library/skills/code-style-guide`

In the SDK component, these are `onMcpServerClick` / `onSkillClick` callback props (no routing dependency). The Console page wires them to `router.push()`.

### Loading / Error / Not Found States

Each detail view component handles three non-happy states:
- **Loading** — Skeleton layout matching the section structure
- **Error** — Error message with retry button (same pattern as `ResourceListView`)
- **Not Found** — When `getByReference` returns 404: "Resource not found" with a link back to the list page

---

## Task Breakdown

### Phase 1: SDK Data Hooks

Three mechanical hooks following the established pattern (see `useAgentList`, `useDefaultAgent`).

#### T01.1 — `useAgent` data hook
- **File**: `sdk/react/src/agent/useAgent.ts` (new)
- Wraps `stigmer.agent.getByReference({ org, slug })` via `useStigmer()`
- Returns: `{ agent: Agent | null, isLoading, error, refetch }`
- Pass `null` as org or slug to skip fetching (stable no-op)
- Handles error mapping: 404 → `null` agent with no error (not found is a valid state, not an error)

#### T01.2 — `useSkill` data hook
- **File**: `sdk/react/src/skill/useSkill.ts` (new)
- Wraps `stigmer.skill.getByReference({ org, slug, version? })`
- Returns: `{ skill: Skill | null, isLoading, error, refetch }`
- Supports optional `version` parameter (tag like "stable", hash, or omitted for latest)

#### T01.3 — `useMcpServer` data hook
- **File**: `sdk/react/src/mcp-server/useMcpServer.ts` (new)
- Wraps `stigmer.mcpServer.getByReference({ org, slug })`
- Returns: `{ mcpServer: McpServer | null, isLoading, error, refetch }`

### Phase 2: SDK Detail View Components

Three styled, embeddable detail view components. Each composes its data hook internally, uses `--stgm-*` tokens, and has zero Console dependencies.

#### T01.4 — `AgentDetailView` component
- **File**: `sdk/react/src/agent/AgentDetailView.tsx` (new)
- **Props**: `org: string`, `slug: string`, `onMcpServerClick?: (ref) => void`, `onSkillClick?: (ref) => void`, `className?: string`
- Uses `useAgent(org, slug)` internally
- Renders sections: Header, Instructions (collapsible), MCP Server Usages, Skills, Sub-Agents (expandable), Env Spec
- Omits empty sections
- Loading skeleton, error state, not-found state
- All styling via `--stgm-*` tokens

#### T01.5 — `SkillDetailView` component
- **File**: `sdk/react/src/skill/SkillDetailView.tsx` (new)
- **Props**: `org: string`, `slug: string`, `version?: string`, `className?: string`
- Uses `useSkill(org, slug, version)` internally
- Renders sections: Header (with state badge + tag), Skill Content (rendered markdown), Version Info (hash + git provenance)
- **Markdown rendering**: Evaluate what's available in the dependency tree. If `react-markdown` or equivalent is already present, use it. If not, add it as a dependency — this is a legitimate SDK need since SKILL.md content is structured markdown. Pause and discuss if the dependency choice has broader implications.

#### T01.6 — `McpServerDetailView` component
- **File**: `sdk/react/src/mcp-server/McpServerDetailView.tsx` (new)
- **Props**: `org: string`, `slug: string`, `className?: string`
- Uses `useMcpServer(org, slug)` internally
- Renders sections: Header (with validation badge), Server Configuration (type-specific), Discovered Tools (name + description list), Env Spec, Tags
- Validation warning banner when state is INVALID

### Phase 3: Console Pages + Wiring

Three thin Console pages that consume SDK components, plus wiring list pages to navigate to detail.

#### T01.7 — Agent detail page
- **File**: `client-apps/web/src/app/library/agents/[slug]/page.tsx` (new)
- Next.js dynamic route page
- Reads `slug` from route params, `org` from `useActiveOrgSlug()`
- Renders `<AgentDetailView org={org} slug={slug} />` with click handlers wired to `router.push`

#### T01.8 — Skill detail page
- **File**: `client-apps/web/src/app/library/skills/[slug]/page.tsx` (new)
- Same pattern, renders `<SkillDetailView />`

#### T01.9 — MCP Server detail page
- **File**: `client-apps/web/src/app/library/mcp-servers/[slug]/page.tsx` (new)
- Same pattern, renders `<McpServerDetailView />`

#### T01.10 — Wire list pages to navigate to detail
- **Files**: `AgentListPage.tsx`, `SkillListPage.tsx`, `McpServerListPage.tsx` (modify)
- Add `onItemClick` to `ResourceListView`: `(item) => router.push(\`/library/{type}/${item.slug}\`)`
- Minimal change — each list page adds ~3 lines

### Phase 4: Exports + Polish

#### T01.11 — Barrel export updates
- **Files**: `sdk/react/src/agent/index.ts`, `sdk/react/src/skill/index.ts`, `sdk/react/src/mcp-server/index.ts` (modify)
- **File**: `sdk/react/src/index.ts` (modify)
- Export new hooks and components from all barrel files

#### T01.12 — Breadcrumb resource name (progressive enhancement)
- **File**: `client-apps/web/src/app/library/LibraryBreadcrumb.tsx` (modify)
- The breadcrumb already handles the `[slug]` segment (displays raw slug text)
- Enhancement: display the resource's display name instead of the raw slug
- This requires knowing the resource name, which the detail page has but the breadcrumb does not
- **Approach**: Keep it simple — display the slug in the breadcrumb. The slug is already human-readable (kebab-case names like `pr-review-agent`). If we later want display names, we can add a context-based approach. This avoids an extra API call in the breadcrumb.

---

## Execution Order

```
Phase 1 (hooks) → Phase 2 (components) → Phase 3 (pages) → Phase 4 (exports)
```

Sequential dependency: components need hooks, pages need components, exports need everything. Within each phase, the three resource types are independent and could theoretically be built in parallel, but sequential implementation allows pattern establishment on the first (Agent) and faster replication on the second and third.

**Recommended order within phases**: Agent first (most complex — establishes the pattern), then MCP Server (second most complex — discovered tools section), then Skill (simplest — mostly markdown rendering).

---

## SDK Placement Summary

### New hooks (3) — in `@stigmer/react`

| Hook | Module | Purpose |
|------|--------|---------|
| `useAgent` | `agent/` | Single agent by org + slug |
| `useSkill` | `skill/` | Single skill by org + slug + optional version |
| `useMcpServer` | `mcp-server/` | Single MCP server by org + slug |

### New components (3) — in `@stigmer/react`

| Component | Module | Purpose |
|-----------|--------|---------|
| `AgentDetailView` | `agent/` | Full agent detail with all sections |
| `SkillDetailView` | `skill/` | Skill content + metadata |
| `McpServerDetailView` | `mcp-server/` | Config + tools + metadata |

### New pages (3) — in `client-apps/web`

| Page | Route |
|------|-------|
| Agent detail | `/library/agents/[slug]` |
| Skill detail | `/library/skills/[slug]` |
| MCP Server detail | `/library/mcp-servers/[slug]` |

### Modified files (4-5)

| File | Change |
|------|--------|
| `AgentListPage.tsx` | Add `onItemClick` navigation |
| `SkillListPage.tsx` | Add `onItemClick` navigation |
| `McpServerListPage.tsx` | Add `onItemClick` navigation |
| `sdk/react/src/index.ts` | Add detail hook + component exports |
| Module barrel files | Add exports |

---

## Design Decisions

- **DD-001**: Structured view over raw YAML for initial ship — users get immediate readability. YAML toggle is a future layer, not a blocker.
- **DD-002**: `getByReference(org, slug)` over `get(id)` for URL resolution — human-readable, shareable URLs using the slug.
- **DD-003**: SDK components compose hooks internally — `<AgentDetailView org="acme" slug="my-agent" />` just works with zero setup for platform builders.
- **DD-004**: Cross-resource links via callback props (`onMcpServerClick`, `onSkillClick`) — keeps the SDK component routing-agnostic while enabling the Console to wire navigation.
- **DD-005**: Empty sections are omitted, not shown with "None" — reduces visual noise, follows aesthetic-minimalist design (Nielsen heuristic #8).
- **DD-006**: Breadcrumb shows slug, not display name — avoids extra API call, slugs are already human-readable. Can upgrade later with context-based approach.

---

## Open Questions

1. **Markdown renderer for SKILL.md**: The skill detail view needs to render SKILL.md as formatted markdown. Need to check if `react-markdown` or an equivalent is already in the dependency tree. If not, adding it is legitimate — but the choice should be made during implementation based on bundle size impact and existing patterns.

2. **Tool input schema display**: MCP Server discovered tools include an `input_schema` (JSON Schema). Should we display this in the detail view (expandable per tool), or is name + description sufficient for the initial ship? I'd recommend name + description first — input schema is useful but adds significant UI complexity.

---

## Notes

- Every new hook must include JSDoc documenting purpose, parameters, return type, and usage example
- Every new component must use `--stgm-*` tokens exclusively — no hardcoded colors/sizes
- All components must be keyboard navigable and support screen readers
- Detail view components must work identically in the Stigmer Console and when embedded in a third-party application
- Sections with potentially long content (Instructions, SKILL.md) must handle overflow gracefully — collapsible/scrollable, not unbounded height

---

## Review Process

**What happens next**:
1. **You review this plan** — consider the architecture, scope, and design decisions
2. **Provide feedback** — concerns, changes, missing requirements
3. **I'll revise the plan** — incorporating your feedback
4. **You approve** — explicit go-ahead
5. **Execution begins** — tracked in T01_3_execution.md
