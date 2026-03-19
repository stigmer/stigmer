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
**Current Task**: Two-flow secret delivery reframe — documentation and SDK surface complete
**Status**: Phase 5 Complete + Secret delivery reframe complete
**Last Session**: 2026-03-19 Session 17 — Reframed secret delivery from "two profiles" to "two flows" (Environment Flow + Execution Flow), exposed `runtimeEnv` in React SDK, updated JSDoc across 16 files, created `how-to-provide-secrets.md` product guide

## Session Progress (2026-03-19, Session 17)

- **Reframed secret delivery architecture** from "two profiles" (Platform Builders vs Direct Users) to "two flows" (Environment Flow vs Execution Flow) with orthogonal orchestration levels (Layer 1 vs Layer 2)
- **Updated Design Decision DD-005** (`design-decisions/005-two-profile-hook-layering.md`): Full rewrite to "Two-Flow Secret Delivery and Hook Layering" — documents the two orthogonal dimensions and maps all hooks/components into a flow x layer matrix
- **Exposed `runtimeEnv` in React SDK** (critical Execution Flow gap):
  - `useCreateAgentExecution` — added `runtimeEnv?: Record<string, EnvVarInput>` to `CreateAgentExecutionInput`, passes through to SDK client
  - `useSessionConversation` — added `runtimeEnv` to `SendFollowUpOptions`, forwards to execution creation
  - Full JSDoc with dual-flow examples on both hooks
- **Updated JSDoc across 16 hook/component files** — replaced "Profile A/B" language with "Environment Flow" / "Execution Flow" annotations, added cross-references to product docs
- **Created `docs/product/how-to-provide-secrets.md`** (264 lines) — comprehensive product guide covering both flows with decision table, merge priority, React/TS/CLI code examples, and hook reference tables
- **Added cross-references** in 4 existing product docs: `what-is-environment.md`, `what-is-execution-context.md`, `what-is-agent-execution.md`, `what-is-agent-instance.md`
- Files modified: 24 files changed, 1 new file, +276/-144 lines

## Session Progress (2026-03-19, Session 16)

- **New Feature: Settings page with environment management**
  - Built SDK-first: 3 new components in `@stigmer/react`, then consumed in Console
  - All TypeScript compilation clean (zero new errors)
- **SDK components (`@stigmer/react`)**:
  - `EnvironmentVariableEditor` (`sdk/react/src/environment/EnvironmentVariableEditor.tsx`, ~800 lines)
    - Self-contained component: fetches environment by ID, renders editable variable table
    - Inline per-variable editing with immediate save (maps to `updateVariables` RPC)
    - Secret value reveal via `getSecretValue` RPC (30s auto-clear)
    - Inline delete confirmation, collapsible "Add variable" form
    - Internal sub-components: `VariableRow`, `AddVariableForm`, `ActionButton`
    - All icons inline SVGs (no icon library dependency in SDK)
  - `EnvironmentListPanel` (`sdk/react/src/environment/EnvironmentListPanel.tsx`, ~250 lines)
    - Lists environments for an org with expandable inline variable editors
    - `labels` filter (include) and `excludeLabels` filter (exclude personal env from shared list)
    - Accordion pattern: one environment expanded at a time
  - `CreateEnvironmentForm` (`sdk/react/src/environment/CreateEnvironmentForm.tsx`, ~185 lines)
    - Name (required) + description (optional), wraps `useCreateEnvironment`
  - Updated barrel exports in `sdk/react/src/environment/index.ts` and `sdk/react/src/index.ts`
- **Console integration (`client-apps/web`)**:
  - `/settings` route (`client-apps/web/src/app/settings/page.tsx`) — server component, heading + EnvironmentsSection
  - `EnvironmentsSection` (`client-apps/web/src/components/settings/EnvironmentsSection.tsx`, ~170 lines)
    - **Personal Environment** (top, always expanded): auto-created via `usePersonalEnvironment.getOrCreate()`, "You" badge
    - **Shared Environments** (below): `EnvironmentListPanel` with personal env excluded, "New environment" button + `CreateEnvironmentForm`
  - `UserMenu` — added `SettingsItem` with gear icon + `router.push("/settings")` in both authenticated and local-mode dropdowns
