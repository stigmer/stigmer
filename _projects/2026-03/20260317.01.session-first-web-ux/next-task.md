# Next Task: 20260317.01.session-first-web-ux

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260317.01.session-first-web-ux

**Description**: Redesign the Stigmer web console with a session-first UX inspired by Claude Cowork. Replace the current dashboard-centric UI with a 'New Session' launcher as the landing page. Add a default 'assistant' agent to the seedpack. Backend resolves default agent automatically when no agent is specified.
**Goal**: Users can log in and immediately start a session by typing a message — no agent selection required. The backend auto-resolves the default assistant agent. The web console is rebuilt from scratch with a three-panel layout: sidebar (New Session + Recents), main content (session launcher or active session thread), and a collapsible right context panel.
**Tech Stack**: TypeScript/React/Next.js (frontend), Go (backend - seedpack + default agent resolution)
**Components**: client-apps/web (full UI rewrite), seedpack (new assistant agent), backend (default agent resolution in session/execution creation)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-17 09:01
**Current Task**: T01.5 (Web — New Session Launcher)
**Status**: In Progress
**Last Session**: 2026-03-17 — Refined T01.4 layout to headerless sidebar-driven design (session 6)

## Session Progress (2026-03-17)

### Completed: T01.1 — Seedpack Default Assistant Agent
- Created `seedpack/agents/assistant.yaml`
- Labels: `stigmer.ai/system: "true"`, `stigmer.ai/default-agent: "true"`
- Minimal general-purpose instructions — no tool enumeration, no MCP server usages
- Agent gets its tools from the runtime; instructions just set tone and action bias
- No changes needed to `embed.go` or `BUILD.bazel` (auto-pickup via glob)

### Completed: T01.2 — Backend Default Agent Resolution
- Implemented in both Go (`stigmer`) and Java (`stigmer-cloud`)
- **Seedpack**: `assistant.yaml` updated with `visibility: visibility_public`
- **Proto**: `spec.proto` field comments updated — documents three-way resolution (session_id → agent_id → platform default)
- **Go Store**: Added `FindByLabel` and `FindAllByLabel` to `store.Store` interface + SQLite implementation using proto reflection for `metadata.labels` map access
- **Go Pipeline**: Added `ResolveDefaultAgentStep` before `ValidateSessionOrAgent` in `AgentExecution` create pipeline. Updated `CreateSessionIfNeeded` to use caller's org for session ownership.
- **Java AgentRepo**: Added `findDefault()` — MongoDB query by label `stigmer.ai/default-agent=true` + `visibility_public`
- **Java Pipeline**: Added `ResolveDefaultAgentStep` before `ValidateSessionOrAgentStep` in `AgentExecutionCreateHandler`. Updated `CreateSessionIfNeededStep` to use caller's org for session ownership.
- **Key design decisions**:
  - Default agent is platform-level (stigmer org), not per-org
  - Resolution is global: label + visibility_public, not org-scoped
  - Session ownership: caller's org (not agent's org) — enables cross-org public agent usage
  - Default instance stays shared in agent's org (stigmer)
  - Cloud mode gracefully fails if default agent not provisioned (seedpack is OSS-only)

### Completed: T01.3 — Web UI Teardown
- Deleted ~55 files: all layout components, dashboard, resource pages, hooks, draft/run flows, config files, utils
- Modified `layout.tsx`: removed `AppShell` import and wrapper, trimmed metadata
- Replaced `page.tsx` with minimal placeholder (server component, no imports from deleted modules)
- Preserved: `src/auth/` (9 files), `src/contexts/org-context.tsx`, `Providers.tsx`, `StigmerTransportBridge.tsx`, `src/components/ui/` (10 shadcn primitives), `src/config/env.ts`, error boundaries, `globals.css`
- Build passes (`npm run build` — zero errors, 2 static routes)
- Lint passes (`npm run lint` — zero errors)

### Completed: React SDK Teardown (companion to T01.3)
- Deleted 33 files across 7 directories (2,959 lines) from `sdk/react/`:
  - `src/agent/`, `src/session/`, `src/agent-execution/`, `src/catalog/`, `src/skill/`, `src/mcp-server/`, `src/internal/`
- Removed 6 sub-path exports and 5 unused peer dependencies (`@base-ui/react`, `class-variance-authority`, `lucide-react`, `react-markdown`, `remark-gfm`)
- Updated `README.md` to reflect minimal provider-only state
- Preserved: `StigmerProvider`, `StigmerContext`, `useStigmer`, `styles.css` (5 source files)
- Typecheck and build pass clean for both `sdk/react` and `client-apps/web`
- Committed: `c6b707cd`

