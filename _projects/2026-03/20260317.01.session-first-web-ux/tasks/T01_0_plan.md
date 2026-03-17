# Task T01: Session-First Web UX — Implementation Plan

**Created**: 2026-03-17
**Status**: PENDING REVIEW

## Objective

Replace the current dashboard-centric web console with a session-first experience. Users land on a "New Session" screen after login and can immediately start working by typing a message. The backend auto-resolves a default `assistant` agent when no agent is specified.

## Scope (Hard Boundaries)

**In scope:**
- Seedpack: new `assistant` agent with `stigmer.ai/default-agent: "true"` label
- Backend: default agent resolution when no agent specified in session/execution creation
- Web: fresh UI rebuild — New Session launcher, Active Session view, Sidebar (New Session + Recents)
- Three-panel layout: sidebar, main content, collapsible right context panel

**Out of scope (deferred to future projects):**
- Resource management pages (Agents, Skills, MCP Servers) — currently exist, will be removed from nav but kept in codebase for later
- Settings, search, organization management
- Marketplace
- Workflow views

## Task Breakdown

### T01.1: Seedpack — Default Assistant Agent

**What**: Create `seedpack/agents/assistant.yaml`

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: assistant
  labels:
    stigmer.ai/system: "true"
    stigmer.ai/default-agent: "true"
spec:
  description: "General-purpose assistant for the Stigmer platform"
  instructions: |
    You are a general-purpose assistant on the Stigmer platform.
    Help users with their requests using the tools and knowledge available to you.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: mcp-server-stigmer
      enabled_tools:
        - search
        - get_agent
        - get_mcp_server
        - get_skill
        - get_workflow
```

**Files touched:**
- `seedpack/agents/assistant.yaml` (new)
- `seedpack/embed.go` (verify embed glob covers new file)

**Acceptance criteria:**
- [ ] `assistant` agent appears in `stigmer list agents` after server bootstrap
- [ ] Agent has `stigmer.ai/default-agent: "true"` label

---

### T01.2: Backend — Default Agent Resolution

**What**: When a Session or AgentExecution is created without an explicit `agent_id` or `agent_instance_id`, the backend looks up the agent labeled `stigmer.ai/default-agent: "true"` in the org and uses its default instance.

**Design:**
- Add a query/lookup function: `FindDefaultAgent(orgSlug) -> Agent` — queries by label `stigmer.ai/default-agent: "true"`
- In the session creation path: if `agent_instance_id` is empty and `agent_id` is empty, resolve default agent and its default instance
- In the execution creation path: same resolution if neither session nor agent is specified

**Files touched (investigation needed):**
- Session creation service/handler
- AgentExecution creation service/handler
- Agent repository — add `FindByLabel` or similar query
- Proto definitions — verify `agent_id` is already optional on session/execution specs

**Acceptance criteria:**
- [ ] `stigmer run --message "hello"` (no agent specified) resolves to the default assistant
- [ ] Web console can create a session without specifying an agent
- [ ] Error returned if no default agent exists in the org

---

### T01.3: Web — Delete Existing UI, Keep Auth Infrastructure

**What**: Remove all existing page components, layout components, hooks, and dashboard code. Keep only:
- `src/auth/` — entire directory (AuthProvider, AuthGuard, OIDC, token store, etc.)
- `src/contexts/org-context.tsx` — org context provider
- `src/components/providers/StigmerTransportBridge.tsx` — gRPC transport setup
- `src/components/auth/Providers.tsx` — auth provider wrapper
- `src/components/ui/` — keep shadcn/ui primitives (button, card, badge, etc.) as building blocks
- `src/app/layout.tsx` — root layout (will be modified)
- `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx` — error boundaries
- `src/config/env.ts` — environment config
- `next.config.ts`, `next-env.d.ts` — Next.js config

**Delete:**
- `src/components/layout/` — all of it (AppShell, Sidebar, AppHeader, TopBar, Breadcrumb, OrgSwitcher, UserMenu, ThemeToggle, ThemePresetSelector, useSidebarCollapse)
- `src/components/dashboard/` — all of it
- `src/components/session/` — SessionCard
- `src/components/resource-list/` — all of it
- `src/components/draft/` — DraftPage
- `src/components/skill/`, `src/components/mcp-server/` — detail views
- `src/hooks/` — all of it (dashboard, sessions, agents, skills, mcp-servers hooks)
- `src/config/navigation.ts`, `src/config/draft.ts`
- `src/utils/time.ts`
- `src/app/page.tsx` (dashboard)
- `src/app/run/` — entire directory
- `src/app/draft/` — entire directory
- `src/app/agents/` — entire directory
- `src/app/skills/` — entire directory
- `src/app/mcp-servers/` — entire directory
- `src/app/sessions/` — entire directory

**Acceptance criteria:**
- [ ] Only auth infra, UI primitives, providers, and error boundaries remain
- [ ] App compiles with an empty landing page

---

### T01.4: Web — App Shell (Three-Panel Layout)

**What**: Build the new application shell from scratch.

**Components to create:**
1. `src/components/layout/AppHeader.tsx` — top bar with Stigmer logo, org switcher, user menu, theme toggle
2. `src/components/layout/Sidebar.tsx` — left sidebar with:
   - "+ New Session" button (primary action, prominent)
   - "Recents" section — list of recent sessions
3. `src/components/layout/ContextPanel.tsx` — right-side collapsible panel (empty shell initially, populated in T01.6)
4. `src/components/layout/AppShell.tsx` — three-panel layout container

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│                    AppHeader                         │
├────────┬──────────────────────────────┬──────────────┤
│Sidebar │         Main Content         │ ContextPanel │
│        │                              │ (collapsible)│
│ [+New] │                              │              │
│ ────── │                              │              │
│ Recent │                              │              │
│  S1    │                              │              │
│  S2    │                              │              │
│  S3    │                              │              │
│        │                              │              │
└────────┴──────────────────────────────┴──────────────┘
```

