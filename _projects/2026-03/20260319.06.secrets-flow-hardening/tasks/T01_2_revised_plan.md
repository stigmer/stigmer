# Task T01: Secrets Flow Hardening — Revised Plan

**Created**: 2026-03-19
**Revised**: 2026-03-20
**Status**: APPROVED
**Type**: Refactoring + UX Unification

---

## Context

The backend supports three codepaths for providing secrets: personal environments, shared environments, and execution-time runtimeEnv. All three are architecturally sound.

**The revision**: The user-facing model collapses these into **two concepts**:

- **Saved secrets** — Environments (personal or shared), persistent, reusable
- **One-time secrets** — runtimeEnv, ephemeral, per-execution

The "personal vs shared environment" distinction is scope/ownership, not a separate flow. The inline secret collection (AgentEnvForm) gains a "Save for future runs" toggle that routes to the correct codepath under the hood.

---

## Task Breakdown

### T01: Fix Incorrect CLI Commands in Documentation
**Risk**: Low | **Blast radius**: Documentation only | **Effort**: Small

The `how-to-provide-secrets.md` document references CLI commands that don't exist.

| Documented Command | Reality |
|---|---|
| `stigmer environment apply env.yaml` | No `environment` command in CLI. `apply` doesn't support Environment kind. |
| `stigmer agent instance create --agent my-agent --env prod-credentials` | No `agent instance` subcommands exist. |
| `stigmer run my-agent "..." --instance github-bot-prod` | No `--instance` flag on `run`. |
| `stigmer run my-agent "..." --env KEY=val --secret KEY=val` | **This one is correct.** |

**Action**: Option (c) — Show only the Execution Flow CLI (which works) and defer Environment Flow CLI examples. Add a note: "CLI support for environment and agent instance management is planned."

**Decisions**: Resolved. Option (c) approved.

---

### T02: Harden `useAgentSetup` with Unified Save-or-Use-Once Model
**Risk**: Medium | **Blast radius**: `useAgentSetup`, `SessionComposer`, `usePersonalAgentInstance`, `AgentEnvForm` | **Effort**: Large

**Problem — four issues (original three + unified model)**:

**2a. Fragile ref-based state.** `useAgentSetup` uses `pendingRef.current` to hold agent state between `resolveAgent()` and `submitEnvVars()`. `SessionComposer` uses `pendingEnvRef.current` for env form data. Refs don't trigger re-renders and can hold stale values on rapid agent switching.

**2b. Duplicated instance creation logic.** `useAgentSetup` creates personal instances directly via `stigmer.agentInstance.create(buildPersonalInstanceInput(...))` instead of delegating to `usePersonalAgentInstance`. Two codepaths for the same operation.

**2c. `useAgentSetup` does too much.** One hook handles: agent fetching, instance listing, env_spec diffing, personal environment orchestration, AND personal instance creation.

**2d. No "use once" path (NEW).** Currently, all missing env vars are always saved to the personal environment. There is no way for the user to say "just use this for this run." The unified model requires `useAgentSetup` to support both paths.

**Proposed approach** (four-part):

**Part 1 — State machine.** Replace ref-based pending state with `useReducer`:
```
idle → resolving → needsEnvVars → submitting → ready
                 → ready (no env vars needed)
```
Each state carries typed payload. The `ready` state has two shapes:
```typescript
type ReadyResult =
  | { mode: "saved"; instanceId: string }
  | { mode: "oneTime"; agentRef: ResourceRef; runtimeEnv: Record<string, EnvVarInput> };
```

**Part 2 — Compose, don't duplicate.** `useAgentSetup` delegates personal instance creation to `usePersonalAgentInstance`.

**Part 3 — Extract env_spec diffing.** Pure function: `diffEnvSpec(agentEnvSpec, personalEnvData) → MissingVariable[]`. Independently testable.

