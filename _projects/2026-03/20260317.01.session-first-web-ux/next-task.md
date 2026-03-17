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
**Current Task**: T01.6 (Web — Active Session View)
**Status**: Ready to start
**Last Session**: 2026-03-17 — Implemented GitHub OAuth workspace integration (session 10)
**Pending Pre-req**: GitHub OAuth App registration (see `tasks/T01_github_app_registration.md`)

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
- **Proto**: `spec.proto` field comments updated — documents three-way resolution (session_id -> agent_id -> platform default)
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

### Completed: T01.5 — Web — New Session Launcher
- **SDK Architecture (headless-first, three-layer)**:
  - **Data hook**: `useModelRegistry()` — hardcoded model list ported from Python `model_registry.py` (22 models, grouped by provider, cost tiers)
  - **Behavior hooks**: `useCreateSession()` (Session aggregate), `useCreateAgentExecution()` (AgentExecution aggregate), `useWorkspaceEntries()` (workspace entry state management)
  - **Styled components**: `<ModelSelector>` (theme-able dropdown via `@base-ui/react` Select), `<WorkspaceEditor>` (add/remove workspace entries UI)
- **Backend changes**:
  - Proto: `agent_instance_id` made optional in `SessionSpec` — backend resolves default agent instance if omitted
  - Go: Added `resolveDefaultAgentInstanceStep` to session creation pipeline, `SessionController` gains `SetClients()` for agent/agentInstance dependency injection
  - Java (stigmer-cloud): Added `ResolveDefaultAgentInstanceStep` inner class in `SessionCreateHandler`
- **Console integration**:
  - `SessionLauncher` component composes SDK hooks with Console-specific concerns (org context, Next.js routing, toast notifications)
  - Flow: `useCreateSession()` -> `useCreateAgentExecution()` -> navigate to `/sessions/[id]`
  - Placeholder `/sessions/[id]/page.tsx` created for T01.6
- **Key architectural decisions**:
  - Hooks follow aggregate boundaries: `useCreateSession` for Session, `useCreateAgentExecution` for AgentExecution — no cross-aggregate orchestration in hooks
  - `SessionLauncher` stays in Console (not SDK) because it composes Console-specific concerns (org context, routing, toasts)
  - Named `useCreateAgentExecution` (not `useCreateExecution`) to leave room for future `useCreateWorkflowExecution`
  - Model registry hardcoded for now; future backend RPC will replace it
  - `@base-ui/react` added as SDK peer dependency for accessible primitives

### Completed: Workspace GitHub OAuth Repo Picker (Session 10)
- Implemented full Phase 1 of GitHub OAuth workspace integration (9 tasks: T1-T8 + Phase 2 docs)
- **Proto**: New `platform/github/v1` bounded context with `GitHubService` (2 RPCs)
- **Go Backend**: `GitHubController` with OAuth code exchange, config via env vars
- **Java Backend** (stigmer-cloud): `@AutoGrpcRouterController` + pipeline handlers
- **SDK TypeScript**: Hand-written `GitHubClient` (non-resource service, like `SearchClient`)
- **SDK React**: `useGitHubConnection` hook, `useGitHubRepos` hook, `GitHubRepoPicker` component
- **WorkspaceEditor redesign**: Two source buttons ("GitHub Repo" / "Local Folder") with progressive disclosure
- **Console**: OAuth callback page, `useDeploymentMode` hook, `SessionLauncher` integration
- **SPA handler**: `.html` extension fallback for static routes
- **Documented**: Phase 2 local folder browser, GitHub App registration task
- **Pending**: GitHub OAuth App registration (manual task — see `tasks/T01_github_app_registration.md`)

### Fixed: Nested Form Hydration Error (Session 9)
- `WorkspaceEditor` (SDK) used a `<form>` element for its add-workspace panel
- When rendered inside `SessionLauncher`'s `<form>`, this created invalid nested `<form>` HTML
- React detected the mismatch and reported two hydration errors
- **Fix**: Replaced `<form>` with `<div>` in `WorkspaceEditor.tsx`, wired `onClick`/`onKeyDown` handlers explicitly
- **Why in SDK**: SDK components must be embeddable in any host element per the platform-for-platforms contract
- Committed: `e9e05648`

