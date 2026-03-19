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
**Current Task**: T01.5 — `useUpdateEnvironment` behavior hook
**Status**: In Progress (Phase 1)
**Last Session**: 2026-03-19 — Completed T01.1 + T01.2 + T01.3 + T01.4

## Session Progress (2026-03-19, Session 4)

- Implemented T01.4: `useCreateEnvironment` behavior hook
  - `sdk/react/src/environment/useCreateEnvironment.ts` — behavior hook wrapping `stigmer.environment.create()` (~75 lines)
  - Updated `sdk/react/src/environment/index.ts` — added `useCreateEnvironment` + `UseCreateEnvironmentReturn` exports
  - TypeScript compiles cleanly, zero linter errors
- Key design decisions in this hook:
  - Uses `EnvironmentInput` from `@stigmer/sdk` directly — no wrapper type (follows `useUpdateSession` pattern with `SessionInput`)
  - Returns full `Environment` proto (not just an ID) — callers get immediate access to server-generated metadata; Layer 2 orchestration hook needs this for resource reference extraction
  - No auto-naming — environments are named resources with semantic identifiers; the "personal" convention belongs in Layer 2's `usePersonalEnvironment`
  - Return shape: `{ create, isCreating, error, clearError }` — consistent with all existing behavior hooks

## Session Progress (2026-03-19, Session 3)

- Implemented T01.3: `useEnvironment` data hook
  - `sdk/react/src/environment/useEnvironment.ts` — first hook in the SDK that fetches by `ResourceRef` (~87 lines)
  - `sdk/react/src/environment/index.ts` — barrel export for the environment module
  - TypeScript compiles cleanly, zero linter errors
- Key design decisions in this hook:
  - Accepts `ResourceRef | null` (null skips fetch, consistent with `useSession(null)`)
  - Destructures `ref` into primitives (`org`, `slug`, `version`) for `useEffect` deps to avoid object identity re-fetch issues
  - Includes `refetch()` via `fetchKey` increment pattern (from `useSessionList`) — needed by Phase 2 orchestration hook
  - Error stored as `string | null` (consistent with all existing hooks; Phase 2 orchestration hook will call SDK directly for 404 detection in get-or-create flow)

## Session Progress (2026-03-19, Session 2)

- Implemented T01.2: `AgentPicker` component
  - `sdk/react/src/agent/AgentPicker.tsx` — self-contained single-select picker (~280 lines)
  - Updated `sdk/react/src/agent/index.ts` — added `AgentPicker` + `AgentPickerProps` exports
  - TypeScript compiles cleanly, zero linter errors
- Analyzed picker code duplication (SkillPicker, McpServerPicker, AgentPicker)
  - Decided: self-contained pickers are the right pattern — single-select vs multi-select behavior is fundamentally different, and McpServerPicker will diverge further (per-tool selection)
  - Documented rationale: bounded duplication (3 pickers), Rule of Three, premature abstraction risk

## Session Progress (2026-03-19, Session 1)

- Completed full project planning (T01_0_plan.md) covering all 4 phases
- Created 5 design decision documents (personal env pattern, resource identification, single-select picker, frontend orchestration, two-profile hook layering)
- Implemented T01.1: `useAgentSearch` data hook
  - `sdk/react/src/agent/useAgentSearch.ts` — follows `useSkillSearch`/`useMcpServerSearch` pattern exactly
  - `sdk/react/src/agent/index.ts` — minimal barrel export
  - TypeScript compiles cleanly, zero linter errors

## Next Steps

1. **T01.5** — `useUpdateEnvironment` behavior hook
3. **T01.6** — `useAgentInstance` data hook
4. **T01.7** — `useCreateAgentInstance` behavior hook
5. **T01.8** — Barrel exports (agent, environment, agent-instance modules + main index.ts)
6. **T01.9** — SessionComposer integration
7. **T01.10** — `useCreateSession` wiring
8. **T01.11** — Console integration (SessionLauncher)

## Context for Resume

- The `useAgentSearch` hook wraps `stigmer.agent.list()` via `useResourceSearch`
- `AgentPicker` is a **single-select** component: `value: ResourceRef | null`, `onChange: (ref: ResourceRef | null) => void`
- AgentPicker follows the structural pattern of SkillPicker/McpServerPicker but with single-select semantics: clicking a result replaces the current selection, deselect calls `onChange(null)`
- AgentPicker uses `ApiResourceKind.agent` and its own `AgentIcon` (bot/robot metaphor)
- `useEnvironment` is the **first hook that fetches by `ResourceRef`** (not by ID string like `useSession`). It uses `stigmer.environment.getByReference({ org, slug, version })` and destructures the ref into primitives for the dependency array
- `useEnvironment` includes `refetch()` (unlike `useSession`) — needed by Phase 2 `usePersonalEnvironment` orchestration hook after mutations
- `useCreateEnvironment` follows the `useUpdateSession` pattern exactly — uses `EnvironmentInput` from `@stigmer/sdk` directly, returns full `Environment` proto
- T01.5 (`useUpdateEnvironment`) is the same pattern as T01.4 — structurally identical, wraps `stigmer.environment.update()` instead of `create()`
- Barrel exports exist at `sdk/react/src/agent/index.ts` and `sdk/react/src/environment/index.ts` but are NOT yet added to main `sdk/react/src/index.ts` — deferred to T01.8
- Pickers are self-contained by design — each will evolve independently (McpServerPicker will add per-tool selection, AgentPicker will add env form transition in Phase 2)
- Key reference files: `sdk/react/src/skill/SkillPicker.tsx` (multi-select pattern), `sdk/react/src/composer/SessionComposer.tsx` (ContextPopover integration pattern), `sdk/react/src/session/useSession.ts` (single-resource fetch pattern)

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260319.02.agent-picker-personal-env/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
