# Task T01: Secrets Flow Hardening — Master Plan

**Created**: 2026-03-19
**Status**: PENDING REVIEW
**Type**: Refactoring

⚠️ **This plan requires your review before execution**

## Context

The two-flow design for providing secrets (Environment Flow for persistent credentials, Execution Flow for ephemeral injection) is architecturally sound. The merge priority system, env_spec filtering, and security lifecycle are solid.

What needs hardening:
- The React SDK Layer 2 hooks that orchestrate the Environment Flow use fragile ref-based state management
- Naming is inconsistent across bounded contexts (`environment_refs` vs `env_refs`)
- The session creation API accepts ambiguous dual inputs
- The Console doesn't surface the Execution Flow (runtimeEnv) in its UI
- Error messages across secret flows aren't actionable enough
- The product documentation references CLI commands that don't exist

No external consumers of these APIs yet — we can break APIs freely.

---

## Task Breakdown

### T01: Fix Incorrect CLI Commands in Documentation
**Risk**: Low | **Blast radius**: Documentation only | **Effort**: Small

The `how-to-provide-secrets.md` document references CLI commands that don't exist:

| Documented Command | Reality |
|---|---|
| `stigmer environment apply env.yaml` | No `environment` command in CLI. `apply` doesn't support Environment kind. |
| `stigmer agent instance create --agent my-agent --env prod-credentials` | No `agent instance` subcommands exist. |
| `stigmer run my-agent "..." --instance github-bot-prod` | No `--instance` flag on `run`. |
| `stigmer run my-agent "..." --env KEY=val --secret KEY=val` | **This one is correct.** |

**Action**: Remove or replace the incorrect Environment Flow CLI examples. Options:
- **(a)** Remove the CLI section from the Environment Flow entirely and add a note: "CLI support for environment and agent instance management is not yet available."
- **(b)** Replace with `stigmer apply -f` examples using YAML manifests — but `apply` doesn't support Environment kind today either, so this would also be aspirational.
- **(c)** Show only the Execution Flow CLI (which works) and defer Environment Flow CLI examples until the CLI actually supports them.

**Decision needed**: Which option? I lean toward **(c)** — show what works, defer what doesn't, add a note about planned CLI support.

---

### T02: Simplify and Harden `useAgentSetup` Orchestration
**Risk**: Medium | **Blast radius**: `useAgentSetup`, `SessionComposer`, `usePersonalAgentInstance` | **Effort**: Medium-Large

**Problem — three distinct issues**:

**2a. Fragile ref-based state.** `useAgentSetup` uses `pendingRef.current` to hold agent state between `resolveAgent()` and `submitEnvVars()`. `SessionComposer` uses `pendingEnvRef.current` for env form data. Refs don't trigger re-renders and can hold stale values on rapid agent switching.

**2b. Duplicated instance creation logic.** `useAgentSetup` creates personal instances by directly calling `stigmer.agentInstance.create(buildPersonalInstanceInput(...))` — it does NOT use `usePersonalAgentInstance`. Both implement the same get-or-create pattern independently. This means:
- Bug fixes in `usePersonalAgentInstance` don't apply to `useAgentSetup`'s internal path, and vice versa
- The exported Layer 2 hook (`usePersonalAgentInstance`) and the actual Console flow (`useAgentSetup`) will drift over time
- Two codepaths doing the same thing is a maintenance liability

**2c. `useAgentSetup` does too much.** One hook handles: agent fetching, instance listing, env_spec diffing, personal environment orchestration, AND personal instance creation. This makes it hard to understand, test, and modify.

**Proposed approach** (three-part):

**Part 1 — State machine.** Replace ref-based pending state with a `useReducer`-based state machine:
```
idle → resolving → needsEnvVars → submitting → ready
                 → ready (no env vars needed)
```
Each state carries its own typed payload. Transitions are explicit and testable.

**Part 2 — Compose, don't duplicate.** `useAgentSetup` should delegate personal instance creation to `usePersonalAgentInstance` instead of reimplementing the logic. Single codepath for get-or-create instance.

**Part 3 — Evaluate decomposition.** After Parts 1 and 2, assess whether `useAgentSetup` should be further decomposed. The env_spec diffing logic (comparing agent env_spec against personal environment data to determine missing variables) may warrant extraction into a pure function or a separate hook, making `useAgentSetup` a thinner orchestrator.