### Key Decisions (cumulative)
1. **No MCP server usages** — the assistant is purely general-purpose. Tools come from the runtime.
2. **Minimal instructions** — 5 lines. Identity, mission, tone, action bias, honesty.
3. **No skill_refs, sub_agents, or env_spec** — intentionally omitted to keep the agent as a clean slate.
4. **Fresh start, not incremental refactor** — Deleted all existing UI and rebuilt from scratch.
5. **Web package.json untouched** — Temporarily unused deps will be needed in T01.5/T01.6.
6. **Font declarations kept in layout.tsx** — Six fonts loaded.
7. **Platform-level default agent** — System-wide resource with `visibility_public`, not per-org.
8. **Session ownership follows the caller** — Sessions created in caller's org even when using cross-org public agent.
9. **Labels as first-class store concept** — Go store got `FindByLabel`/`FindAllByLabel` methods.
10. **Toggle visibility, not icon rail** — Binary show/hide sidebar (like Claude/ChatGPT).
11. **Headerless layout** — No top bar. Sidebar owns all controls.
12. **Appearance in user menu** — Theme switching is submenu inside user dropdown.
13. **`border-foreground/10` for borders** — Guaranteed visibility in both themes.
14. **DropdownMenu for OrgSwitcher** — Full-width trigger, radio items with checkmark.
15. **Context panel toggle hidden in T01.4** — No content until T01.6.
16. **`@base-ui/react` Button lacks `asChild`** — Use `buttonVariants` + `cn` on `<Link>` directly.
17. **Hooks follow aggregate boundaries** — `useCreateSession` for Session, `useCreateAgentExecution` for AgentExecution. No orchestration hooks.
18. **`SessionLauncher` is Console-only** — Composes SDK hooks + Console concerns (org, routing, toasts). Not an SDK component.
19. **`useCreateAgentExecution` not `useCreateExecution`** — Future-proofing for workflow executions.
20. **Always two-step flow** — Session is always created explicitly before execution, even without workspace entries. Simpler, consistent, provides sessionId upfront.
21. **`output: "export"` + `__placeholder__` is the correct architecture** — The web console is embedded as static files in the Go CLI binary via `//go:embed`. Dynamic routes use `generateStaticParams()` returning `[{ id: "__placeholder__" }]`. The Go `spaHandler` (`client-apps/cli/embedded/webconsole/handler.go`) explicitly rewrites dynamic route requests to their `__placeholder__` variants. This is not a workaround — it's a properly engineered SPA serving mechanism for the single-binary distribution model. Do NOT switch to `output: "standalone"`.
22. **Dynamic route pattern for static export** — Dynamic routes like `/sessions/[id]` use a server component `page.tsx` (exports `generateStaticParams`) + a client component `SessionPage.tsx` (uses `useParams`). This is the established pattern from the pre-teardown codebase.
23. **SDK components must not use `<form>`** — `WorkspaceEditor` and similar SDK components must avoid `<form>` elements because they may be embedded inside a host application's own form. Use `<div>` with explicit `onClick`/`onKeyDown` handlers instead.
24. **Non-resource gRPC services are hand-written in SDK** — The `stigmer-codegen` tool only generates TypeScript clients for CRUD resources. Non-resource services (Search, GitHub) need hand-written clients following the `SearchClient` pattern.
25. **`platform` bounded context for utility services** — GitHub OAuth lives under `apis/ai/stigmer/platform/github/v1/`. This is for platform-level utilities, not domain resources.
26. **GitHub token in localStorage, not backend DB** — Key `stigmer:github:token`. Ephemeral by design — frontend persists, backend never stores.
27. **Two-button workspace source selection** — "GitHub Repo" and "Local Folder" as action triggers, not tabs. Progressive disclosure via inline dropdowns.

## Next Steps
1. **T01.6**: Web — Active Session View (`/sessions/[id]`) — conversation thread, real-time streaming, follow-up input, right context panel
2. **T01.7**: Web — Sidebar Recents

## Context for Resume
- Branch: `feat/session-first-web-ux` (stigmer repo), `feat/session-first-web-ux` (stigmer-cloud repo)
- T01.1 through T01.5 are complete and committed.
- The web app has a headerless sidebar-driven layout with a working session launcher at `/`.
- The React SDK now has three feature modules: `models/`, `workspace/`, `session/`, `execution/`.
- SDK exports: `useModelRegistry`, `ModelSelector`, `useWorkspaceEntries`, `WorkspaceEditor`, `useCreateSession`, `useCreateAgentExecution`, `useGitHubConnection`, `useGitHubRepos`, `GitHubRepoPicker`.
- The session launcher flow: create session -> create agent execution -> navigate to `/sessions/[id]`.
- `/sessions/[id]/page.tsx` exists as a placeholder — T01.6 builds the actual session view.
- Proto `agent_instance_id` is optional in SessionSpec. Backend resolves default agent instance if omitted.
- Java (stigmer-cloud) has a matching `ResolveDefaultAgentInstanceStep` in `SessionCreateHandler`.
- Model list is hardcoded in `sdk/react/src/models/registry.ts` (22 models from Python `model_registry.py`). Future: backend RPC.

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260317.01.session-first-web-ux/next-task.md`

## Quick Commands

After loading context:
- "Continue with T01.6" - Start building the active session view
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