- Key design decisions:
  - Inline per-variable save (matches GitHub Actions / Vercel / Netlify env var UX — Jakob's Law)
  - Personal environment auto-created on settings page visit (consistent with agent setup flow)
  - `EnvironmentVariableEditor` takes `environmentId` and is fully self-contained (platform builders: drop-in embeddability)
  - Settings entry via UserMenu dropdown (not sidebar) — user preference, standard avatar-menu convention
  - SDK components use `--stgm-*` tokens, no Console-specific dependencies

## Session Progress (2026-03-19, Session 15)

- Completed Phase 4: GitHub token migration from localStorage to server-side personal environment
- **T04.0 — Prerequisite cleanup**: Removed `TODO(codegen)` type cast in `useRevealSecretValue.ts`
  - Replaced unsafe `Record<string, unknown>` cast with typed `stigmer.environment.getSecretValue()` using `create(EnvironmentSecretValueInputSchema, ...)` from `@bufbuild/protobuf`
  - SDK was already regenerated with `getSecretValue` on `EnvironmentClient` — cast was stale
- **T04.1 — Core `useGitHubConnection` rewrite** (`sdk/react/src/github/useGitHubConnection.ts`, +167 lines):
  - New signature: `useGitHubConnection(org: string | null)` — breaking change (was no-arg)
  - Composes `usePersonalEnvironment(org)` internally for server-side token storage
  - **Dual-source mount strategy** with two-phase reconciliation:
    - Phase 1 (instant): reads localStorage for zero-latency provisional state
    - Phase 2 (async): reconciles with personal environment when it loads
  - Four reconciliation cases: A) server + local → clear local, B) server only → reveal + validate, C) local only → migrate to server, D) neither → not connected
  - Migration uses `getOrCreate(initialData)` for new envs, `addVariables` for existing — avoids ref-timing issue where `environmentRef.current` isn't updated after `getOrCreate`
  - `disconnect()` now removes from both personal env (fire-and-forget) and localStorage
  - Helper `personalEnvHasKey()` checks redacted env data for key presence without revealing
  - Calls SDK `getSecretValue` directly (not `useRevealSecretValue`) — token needs to persist in memory, not auto-clear after 30s
  - `handleCallback` unchanged — still stages to localStorage, migration happens on next mount
  - Return type `UseGitHubConnectionReturn` unchanged — zero breaking change for consumers of the return value
- **T04.2 — Console consumer updates** (3 files, +12/-3 lines):
  - `SessionLauncher.tsx`: `useGitHubConnection()` → `useGitHubConnection(org)` (org from `useActiveOrgSlug()`)
  - `SessionPage.tsx`: same one-line change
  - `callback/page.tsx`: added `useActiveOrgSlug()` import, passes `org || null`, updated JSDoc
- **Verification**: zero new TypeScript errors in `sdk/react` or `client-apps/web` (pre-existing only)
- Key design decisions:
  - localStorage as fast cache (not primary storage) — preserves instant mount UX
  - `org: string | null` parameter — `null` falls back to localStorage-only mode (backward compat)
  - Token stored as `GITHUB_TOKEN` with `isSecret: true` in personal env — Phase 3 env_spec filter correctly excludes it from agent executions
  - Callback page still stages to localStorage — avoids race condition with personal env loading

## Session Progress (2026-03-19, Session 14)

- Completed Phase 3: Backend env_spec whitelist filter — both Go (stigmer OSS) and Java (stigmer-cloud)
- **Go changes (stigmer OSS)**:
  - Added `FilterByEnvSpec` function to `backend/libs/go/envmerge/merge.go` (~30 lines)
  - Applied filter in agent + workflow `create_execution_context_step.go` with warn-level logging of excluded keys
  - Created `backend/libs/go/envmerge/merge_test.go` with 20 table-driven tests (retroactive MergeEnvironmentLayers + new FilterByEnvSpec)
  - Updated `BUILD.bazel` with `go_test` rule
- **Java changes (stigmer-cloud)**:
  - Added `EnvSpecFilterResult` record + `filterByEnvSpec` static method to `EnvironmentMergeService.java`
  - Applied filter in agent + workflow `CreateExecutionContextStep.java` (between merge and MCP validation)
  - Added `FilterByEnvSpecTests` nested class to `EnvironmentMergeServiceTest.java` (7 tests)
- All Go tests pass (20 total), Java service library compiles cleanly via Bazel
- Key decision: filter placed BEFORE `McpEnvironmentValidator` in Java — missing MCP vars due to env_spec misconfiguration now fail fast with a clear validation error
- Backward compat: nil/empty env_spec = all vars pass through (no behavior change for legacy agents/workflows)

## Session Progress (2026-03-19, Session 13)