**Part 4 — Unified submit.** `submitEnvVars` accepts a `saveForFuture: boolean` flag:
- `true` → save to personal environment + get-or-create instance → return `{ mode: "saved", instanceId }`
- `false` → collect values as runtimeEnv map → return `{ mode: "oneTime", agentRef, runtimeEnv }`

The caller (`SessionComposer`) then uses the result to decide how to create the session:
- Saved path → `createSession({ agentInstanceId })` then `createExecution({ ... })`
- One-time path → `createSession({ agentRef })` then `createExecution({ ..., runtimeEnv })`

**AgentEnvForm changes**: Add a "Save for future runs" toggle (global, not per-variable). Default: ON. When OFF, a subtle indicator communicates: "These values will only be used for this run."

**Subtasks**:
1. Read and map current `useAgentSetup` state flow
2. Identify duplication between `useAgentSetup` and `usePersonalAgentInstance`
3. Design state machine types (discriminated union)
4. Extract `diffEnvSpec` as a pure function with unit tests
5. Refactor `useAgentSetup` to compose `usePersonalAgentInstance`
6. Implement `useReducer` state machine
7. Add `saveForFuture` flag to `submitEnvVars` with dual-path routing
8. Update `AgentEnvForm` with "Save for future runs" toggle
9. Update `SessionComposer` to consume the new `ReadyResult` shape and route session/execution creation accordingly
10. Verify `usePersonalEnvironment` ref usage
11. Test: rapid agent switching, save ON/OFF paths, popover close/reopen

**Decisions**: Resolved.
- `useReducer` (not XState) — state graph is simple enough
- Hook composition (not shared utility) — lifecycle aligns
- Global toggle (not per-variable) — simpler UX, covers 90% case. Per-variable can be added later.

---

### T03: Fix Naming Inconsistency — `env_refs` vs `environment_refs`
**Risk**: Medium-High | **Blast radius**: Proto definitions, generated types, Java backend, frontend SDK | **Effort**: Medium

**Problem**: `AgentInstance` uses `environment_refs`. `WorkflowInstance` uses `env_refs`. Same concept, different names.

**Action**: Standardize on `environment_refs` everywhere.

**Subtasks**:
1. Identify all proto files with `env_refs`
2. Identify Java backend code referencing `env_refs`
3. Identify frontend code referencing `env_refs`
4. Assess data migration (persisted WorkflowInstance data)
5. Rename proto → regenerate → update backend → update frontend
6. Backward-compatible read if migration needed

**Confirmed**: No persisted WorkflowInstance data exists. Clean rename — no migration needed.

---

### T04: Clean Up Dual-Path Session Creation API
**Risk**: Low-Medium | **Blast radius**: `useCreateSession`, `SessionLauncher`, callers | **Effort**: Small

**Problem**: `useCreateSession` accepts both `agentInstanceId` and `agentRef` with implicit priority.

**Action**: Mutual-exclusion TypeScript pattern:
```typescript
type CreateSessionInput = (
  | { agentInstanceId: string; agentRef?: never }
  | { agentRef: ResourceRef; agentInstanceId?: never }
) & { org: string; /* shared fields */ };
```

**Subtasks**:
1. Read `useCreateSession` input type and priority logic
2. Identify all callers
3. Refactor to mutual-exclusion type
4. Update all callers
5. Defensive error if both provided

**Decisions**: Resolved. Mutual-exclusion pattern (not `via` discriminator).

---

### T05: Follow-Up Message One-Time Secrets Input
**Risk**: Medium | **Blast radius**: New component in `@stigmer/react`, follow-up message UI | **Effort**: Medium

**Problem**: Once a session is running, there's no way to attach one-time secrets to a follow-up execution. The initial setup flow (T02) handles the first execution's secrets, but subsequent messages may need ad-hoc overrides.

**Context change from original plan**: The original T05 proposed a standalone `RuntimeEnvInput` for all runtimeEnv needs. With the unified model, the **initial setup** runtimeEnv path is handled by the AgentEnvForm toggle (T02). This task now covers only the **in-session follow-up** case.