**Subtasks**:
1. Read and map the full current state flow in `useAgentSetup`
2. Identify exactly where `useAgentSetup` duplicates `usePersonalAgentInstance` logic
3. Design the state machine type (discriminated union of states)
4. Refactor `useAgentSetup` to compose `usePersonalAgentInstance` instead of bypassing it
5. Implement `useReducer` version of `useAgentSetup`
6. Extract env_spec diffing into a testable pure function
7. Update `SessionComposer` to consume the new state shape
8. Verify `usePersonalEnvironment` ref usage — determine if it needs the same treatment or if it's a different pattern (mutation alignment vs UI state)
9. Test rapid agent switching, popover close/reopen, and concurrent resolve scenarios

**Decisions needed**:
- `useReducer` + discriminated union vs. external state machine library (XState/Zag)? I lean toward `useReducer` — the state graph is simple enough.
- Should `useAgentSetup` compose `usePersonalAgentInstance` via hook composition (calling the hook internally), or should both share a common utility function? Hook composition is cleaner if the lifecycle aligns.

---

### T03: Fix Naming Inconsistency — `env_refs` vs `environment_refs`
**Risk**: Medium-High | **Blast radius**: Proto definitions, generated types, Java backend, frontend SDK | **Effort**: Medium

**Problem**: `AgentInstance` uses `environment_refs`. `WorkflowInstance` uses `env_refs`. Same concept, different names. Violates ubiquitous language.

**Proposed approach**: Standardize on `environment_refs` everywhere.

**Subtasks**:
1. Identify all proto files where `env_refs` appears (WorkflowInstance and related messages)
2. Identify all Java backend code that reads/writes `env_refs`
3. Identify all frontend code that references the `env_refs` field name
4. Assess data migration: are there persisted WorkflowInstance documents with `env_refs`? If so, plan a migration.
5. Rename in proto → regenerate types → update backend → update frontend
6. If data migration is needed, implement a backward-compatible read (accept both field names during transition)

**Decision needed**: Is there persisted WorkflowInstance data in production that uses `env_refs`? This determines whether we need a data migration or can do a clean rename.

---

### T04: Clean Up Dual-Path Session Creation API
**Risk**: Low-Medium | **Blast radius**: `useCreateSession` hook, `SessionLauncher`, callers | **Effort**: Small

**Problem**: `useCreateSession` accepts both `agentInstanceId` and `agentRef` with implicit priority rules. Users must know which takes precedence. Both can be provided simultaneously, which is ambiguous.

**Proposed approach**: Make the input a discriminated union:

```typescript
type CreateSessionInput =
  | { via: "instance"; agentInstanceId: string; org: string; /* shared fields */ }
  | { via: "agent"; agentRef: ResourceRef; org: string; /* shared fields */ };
```