- Completed T02.3: `AgentEnvForm` component
  - `sdk/react/src/agent/AgentEnvForm.tsx` — pure presentational form (~270 lines)
  - Renders labeled input fields from agent's env_spec (one per variable)
  - `type="password"` with eye toggle for `isSecret: true` variables
  - Validation: submit disabled until all fields are non-empty
  - Props: `agentName`, `variables: AgentEnvFormVariable[]`, `onSubmit`, `onCancel`, `isSubmitting`
  - Output type: `Record<string, EnvVarInput>` — includes `isSecret` per value for direct `addVariables` passthrough
  - Width `w-72` matches AgentPicker for seamless popover transition
  - Pure form: no API calls, no knowledge of personal environments
  - Exported types: `AgentEnvFormProps`, `AgentEnvFormVariable`
- Completed T02.3.5: `useAgentSetup` behavior hook (Layer 2)
  - `sdk/react/src/agent/useAgentSetup.ts` (~240 lines)
  - Encapsulates the full agent selection + personal environment resolution flow
  - `resolveAgent(ref)` — fetches full agent, checks env_spec, checks personal instance, diffs env vars, returns `"ready"` or `"needsEnvVars"`
  - `submitEnvVars(values)` — getOrCreate personal env, addVariables, create personal instance, returns `"ready"` with instanceId
  - Composes `usePersonalEnvironment(org)` for env operations; uses `useStigmer()` directly for agent + instance queries
  - Stores pending agent in `useRef` between `resolveAgent` and `submitEnvVars`
  - Discriminated union return type: `AgentSetupResult = { status: "ready" | "needsEnvVars", ... }`
- Completed T02.4: SessionComposer integration
  - Modified `sdk/react/src/composer/SessionComposer.tsx` (+191 lines, net change)
  - New prop: `onAgentInstanceIdChange?: (instanceId: string | null) => void`
  - Agent popover now **controlled** (`open`/`onOpenChange` on `Popover.Root`) — other popovers remain uncontrolled
  - `ContextPopover` extended with optional `open`/`onOpenChange` props
  - Agent selection intercepted through `useAgentSetup.resolveAgent()`:
    - If ready → set refs, resolve display name, close popover
    - If needsEnvVars → transition popover from `AgentPicker` to `AgentEnvForm`
  - Env form cancel → back to picker view; popover dismiss → reset view
  - Loading overlay (`ResolveSpinner`) while `resolveAgent` is in-flight
  - Inline error display for both resolve and submit failures
  - Agent chip removal clears both `agentRef` and `agentInstanceId`
- Completed T02.4.5: SessionLauncher update
  - Modified `client-apps/web/src/components/session/SessionLauncher.tsx` (+4 lines)
  - Added `agentInstanceId` state, wired to `SessionComposer.onAgentInstanceIdChange`
  - Passed `agentInstanceId: agentInstanceId ?? undefined` to `createSession()`
  - `useCreateSession` already handles priority: `agentInstanceId > agentRef > omitted`
- Updated barrel exports: `agent/index.ts` and `sdk/react/src/index.ts`
- TypeScript verification: zero new errors (9 pre-existing errors in unrelated files)
- Key design decisions:
  - AgentEnvForm is pure presentational (Layer 1) — reusable by platform builders
  - useAgentSetup is a Layer 2 behavior hook — composes usePersonalEnvironment + direct client calls
  - Controlled popover only for Agent (others uncontrolled) — minimal change surface
  - Display name resolved from full agent metadata after `resolveAgent` (not just from picker)
  - `onAgentInstanceIdChange` is the bridge: SessionComposer resolves, SessionLauncher stores, createSession uses

## Session Progress (2026-03-19, Session 12)

- Completed T02.1: Upgraded `usePersonalEnvironment` to full orchestration hook
  - Added `getOrCreate(initialData?)` — creates personal env with slug `"personal"`, labels, optional initial data
  - Added `addVariables(variables)` — server-side merge via `updateVariables` RPC, proto construction internal
  - Added `removeVariables(keys)` — server-side removal via `removeVariables` RPC
  - Added `isMutating` — unified boolean for any mutation in-flight
  - Uses `useRef` for stable env reference; unified `error` state (mutation > list)
- Completed T02.2: Upgraded `usePersonalAgentInstance` to full orchestration hook
  - Added `getOrCreate({ agentSlug, personalEnvironmentRef })` — creates instance with slug `"{agentSlug}-personal"`, labels `stigmer.ai/personal` + `stigmer.ai/for-agent`, agent binding, environment linkage
  - Added `isMutating` boolean
  - New exported type: `GetOrCreatePersonalInstanceInput`
  - `agentId` optional for read-only, required for `getOrCreate` (descriptive error)