### Completed: T01.4 — Web App Shell (Three-Panel Layout)
- Created layout files in `client-apps/web/src/components/layout/`: `AppShell.tsx`, `Sidebar.tsx`, `ContextPanel.tsx`, `OrgSwitcher.tsx`, `UserMenu.tsx`, `use-layout-state.ts`
- **Headerless layout** — No top bar. Sidebar owns all controls (like Claude Cowork / Cursor).
- Sidebar top: collapse toggle + OrgSwitcher. Middle: "New Session" + scrollable Recents. Bottom: UserMenu with Appearance submenu.
- Theme switching embedded in UserMenu dropdown as "Appearance" submenu with Light/Dark/System radio items.
- OrgSwitcher uses DropdownMenu + RadioGroup (not native `<select>`).
- Sidebar collapsible on all screen sizes. Floating reopen button when collapsed.
- Border uses `border-foreground/10` for guaranteed visibility in both themes.
- State: `useSyncExternalStore` — sidebar persists to localStorage, context panel is session-scoped (in-memory).
- Context panel: collapsible 320px shell (closed by default, no toggle yet). Hidden below lg.
- `layout.tsx` wraps children in `<AppShell>`. Build and lint pass clean.

### Key Decisions
1. **No MCP server usages** — the assistant is purely general-purpose, not a platform help desk. Platform browsing is a UI concern. Tools come from the runtime.
2. **Minimal instructions** — 5 lines. Identity, mission, tone, action bias, honesty. The LLM figures out the rest from its available tools.
3. **No skill_refs, sub_agents, or env_spec** — intentionally omitted to keep the agent as a clean slate.
4. **Fresh start, not incremental refactor** — Deleted all existing UI and rebuilt from scratch. Avoids legacy patterns influencing new code.
5. **Web package.json untouched** — Temporarily unused deps (`react-markdown`, `remark-gfm`, `@base-ui/react`) will be needed in T01.5/T01.6. No premature cleanup in web app. SDK package.json was cleaned (unused peer deps removed).
6. **Font declarations kept in layout.tsx** — Six fonts loaded. T01.4 kept them as-is.
10. **Toggle visibility, not icon rail** — Sidebar uses binary show/hide (like Claude/ChatGPT), not a compact icon-rail collapse. Sessions don't have meaningful icons.
11. **Headerless layout** — Removed the 48px header entirely. Sidebar owns all controls. Main content gets full viewport height.
12. **Appearance in user menu** — Theme switching (Light/Dark/System) is a submenu inside the user dropdown, not a standalone widget. Matches Cursor's pattern.
13. **`border-foreground/10` for borders** — The `--stgm-sidebar-border` token lacks contrast in light mode. Using foreground at 10% opacity guarantees visibility in both themes.
14. **DropdownMenu for OrgSwitcher** — Replaced native `<select>` for consistent interaction. Full-width trigger, radio items with checkmark.
15. **Context panel toggle hidden in T01.4** — No content until T01.6. Showing a toggle for an empty panel violates Nielsen heuristic #1.
16. **`@base-ui/react` Button lacks `asChild`** — Use `buttonVariants` + `cn` on `<Link>` directly instead of `<Button asChild>`.
7. **Platform-level default agent** — The default assistant is a system-wide resource in the `stigmer` org with `visibility_public`, not a per-org concept. Resolution is global.
8. **Session ownership follows the caller** — Sessions are created in the caller's org even when using a cross-org public agent. This is critical for multi-tenancy in Cloud mode.
9. **Labels as first-class store concept** — Go `store.Store` got explicit `FindByLabel`/`FindAllByLabel` methods rather than overloading `FindByField`, because label keys contain dots that conflict with field-path dot notation.

## Next Steps
1. **T01.5**: Web — New Session Launcher (landing page at `/`)
2. **T01.6**: Web — Active Session View (`/sessions/[id]`)
3. **T01.7**: Web — Sidebar Recents

## Context for Resume
- Branch: `feat/session-first-web-ux` (stigmer repo), `main` (stigmer-cloud repo)
- T01.1 committed (`ca2b2554`). T01.2 committed. T01.3 committed. React SDK teardown committed (`c6b707cd`). T01.4 committed (initial + layout refinements).
- The web app has a headerless sidebar-driven layout: AppShell (Flex), Sidebar (280px, collapsible on all sizes), ContextPanel (320px, closed).
- Sidebar structure: top = collapse toggle + OrgSwitcher, middle = New Session + Recents, bottom = UserMenu (with Appearance submenu).
- No AppHeader or ThemeToggle files — deleted. Theme switching lives in UserMenu. OrgSwitcher uses DropdownMenu.
- The React SDK is a clean slate: provider + context + hook + styles. No feature components. 5 source files in `sdk/react/src/`.
- `run/page.tsx` in git history is valuable reference for T01.5/T01.6 — shows `@stigmer/react` import patterns that existed before teardown.
- Feature components for the React SDK will be rebuilt alongside the web UI (T01.5/T01.6) with embeddability as a primary design constraint.
- Default agent resolution is fully wired in both backends. The frontend can now create executions with just a message — no agent_id or session_id needed.
- T01.5 will replace the placeholder `page.tsx` with the session launcher. It will need to create an AgentExecution without specifying an agent (backend resolves default).

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260317.01.session-first-web-ux/next-task.md`

## Quick Commands

After loading context:
- "Continue with T01.5" - Start building the session launcher
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