Or, if we want to keep it simpler (since there's no external consumers):

```typescript
// Just make them mutually exclusive at the type level
type CreateSessionInput = (
  | { agentInstanceId: string; agentRef?: never }
  | { agentRef: ResourceRef; agentInstanceId?: never }
) & { org: string; /* shared fields */ };
```

**Subtasks**:
1. Read `useCreateSession` to understand the current input type and priority logic
2. Identify all callers (SessionLauncher, SessionComposer, any Console pages)
3. Refactor the input type to a discriminated union
4. Update all callers
5. Add a clear error message if somehow both are provided (defensive, shouldn't be possible with types)

**Decision needed**: Discriminated union with `via` field, or TypeScript mutual-exclusion pattern (`agentRef?: never`)? I lean toward the mutual-exclusion pattern — it's more idiomatic in React hook APIs and doesn't add a synthetic discriminator field.

---

### T05: Surface Execution Flow (runtimeEnv) in Console UI
**Risk**: Medium | **Blast radius**: New component in `@stigmer/react`, Console execution UI | **Effort**: Medium-Large

**Problem**: The Execution Flow (`runtimeEnv`) has no Console representation. Direct users can only use the Environment Flow through the UI. The Console doesn't demonstrate the full platform capability.

**Proposed approach**: Add an optional, collapsed-by-default "One-time secrets" section to the execution/follow-up message UI. This component would:
- Allow adding key-value pairs with `isSecret` toggle
- Clearly communicate ephemeral nature: "These values exist for this execution only"
- Live in `@stigmer/react` (platform builders may want this for B2B scenarios where end-users pass per-call credentials)
- Use `--stgm-*` tokens, be fully theme-able

**Subtasks**:
1. Design the component API (`RuntimeEnvInput` or similar — naming TBD)
2. Determine where it integrates in the current execution creation flow
3. Build the hook (`useRuntimeEnvInput` — manages key-value state, validation, isSecret toggle)
4. Build the styled component
5. Integrate into SessionComposer or execution UI in the Console
6. Ensure the component is independently embeddable (no Console dependencies)

**Decision needed**: Where exactly should this surface in the Console? Options:
- **(a)** Inside `SessionComposer` as a collapsed section alongside the agent picker and env form
- **(b)** In the message input area (since `runtimeEnv` is per-execution, it logically lives with the message)
- **(c)** As a separate toolbar/panel that attaches to the conversation view

I lean toward **(b)** — `runtimeEnv` is per-message/per-execution, so it should be co-located with the message input, not the session-level agent picker.

---

### T06: Improve Error Messages Across Secret Flows
**Risk**: Low | **Blast radius**: Backend error responses, SDK error translation, UI error rendering | **Effort**: Medium

**Problem**: When secrets fail (missing env vars, encryption failures, MCP validation), error messages need to be actionable. Current `FAILED_PRECONDITION` responses list missing variable names but don't guide the user to resolution.

**Proposed approach**: Audit and improve error messages at three layers:
1. **Backend**: Error responses should include which agent declared the variable (in `env_spec`), which environments were searched, and whether `runtimeEnv` could be used as an alternative
2. **SDK**: Error translation should convert gRPC status codes into developer-friendly messages with action guidance
3. **UI**: Error rendering should show the missing variables with a direct path to add them (link to environment settings or inline env form)

**Subtasks**:
1. Trace the error path: What does a user see when `GITHUB_TOKEN` is missing? (Backend → SDK → UI, all three surfaces)
2. Identify the specific error messages today
3. Design improved messages with the pattern: "What happened → Why → What to do"
4. Implement backend improvements (richer error details)
5. Implement SDK error translation improvements
6. Implement UI error rendering improvements (potentially a `SecretFlowError` component in `@stigmer/react`)

**Decision needed**: None upfront — this is primarily an audit-and-improve task. But I'll pause and collaborate if I find error paths that need architectural changes to improve.

---

## Execution Order

| Order | Task | Why this order |
|---|---|---|
| 1 | T01 — Fix CLI docs | Quickest win. Stops incorrect information from spreading. |
| 2 | T02 — Fix fragile refs | Highest bug risk in shipping code. Foundation for T05. |
| 3 | T04 — Discriminated union for session creation | Small, clean improvement. Unblocks cleaner T05 integration. |
| 4 | T03 — Naming consistency | Important but requires cross-layer coordination. Do after T02/T04 so we batch the SDK-touching changes. |
| 5 | T05 — Execution Flow UI | Largest new surface area. Benefits from T02 (cleaner state) and T04 (cleaner session API). |
| 6 | T06 — Error messages | Incremental. Can be done in parallel with later tasks or as a final polish pass. |

---

## Open Questions for Review

1. **T01 (CLI docs)**: Remove incorrect CLI examples, show only what works, add note about planned support — agree?
2. **T02 (Refs → State machine)**: `useReducer` + discriminated union vs. external state machine library — agree with `useReducer`?
3. **T03 (Naming)**: Is there persisted WorkflowInstance data with `env_refs` in production?
4. **T04 (Session API)**: Mutual-exclusion TypeScript pattern vs. `via` discriminator — agree with mutual-exclusion?
5. **T05 (Execution Flow UI)**: Should `runtimeEnv` input live with the message input (per-execution) or with the agent picker (per-session)?
6. **Execution order**: Does this sequencing make sense, or would you reorder?

---

## Review Process

**What happens next**:
1. **You review this plan** — challenge any task, question any decision, reorder as you see fit
2. **Provide feedback** — I'll capture it in `T01_1_review.md`
3. **I'll revise the plan** — create `T01_2_revised_plan.md` incorporating your feedback
4. **You approve** — explicit go-ahead to begin execution
5. **Execution begins** — starting with T01 (CLI doc fix)
