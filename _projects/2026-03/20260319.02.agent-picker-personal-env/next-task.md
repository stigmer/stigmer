# Next Task: 20260319.02.agent-picker-personal-env

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260319.02.agent-picker-personal-env

**Description**: Add AgentPicker component to SessionComposer with automatic personal environment and agent instance management. Users pick an agent from the toolbar, env vars are collected inline on first use, and personal environments store secrets server-side. The agent only receives env vars it declared in its env_spec (least-privilege filtering).
**Goal**: Enable seamless agent selection in the session composer with automatic personal environment creation, inline env var collection, env_spec whitelist filtering in the backend merge logic, and GitHub token migration from localStorage to server-side personal environment.
**Tech Stack**: TypeScript/React, Go (backend env merge), Protobuf, OpenFGA
**Components**: sdk/react (AgentPicker, useAgentSearch, SessionComposer), sdk/typescript (useCreateSession), backend/libs/go/envmerge (env_spec filtering), client-apps/web (SessionLauncher), FGA model (labels)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-19 10:05
**Current Task**: T01.2 — `AgentPicker` component
**Status**: In Progress (Phase 1)
**Last Session**: 2026-03-19 — Completed planning + T01.1

## Session Progress (2026-03-19)

- Completed full project planning (T01_0_plan.md) covering all 4 phases
- Created 5 design decision documents (personal env pattern, resource identification, single-select picker, frontend orchestration, two-profile hook layering)
- Implemented T01.1: `useAgentSearch` data hook
  - `sdk/react/src/agent/useAgentSearch.ts` — follows `useSkillSearch`/`useMcpServerSearch` pattern exactly
  - `sdk/react/src/agent/index.ts` — minimal barrel export
  - TypeScript compiles cleanly, zero linter errors

## Next Steps

1. **T01.2** — `AgentPicker` component (single-select variant of the picker pattern)
2. **T01.3** — `useEnvironment` data hook
3. **T01.4** — `useCreateEnvironment` behavior hook
4. **T01.5** — `useUpdateEnvironment` behavior hook
5. **T01.6** — `useAgentInstance` data hook
6. **T01.7** — `useCreateAgentInstance` behavior hook
7. **T01.8** — Barrel exports (agent, environment, agent-instance modules + main index.ts)
8. **T01.9** — SessionComposer integration
9. **T01.10** — `useCreateSession` wiring
10. **T01.11** — Console integration (SessionLauncher)

## Context for Resume

- The `useAgentSearch` hook is a mechanical copy of the `useSkillSearch` pattern — wraps `stigmer.agent.list()` via `useResourceSearch`
- Type aliases (`UseAgentSearchOptions`, `UseAgentSearchReturn`) give room to extend later without breaking consumers
- Barrel export exists at `sdk/react/src/agent/index.ts` but is NOT yet added to main `sdk/react/src/index.ts` — deferred to T01.8
- Key reference files for the pattern: `sdk/react/src/skill/useSkillSearch.ts`, `sdk/react/src/mcp-server/useMcpServerSearch.ts`, `sdk/react/src/search/useResourceSearch.ts`
- AgentPicker (T01.2) will be a **single-select** variant unlike the existing multi-select SkillPicker/McpServerPicker — see design decision 003

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260319.02.agent-picker-personal-env/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