**Acceptance criteria:**
- [ ] Three-panel layout renders correctly
- [ ] Sidebar collapses/expands
- [ ] Right context panel collapses/expands
- [ ] Responsive: context panel hidden on smaller screens
- [ ] Header shows Stigmer branding, org switcher, user menu

---

### T01.5: Web — New Session Launcher (Landing Page)

**What**: The default landing page at `/`. Shows the session launcher.

**Components:**
1. `src/app/page.tsx` — landing page
2. `src/components/session/SessionLauncher.tsx` — the launcher widget:
   - Heading: "What would you like to work on?" (or similar)
   - Large text area for the user's message
   - Controls row below the text area:
     - Workspace selector (dropdown: "No workspace", git repo URL input, local path)
     - Model selector (dropdown of available models)
     - "Start" button
   - Suggestion cards below (optional, stretch goal):
     - "Create an agent" -> routes to agent-creator
     - "Build a skill" -> routes to skill-creator
     - "Create an MCP server" -> routes to mcp-server-creator

**Behavior:**
- User types a message and clicks "Start"
- Frontend calls backend to create an execution (no agent_id — backend resolves default)
- On success, navigates to the active session view at `/sessions/[id]`

**Acceptance criteria:**
- [ ] Landing page shows text area, workspace picker, model picker, start button
- [ ] Submitting a message creates a session and navigates to the session view
- [ ] No agent selection is required

---

### T01.6: Web — Active Session View

**What**: The view at `/sessions/[id]` showing a live or completed session.

**Components:**
1. `src/app/sessions/[id]/page.tsx` — route wrapper
2. `src/components/session/SessionView.tsx` — main session view:
   - **Center**: Conversation thread (user messages + agent responses)
     - Reuses `ExecutionStream`, `MessageEntry`, `HumanMessageBubble` from `@stigmer/react/agent-execution`
     - Past executions rendered read-only
     - Active execution streams in real-time
     - Follow-up input at the bottom when session is idle
   - **Right context panel** (populates `ContextPanel` from T01.4):
     - "Progress" section — execution phase, completion status
     - "Context" section — files, tools, workspace info from `resolved_context`
     - "Execution" section — token usage, model, duration

**Behavior:**
- Session loads, fetches session data + execution list
- If an execution is in-progress, connect to the stream
- Show past execution messages in the thread
- Follow-up input appears when the current execution completes

**Acceptance criteria:**
- [ ] Session view loads and renders conversation thread
- [ ] Real-time streaming works for active executions
- [ ] Right panel shows execution metadata
- [ ] Follow-up messages continue in the same session
- [ ] HITL approval gates render and are actionable

---

### T01.7: Web — Sidebar Recents

**What**: Populate the sidebar with recent sessions.

**Components:**
1. `src/hooks/sessions/useRecentSessions.ts` — hook to fetch recent sessions
2. Sidebar integration — render session list with:
   - Session subject (or first message truncated)
   - Relative timestamp
   - Active session highlighted
   - Click navigates to `/sessions/[id]`

**Acceptance criteria:**
- [ ] Sidebar shows recent sessions for the current org
- [ ] Clicking a session navigates to its detail view
- [ ] Active session is visually highlighted
- [ ] "New Session" click resets to the launcher at `/`

---

## Implementation Order

```
T01.1 (Seedpack)  ──┐
                     ├──► T01.3 (Delete UI) ──► T01.4 (Shell) ──► T01.5 (Launcher) ──► T01.6 (Session View) ──► T01.7 (Recents)
T01.2 (Backend)   ──┘
```

T01.1 and T01.2 can be done in parallel. T01.3 through T01.7 are sequential (each builds on the previous).

## Design Decisions to Record

1. **"assistant" not "default"** — The seedpack agent is named `assistant` (a domain concept) with a `stigmer.ai/default-agent` label (a behavioral marker). "Default" describes selection behavior, not the agent's identity.

2. **Label-based resolution** — The backend finds the default agent by label query, not hardcoded ID. This allows orgs to override the default by labeling a different agent.

3. **Fresh start, not incremental refactor** — We delete all existing UI components and rebuild. This avoids legacy patterns influencing new code and gives a clean growth trajectory.

4. **Three-panel layout** — Left sidebar (nav), center (content), right (context). Right panel is collapsible. This matches the pattern established by Claude Cowork, Cursor, and other developer tools.

5. **Backend resolves default agent** — The frontend never needs to know about the default agent. It sends a message to the backend with no agent_id, and the backend figures it out. This keeps the frontend simple and avoids duplicating resolution logic.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Auth flow breaks during fresh start | Keep `src/auth/` entirely intact; test login flow immediately after T01.3 |
| `@stigmer/react` components assume specific layout | Audit component props; adapt wrapper if needed |
| Backend default agent resolution touches critical paths | Add resolution behind a feature flag or null-safe fallback |
| No default agent in org → user stuck | Show clear error: "No default agent configured. Contact your admin." |

## Next Steps After T01

- T02: Resource management pages (Agents, Skills, MCP Servers) — brought back with new navigation
- T03: Workflow views, settings
- T04: Embeddable component extraction
