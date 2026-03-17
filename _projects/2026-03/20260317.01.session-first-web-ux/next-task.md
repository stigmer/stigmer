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
**Current Task**: T01.4 (Web — App Shell)
**Status**: In Progress

## Session Progress (2026-03-17)

### Completed: T01.1 — Seedpack Default Assistant Agent
- Created `seedpack/agents/assistant.yaml`
- Labels: `stigmer.ai/system: "true"`, `stigmer.ai/default-agent: "true"`
- Minimal general-purpose instructions — no tool enumeration, no MCP server usages
- Agent gets its tools from the runtime; instructions just set tone and action bias
- No changes needed to `embed.go` or `BUILD.bazel` (auto-pickup via glob)

### In Progress: T01.2 — Backend Default Agent Resolution
- Being worked on in a separate conversation
- Touches `apis/`, `backend/libs/go/store/` (interface + sqlite implementation)
- Changes are unstaged on `feat/session-first-web-ux` branch

### Completed: T01.3 — Web UI Teardown
- Deleted ~55 files: all layout components, dashboard, resource pages, hooks, draft/run flows, config files, utils
- Modified `layout.tsx`: removed `AppShell` import and wrapper, trimmed metadata
- Replaced `page.tsx` with minimal placeholder (server component, no imports from deleted modules)
- Preserved: `src/auth/` (9 files), `src/contexts/org-context.tsx`, `Providers.tsx`, `StigmerTransportBridge.tsx`, `src/components/ui/` (10 shadcn primitives), `src/config/env.ts`, error boundaries, `globals.css`
- Build passes (`npm run build` — zero errors, 2 static routes)
- Lint passes (`npm run lint` — zero errors)

### Key Decisions
1. **No MCP server usages** — the assistant is purely general-purpose, not a platform help desk. Platform browsing is a UI concern. Tools come from the runtime.
2. **Minimal instructions** — 5 lines. Identity, mission, tone, action bias, honesty. The LLM figures out the rest from its available tools.
3. **No skill_refs, sub_agents, or env_spec** — intentionally omitted to keep the agent as a clean slate.
4. **Fresh start, not incremental refactor** — Deleted all existing UI and rebuilt from scratch. Avoids legacy patterns influencing new code.
5. **package.json untouched** — Temporarily unused deps (`react-markdown`, `remark-gfm`, `@base-ui/react`) will be needed in T01.5/T01.6. No premature cleanup.
6. **Font declarations kept in layout.tsx** — Six fonts loaded. T01.4 may revise, but removing now is unnecessary churn.

## Next Steps
1. **T01.4**: Web — App Shell (three-panel layout: sidebar, main content, collapsible right context panel)
2. **T01.5**: Web — New Session Launcher (landing page at `/`)
3. **T01.6**: Web — Active Session View (`/sessions/[id]`)
4. **T01.7**: Web — Sidebar Recents

## Context for Resume
- Branch: `feat/session-first-web-ux`
- T01.1 committed (`ca2b2554`). T01.3 committed. T01.2 in progress (separate conversation).
- The web app is a clean slate: auth infra + UI primitives + provider tree. No pages, no layout, no hooks.
- Post-teardown file tree has 31 files in `src/`. Build and lint pass clean.
- `run/page.tsx` in git history is valuable reference for T01.5/T01.6 — shows exact `@stigmer/react` import patterns (`AgentPicker`, `ExecutionStream`, `MessageInput`, `useAgentExecution`, `useApproval`).
- T01.4 components to create: `AppHeader.tsx`, `Sidebar.tsx`, `ContextPanel.tsx`, `AppShell.tsx` in `src/components/layout/`.

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260317.01.session-first-web-ux/next-task.md`

## Quick Commands

After loading context:
- "Continue with T01.4" - Start building the three-panel app shell
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
