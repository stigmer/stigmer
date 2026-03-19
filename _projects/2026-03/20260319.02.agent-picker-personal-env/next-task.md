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
**Current Task**: Phase 1 complete — next is Phase 3 (backend env_spec filtering)
**Status**: Phase 1 Complete
**Last Session**: 2026-03-19 — Completed T01.11 (Phase 1 done)

## Session Progress (2026-03-19, Session 11)

- Completed T01.11: Console integration — wired agentRef into SessionLauncher
  - Modified `client-apps/web/src/components/session/SessionLauncher.tsx` (+5 lines)
  - Added `useState<ResourceRef | null>(null)` for `agentRef` — grouped with other context state (mcpServerUsages, skillRefs)
  - Passed `agentRef` and `onAgentRefChange={setAgentRef}` to `SessionComposer` — positioned between workspace and MCP server props (matching toolbar order)
  - Forwarded `agentRef: agentRef ?? undefined` to `createSession()` call — `?? undefined` coercion because state is `ResourceRef | null` but `CreateSessionInput.agentRef` is `ResourceRef | undefined`
  - Added `agentRef` to `handleSubmit` useCallback dependency array
  - Zero linter errors, zero TypeScript errors from the change (only pre-existing unrelated BigInt target error in useExecutionUsage.ts)
- **Phase 1 is now complete** (T01.1–T01.11). Agent picker is wired end-to-end: toolbar selection in SessionComposer → agentRef state in SessionLauncher → useCreateSession resolution to default instance.
- Design decisions confirmed for Phase 1:
  - No agent persistence in localStorage — agent selection is contextual per session, unlike model preference
  - No agent picker in SessionPage.tsx — follow-up messages are within an existing session already bound to an agent instance
  - Error handling for missing default instance flows through existing catch/toast pattern

## Session Progress (2026-03-19, Session 10)

