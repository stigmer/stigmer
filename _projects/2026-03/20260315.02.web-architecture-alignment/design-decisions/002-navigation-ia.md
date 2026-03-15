# Design Decision 002: Navigation Information Architecture

**Date**: 2026-03-15
**Status**: Accepted
**Task**: T05 (Phase 3)
**Scope**: Sidebar taxonomy, global header, breadcrumbs, route structure

---

## Context

The Stigmer Web Console sidebar had 4 items (Run Agent, Sessions, Catalog, Draft) while 6 additional routes existed but were hidden from navigation (`/`, `/agents`, `/skills`, `/mcp-servers`, `/agents/[id]`, etc.). This created multiple UX violations:

- **Nielsen #6 (Recognition over Recall)**: Users could not discover resource pages without knowing the URL or navigating through Catalog.
- **Nielsen #3 (User Control & Freedom)**: No way to return to Dashboard from the sidebar. No breadcrumbs on detail pages.
- **Nielsen #1 (Visibility of System Status)**: Sessions page rendered `<div />` — a complete dead end.
- **Jakob's Law**: "Draft" as a separate sidebar section breaks convention. Every comparable platform (GitHub, AWS, Kubernetes Dashboard, Planton) places creation within the resource section.

---

## Decision

### Sidebar Taxonomy

```
Dashboard                    → /

── Operations ───────────────
Run Agent                    → /run
Sessions                     → /sessions

── Resources ────────────────
Agents                       → /agents
Skills                       → /skills
MCP Servers                  → /mcp-servers

── Platform ─────────────────
Settings                     → /settings         (Phase 8 — hidden until then)
```

7 items across 3 labeled sections + 1 top-level item.

### Global Header

```
┌────────────────────────────────────────────────────────────────┐
│  [logo] Stigmer  │  [Org Switcher ▾]  │  ···  │  🌙  │  👤   │
└────────────────────────────────────────────────────────────────┘
```

| Element | Purpose |
|---|---|
| Logo + "Stigmer" | Brand identity using `site/public/logo-square.svg`. Links to Dashboard. Brand name is "Stigmer", not "Stigmer Console". |
| Org Switcher | Moves from sidebar to header for prominent org context (Nielsen #1). |
| Theme toggle | Moves from sidebar footer to header. Light / System / Dark. |
| User profile | Avatar, name, sign out. API keys link added when Settings views exist (Phase 8). |

Deferred: Cmd+K search, notification bell.

### Breadcrumbs

Every page below the top level gets a breadcrumb trail.

| Page | Breadcrumb |
|---|---|
| `/agents` | Resources > Agents |
| `/agents/my-agent` | Resources > Agents > my-agent |
| `/skills/my-skill` | Resources > Skills > my-skill |
| `/sessions` | Operations > Sessions |
| `/sessions/abc123` | Operations > Sessions > abc123 |
| `/run` | Operations > Run Agent |
| `/settings` | Platform > Settings |
| `/draft/skill` | Resources > Skills > Draft |

Segments are clickable for upward navigation.

### Draft Placement

Draft is removed from the sidebar. Each resource list page (`/agents`, `/skills`, `/mcp-servers`) gets a "Draft [Resource]" primary action button at the top of the marketplace-style card view. The Dashboard keeps "Draft Resource" as a quick action card. The `/draft/*` routes stay and are reached from these buttons.

### Catalog Removal

The `/catalog` route and page are deleted. With individual resource pages now in the sidebar, the unified catalog view is redundant. Each resource page already has search functionality. Cross-resource search will be addressed by Cmd+K in future work.

### Route Changes

| Route | Action |
|---|---|
| `/catalog` | **Deleted** — page, route directory, orphaned hooks/components removed |
| `/agents` | **Promoted** — added to sidebar under Resources |
| `/skills` | **Promoted** — added to sidebar under Resources |
| `/mcp-servers` | **Promoted** — added to sidebar under Resources |
| `/` | **Promoted** — added to sidebar as "Dashboard" |
| `/draft/*` | **Kept** — routes stay, reached via buttons on resource pages |

### Workflows and Settings Visibility

Hidden from sidebar until Phase 8 builds the views. No grayed-out items, no placeholders. Ship only what works.

---

## Rationale

**Section labels**: "Operations" is the standard DevOps/platform term for activity-oriented views. "Resources" matches the domain model (agents, skills, MCP servers are all resources in the KRM sense). "Platform" signals org/env/IAM management scope beyond just preferences.

**Operations first**: The Web UX/UI role mandate states "Execution Monitoring is the core view — highest-traffic and most UX-critical." Sessions and Run Agent are the primary user activities, so they get top placement.

**Dashboard unsectioned**: Dashboard is a universal entry point, not scoped to a domain. Every developer tool (GitHub, AWS, Planton, Grafana) places it as the first sidebar item.

**Draft as contextual action**: A separate "Draft" sidebar section creates a cognitive split — the user must decide between navigating to Skills (browse) or Draft > Skill (create). Placing the button on the resource page unifies the intent and follows the convention of every comparable platform.

**Catalog removed**: With `/agents`, `/skills`, `/mcp-servers` each in the sidebar with their own search, a unified view is redundant. The marketplace/discovery dimension is better served by future Cmd+K search.

**Miller's Law**: 3 sections with 2-3 items each keeps cognitive load manageable. The total of 7 visible items (with Platform/Settings hidden until Phase 8) is within the 5-9 range.

---

## Alternatives Rejected

- **Separate "Draft" / "Create" sidebar section**: Splits user mental model between browse and create for the same resource. Breaks convention.
- **Unified Catalog page alongside individual resource pages**: Creates dual paths to the same resources (Nielsen #4 — Consistency violation). With individual pages in the sidebar, Catalog is redundant.
- **"Stigmer Console" branding**: The product is "Stigmer." The console is one surface among CLI, API, and embeddable components.
- **Dashboard inside a section**: Dashboard is a universal entry point, not scoped to Operations or Resources.
- **Flat sidebar without sections**: Works at 4 items, breaks at 7+. Sections provide visual grouping per Miller's Law.
- **Workflows/Settings visible as disabled items**: Grayed-out items are broken promises. Add them when the views are ready.

---

## Implementation

This decision drives:

- **T05 (this task)**: Delete `/catalog` route and orphaned code
- **T11 (Phase 6)**: Implement sidebar taxonomy, global header, breadcrumbs, and Draft buttons on resource pages
- **T12 (Phase 6)**: Build the Sessions page (no longer a dead end)
- **T13 (Phase 6)**: Update Dashboard quick actions (remove "Browse Catalog" card)
- **T18 (Phase 8)**: Add Workflows sidebar item and views
- **T19 (Phase 8)**: Add Settings sidebar item, Platform section, and views