**Proposed approach**: A collapsed-by-default "One-time secrets" attachment in the follow-up message area.

**Component**: `OneTimeSecretsInput` (in `@stigmer/react`)
- Collapsed by default — most follow-ups don't need secrets
- Expands to a key-value editor with `isSecret` toggle
- Clear labeling: "These values exist for this execution only"
- Returns `Record<string, EnvVarInput>` to be passed as `runtimeEnv` on `sendFollowUp`
- Fully theme-able via `--stgm-*` tokens
- Zero Console dependencies

**Hook**: `useOneTimeSecrets` (in `@stigmer/react`)
- Manages key-value state, validation, add/remove entries
- Returns `{ entries, addEntry, removeEntry, updateEntry, toRuntimeEnv, clear, isEmpty }`
- Headless — platform builders can use the hook with their own UI

**Placement**: Co-located with the follow-up message input. runtimeEnv is per-execution, so it lives with the message, not the session-level controls.

**Subtasks**:
1. Design `useOneTimeSecrets` hook API
2. Build hook with unit tests
3. Design `OneTimeSecretsInput` component API
4. Build styled component with `--stgm-*` tokens
5. Integrate into `FollowUpInput` / session message area in Console
6. Wire `toRuntimeEnv()` into `sendFollowUp` call
7. Verify independent embeddability

**Decisions**: Resolved.
- Placement: with the message input (per-execution, not per-session)
- Collapsed by default (progressive disclosure — most follow-ups don't need this)
- Hook + styled component (headless-first pattern)

---

### T06: Improve Error Messages Across Secret Flows
**Risk**: Low | **Blast radius**: Backend error responses, SDK error translation, UI error rendering | **Effort**: Medium

**Problem**: When secrets fail, error messages aren't actionable. `FAILED_PRECONDITION` lists missing variables but doesn't guide resolution.

**Action**: Audit and improve at three layers:
1. **Backend**: Include which agent declared the variable, which environments were searched, and whether runtimeEnv could help
2. **SDK**: Translate gRPC status codes to developer-friendly messages with action guidance
3. **UI**: Show missing variables with path to resolution (link to settings or inline form)

**Subtasks**:
1. Trace the full error path for a missing secret
2. Catalog current error messages
3. Design improved messages: "What happened → Why → What to do"
4. Implement backend improvements
5. Implement SDK translation improvements
6. Implement UI error rendering (potentially a `SecretFlowError` component)

**Decisions**: None upfront. Will pause and collaborate if architectural changes are needed.

---

## Settings Page

No structural changes. The personal environment section gets clearer labeling:
- Current: "Personal Environment"
- Revised: "Personal Environment" with subtitle "Auto-created for your account" or similar

This communicates it's system-managed for convenience without introducing a separate concept.

---

## Execution Order

| Order | Task | Why this order |
|---|---|---|
| 1 | T01 — Fix CLI docs | Quick win, no dependencies. |
| 2 | T04 — Session API cleanup | Small, clean. The mutual-exclusion type is needed by T02's dual-path routing. |
| 3 | T03 — Naming consistency | Independent cross-layer rename. Batch with SDK-touching changes. |
| 4 | T02 — useAgentSetup + unified model | Largest task. Depends on T04 (clean session API for the two creation paths). Includes AgentEnvForm toggle. |
| 5 | T05 — Follow-up one-time secrets | Smaller scope now. Benefits from T02 (clean state) and T04 (clean session API). |
| 6 | T06 — Error messages | Polish pass. Can run in parallel with T05. |

---

## Open Questions

All resolved.

- **T03 (persisted data)**: Confirmed — no persisted WorkflowInstance data. Clean rename.
- **T02 (toggle default)**: Confirmed — default ON. Platform builders can override via props.

---

## Approval

**Status**: APPROVED (2026-03-20)
Execution begins with T01.