- Completed T01.10: useCreateSession agent wiring — added `agentInstanceId` and `agentRef` to `CreateSessionInput`
  - Modified `sdk/react/src/session/useCreateSession.ts` (+65 lines, net change)
  - Extended `CreateSessionInput` with two new optional fields: `agentInstanceId?: string` (Profile A — platform builders) and `agentRef?: ResourceRef` (convenience resolution via agent's default instance)
  - Added agent instance resolution logic inside `create()` with clear priority: explicit `agentInstanceId` > `agentRef` (resolved via `agent.getByReference()` → `status.defaultInstanceId`) > omitted (backend resolves platform default)
  - Descriptive error when agent has no default instance: `"Agent 'org/slug' does not have a default instance. Pass an explicit agentInstanceId instead."`
  - Updated JSDoc: documents all three resolution strategies, provides `@example` blocks for each path (platform builder, agent reference, platform default)
  - Each field on `CreateSessionInput` has inline JSDoc with `{@link}` cross-references
  - TypeScript compiles cleanly, zero linter errors on modified file
- Architectural note: adding `agentRef` resolution (a single `agent.getByReference()` lookup) to a Layer 1 hook is a mild departure from "one thing per hook" but justified — it serves both profiles, avoids leaking SDK logic into the Console, and Phase 2 bypasses it entirely (orchestration hooks resolve to `agentInstanceId` before calling `createSession`)
- All Phase 1 SDK work is now complete (T01.1–T01.10). Remaining Phase 1 task: Console integration (T01.11).

## Session Progress (2026-03-19, Session 9)

- Completed T01.9: SessionComposer integration — wired AgentPicker into the composer toolbar
  - Modified `sdk/react/src/composer/SessionComposer.tsx` (+83 lines, net change)
  - Added `agentRef?: ResourceRef | null` and `onAgentRefChange?: (ref: ResourceRef | null) => void` props to `SessionComposerProps`
  - AgentPicker renders inside a `ContextPopover` as the **first** toolbar trigger (before Workspace, MCP, Skills) — per Design Decision 003
  - Extended `ChipItem["type"]` union with `"agent"` and `CHIP_TYPE_LABELS` with `agent: "Agent"`
  - Agent chip renders first in the chip row (highest impact context selection)
  - Visibility guard: `showAgent = onAgentRefChange != null && org != null` — consistent with MCP/Skills pattern
  - Added 14x14 `AgentIcon` matching the toolbar icon style (bot/robot metaphor, same as AgentPicker's internal icon)
  - Updated JSDoc: component description and `@example` block include agent props
  - Display name cache comment updated to include agents
  - TypeScript compiles cleanly, zero linter errors on modified file
- UX note: popover stays open after single-select (ContextPopover is uncontrolled). Acceptable for Phase 1; Phase 2 T02.4 will make it controlled for the picker-to-env-form transition.
- All Phase 1 integration work on SessionComposer is complete. Remaining Phase 1 tasks: useCreateSession wiring (T01.10), Console integration (T01.11).

## Session Progress (2026-03-19, Session 8)

- Completed T01.8: Barrel exports — wired agent, environment, and agent-instance modules into main `sdk/react/src/index.ts`
  - Added 3 new re-export sections following the established pattern (comment header, value exports, type exports)
  - Agent: `useAgentSearch`, `AgentPicker` + 3 types
  - Environment: `useEnvironment`, `useCreateEnvironment`, `useUpdateEnvironment` + 3 types
  - Agent Instance: `useAgentInstance`, `useCreateAgentInstance` + 2 types
  - TypeScript compiles cleanly, zero linter errors on modified file
- All Phase 1 building-block hooks and their barrel exports are now complete (T01.1–T01.8). Platform builders can `import { useAgentSearch, AgentPicker, useEnvironment, useCreateEnvironment, useUpdateEnvironment, useAgentInstance, useCreateAgentInstance } from "@stigmer/react"`.
- Remaining Phase 1 work is pure integration: SessionComposer (T01.9), useCreateSession (T01.10), Console (T01.11).

## Session Progress (2026-03-19, Session 7)

- Implemented T01.7: `useCreateAgentInstance` behavior hook
  - `sdk/react/src/agent-instance/useCreateAgentInstance.ts` — behavior hook wrapping `stigmer.agentInstance.create()` (~80 lines)
  - Updated `sdk/react/src/agent-instance/index.ts` — added `useCreateAgentInstance` + `UseCreateAgentInstanceReturn` exports
  - TypeScript compiles cleanly, zero linter errors on new/modified files
- Pattern: structurally identical to `useCreateEnvironment` — same `AgentInstanceInput` from `@stigmer/sdk`, return shape `{ create, isCreating, error, clearError }`, full `AgentInstance` proto returned
- This is the last new hook in Phase 1. Remaining tasks (T01.8–T01.11) are all integration/wiring work.

## Session Progress (2026-03-19, Session 6)

- Implemented T01.6: `useAgentInstance` data hook
  - `sdk/react/src/agent-instance/useAgentInstance.ts` — data hook fetching single AgentInstance by `ResourceRef` (~85 lines)
  - `sdk/react/src/agent-instance/index.ts` — barrel export for the agent-instance module
  - TypeScript compiles cleanly, zero linter errors on new files
- Naming decision: return property is `agentInstance` (not `instance`) — consistent with `useSession` → `session`, `useEnvironment` → `environment`. Full domain noun avoids ambiguity for platform builders destructuring multiple hooks.
- Pattern: structurally identical to `useEnvironment` — `ResourceRef | null` input, primitive destructuring for deps, cancellation flag, `refetch()` via `fetchKey` increment, error as `string | null`

## Session Progress (2026-03-19, Session 5)

- Implemented T01.5: `useUpdateEnvironment` behavior hook
  - `sdk/react/src/environment/useUpdateEnvironment.ts` — behavior hook wrapping `stigmer.environment.update()` (~75 lines)
  - Updated `sdk/react/src/environment/index.ts` — added `useUpdateEnvironment` + `UseUpdateEnvironmentReturn` exports
  - TypeScript compiles cleanly, zero linter errors on new/modified files
- Pattern: structurally identical to `useCreateEnvironment` and `useUpdateSession` — same `EnvironmentInput` from `@stigmer/sdk`, return shape `{ update, isUpdating, error, clearError }`, full `Environment` proto returned

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

1. **Phase 3 (T03.1–T03.3)** — Backend env_spec whitelist filter in `envmerge` (security: must ship before personal environments accumulate secrets)
2. **Phase 2 (T02.1–T02.5)** — Personal env orchestration, AgentEnvForm, inline env var collection (depends on Phase 1)
3. **Phase 4 (T04.1–T04.3)** — GitHub token migration from localStorage to server-side personal env (depends on Phase 2)

## Context for Resume

- **Phase 1 is fully complete** (T01.1–T01.11). Agent selection is wired end-to-end from the SessionComposer toolbar through SessionLauncher to useCreateSession.
- The recommended execution order going forward is: **Phase 3 → Phase 2 → Phase 4**
- Phase 3 is backend-only (Go, `backend/libs/go/envmerge/merge.go`) and independent of frontend work. It adds env_spec whitelist filtering so agents only receive env vars they declared.
- Phase 2 builds Layer 2 orchestration hooks (`usePersonalEnvironment`, `usePersonalAgentInstance`) on top of the Layer 1 building blocks from Phase 1. It also adds `AgentEnvForm` and the picker-to-env-form transition in SessionComposer.
- Phase 4 migrates the GitHub OAuth token from browser localStorage to the server-side personal Environment, using the infrastructure from Phase 2.
- All Layer 1 hooks and components are importable from `@stigmer/react`: `useAgentSearch`, `AgentPicker`, `useEnvironment`, `useCreateEnvironment`, `useUpdateEnvironment`, `useAgentInstance`, `useCreateAgentInstance`, `useCreateSession` (with agentRef/agentInstanceId)
- `useCreateSession` resolution priority: `agentInstanceId` > `agentRef` (resolved via `agent.getByReference()` → `status.defaultInstanceId`) > omitted (backend default)
- SessionComposer accepts `agentRef` / `onAgentRefChange` — Agent trigger appears first in toolbar (before Workspace, MCP, Skills)
- `AgentPicker` is single-select: `value: ResourceRef | null`, `onChange: (ref: ResourceRef | null) => void`
- Data hooks fetch by `ResourceRef` (not ID string): `useEnvironment`, `useAgentInstance` both include `refetch()` for Phase 2 orchestration
- Return property naming: full domain noun (`session`, `environment`, `agentInstance`) — never abbreviated
- Pickers are self-contained by design — each evolves independently
- Key reference files: `sdk/react/src/skill/SkillPicker.tsx`, `sdk/react/src/composer/SessionComposer.tsx`, `sdk/react/src/session/useSession.ts`

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260319.02.agent-picker-personal-env/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
