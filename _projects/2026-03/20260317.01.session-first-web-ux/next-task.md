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
**Current Task**: T01.2 (Backend — Default Agent Resolution)
**Status**: In Progress

## Session Progress (2026-03-17)

### Completed: T01.1 — Seedpack Default Assistant Agent
- Created `seedpack/agents/assistant.yaml`
- Labels: `stigmer.ai/system: "true"`, `stigmer.ai/default-agent: "true"`
- Minimal general-purpose instructions — no tool enumeration, no MCP server usages
- Agent gets its tools from the runtime; instructions just set tone and action bias
- No changes needed to `embed.go` or `BUILD.bazel` (auto-pickup via glob)

### Key Decisions
1. **No MCP server usages** — the assistant is purely general-purpose, not a platform help desk. Platform browsing is a UI concern. Tools come from the runtime.
2. **Minimal instructions** — 5 lines. Identity, mission, tone, action bias, honesty. The LLM figures out the rest from its available tools.
3. **No skill_refs, sub_agents, or env_spec** — intentionally omitted to keep the agent as a clean slate.

## Next Steps
1. **T01.2**: Backend — Default Agent Resolution (add `FindDefaultAgent` query by label, wire into session/execution creation)
2. **T01.3**: Web — Delete existing UI, keep auth infrastructure
3. **T01.4**: Web — App Shell (three-panel layout)

## Context for Resume
- Branch: `feat/session-first-web-ux`
- T01.1 is committed. Ready to start T01.2.
- T01.2 touches `stigmer-cloud` repo (Java backend) — AgentRepo, session/execution creation handlers.
- The `stigmer.ai/default-agent: "true"` label is the contract between seedpack (T01.1) and backend (T01.2).

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260317.01.session-first-web-ux/next-task.md`

## Quick Commands

After loading context:
- "Continue with T01.2" - Start backend default agent resolution
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