- Updated barrel exports: `agent-instance/index.ts` and `sdk/react/src/index.ts`
- TypeScript verification: zero new errors (pre-existing errors in unrelated files only)
- Key design decisions:
  - Extend existing hooks in place (backward compatible return type expansion)
  - SDK client directly for mutations, Layer 1 data hooks for reading (unified state)
  - List+labels for existence check (not getByReference — graceful empty result)
  - `getOrCreate` with optional initial data (saves round-trip for first-time users)
  - Naming conventions fully encapsulated (callers never construct label strings)

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

1. **T02.5** — Manual e2e validation: walkthrough of agent picker → env form → session creation flow against real backend
2. **Manual validation of Settings page** — verify environment management UI end-to-end against real backend
3. **Commit & PR all uncommitted stigmer OSS work** — Phases 1–5 + sub-projects on `feat/add-customize-ui` branch
4. **Commit & PR stigmer-cloud work** — Java env_spec filter + list handlers uncommitted on `feat/add-customize-ui`

## Context for Resume

- **All 5 phases are code-complete + secret delivery reframe done**:
  - Phase 1 (T01.1–T01.11): Agent picker wired end-to-end
  - Phase 2 (T02.1–T02.4): Personal env flow, AgentEnvForm, useAgentSetup, SessionComposer integration
  - Phase 3: env_spec whitelist filter in Go + Java
  - Phase 4: GitHub token migrated to server-side personal environment
  - Phase 5: Settings page with environment management (SDK components + Console integration)
  - Session 17: Two-flow secret delivery reframe — DD-005 rewrite, runtimeEnv in React SDK, JSDoc pass, product docs
- **T02.5 (manual e2e validation)** is the remaining task before shipping
- **Important**: Both repos have uncommitted work on `feat/add-customize-ui` — commit and PR needed
- **Session 17 key changes**:
  - `runtimeEnv` now exposed on `useCreateAgentExecution` and `useSessionConversation.sendFollowUp` — enables Execution Flow from React SDK
  - DD-005 rewritten: "Two-Flow Secret Delivery and Hook Layering" — orthogonal model (flow x layer)
  - All hooks/components JSDoc updated from "Profile A/B" to "Environment Flow" / "Execution Flow"
  - New product doc: `docs/product/how-to-provide-secrets.md` — canonical guide for secret delivery
  - Cross-references added to `what-is-environment.md`, `what-is-execution-context.md`, `what-is-agent-execution.md`, `what-is-agent-instance.md`
- **New SDK exports** from `@stigmer/react`: `EnvironmentVariableEditor`, `EnvironmentListPanel`, `CreateEnvironmentForm` + prop types
- **New Console route**: `/settings` — accessible from UserMenu dropdown (both authenticated + local mode)
- Settings page auto-creates personal environment on visit via `usePersonalEnvironment.getOrCreate()`
- `EnvironmentVariableEditor` fetches environment by ID via `stigmer.environment.get()` and manages all CRUD inline
- `EnvironmentListPanel` uses `excludeLabels` to filter personal env from the shared environment list
- `useGitHubConnection(org)` now takes `org: string | null` — breaking change for platform builders (was no-arg). `null` gives localStorage-only fallback.
- Token stored as `GITHUB_TOKEN` (isSecret: true) in personal environment. Dual-source mount: localStorage fast read → server reconciliation → migration → cleanup.
- `useRevealSecretValue` TODO(codegen) cast cleaned up — now uses typed SDK client
- Key reference files for Session 17: `sdk/react/src/execution/useCreateAgentExecution.ts`, `sdk/react/src/session/useSessionConversation.ts`, `docs/product/how-to-provide-secrets.md`, `design-decisions/005-two-profile-hook-layering.md`
- Key reference files for Phase 4: `sdk/react/src/github/useGitHubConnection.ts`, `sdk/react/src/environment/useRevealSecretValue.ts`, `client-apps/web/src/app/auth/github/callback/page.tsx`

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260319.02.agent-picker-personal-env/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*

## Sub-Projects

Active sub-projects spawned from this project:

- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.03.sp.env-auth-and-secret-redaction/next-task.md` - Update FGA authorization model to support personal environments (member-level creation permissions) and implement secret value redaction in environment queries with owner-only secret retrieval.
- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.04.sp.env-instance-list-rpcs/next-task.md` - Add label-based list RPCs for environments, agent instances, and other resource types that currently lack list/query capabilities. Enables personal resource lookup via labels instead of deterministic slug conventions, establishing a reusable pattern for all resource kinds.
- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/next-task.md` - Add labels support to all SDK resource input types (codegen fix) and add incremental environment variable management RPCs (updateVariables, removeVariables) with backend sentinel defense-in-depth.
