# T01: Secrets Flow Hardening — Review Feedback

**Reviewed**: 2026-03-20
**Reviewer**: Collaborative (architect + product owner)
**Verdict**: Plan needs revision — UX model change affects T02 and T05

---

## Key Insight: Three Flows in Code, Two Concepts for Users

The original plan treats three codepaths (personal environment, shared environments, runtimeEnv) as three user-facing flows. Review identified that the user-facing model should be **two concepts**:

| User Concept | What it means | System implementation |
|---|---|---|
| **Saved secrets** | "I stored my credentials for reuse" | Environment resources (personal or shared), bound via AgentInstance |
| **One-time secrets** | "Just use this for this run" | `runtimeEnv` on AgentExecution |

The "personal environment" vs "shared environment" distinction is about **ownership/scope**, not a separate flow. Both are Environments. The personal one is auto-created for convenience.

Exporting three flows to the UI violates Nielsen's Heuristic #2 (match between system and real world) and creates unnecessary cognitive load (Hick's Law).

---

## Decision: Unified "Save or Use Once" Model

When a user picks an agent with missing env vars, the inline flow becomes:

1. Agent needs `GITHUB_TOKEN` → system checks saved secrets (personal + shared envs)
2. Missing → AgentEnvForm prompts for the value
3. **New**: Global toggle "Save for future runs" (default ON)
   - **ON** → saved to personal environment + instance created (existing behavior)
   - **OFF** → passed as `runtimeEnv` on execution (new path, no instance needed)
4. Done — one interaction, one fork point, user never learns about three separate flows

This collapses the personal-environment flow and the runtimeEnv flow into **one UI interaction** with a toggle.

---

## Per-Task Feedback

### T01 (CLI Docs) — No changes
Option (c) approved: show what works, defer what doesn't.

### T02 (useAgentSetup Hardening) — Revised scope
- `useReducer` state machine: **approved**
- Compose `usePersonalAgentInstance`: **approved**
- **New requirement**: `useAgentSetup` must now support the "use once" path. The `submitEnvVars` step needs to accept a `saveForFuture: boolean` flag and route accordingly:
  - `true` → existing personal env + instance flow
  - `false` → collect values as runtimeEnv, return them to the caller for injection at execution time
- The state machine gains a new output shape: `ready` state carries either `{ instanceId }` (saved path) or `{ runtimeEnv }` (one-time path)

### T03 (Naming Consistency) — No changes
Standardize on `environment_refs`. Need to confirm persisted data situation.

### T04 (Session API Cleanup) — No changes
Mutual-exclusion TypeScript pattern approved.

### T05 (runtimeEnv UI) — Significantly revised
- **No standalone `RuntimeEnvInput` component** for the initial setup flow
- Instead: "Save for future runs" toggle integrated into `AgentEnvForm` (part of revised T02)
- **Retained**: Collapsed "One-time secrets" section in the follow-up message input for power users who want to attach ad-hoc overrides to a specific execution in an already-running session
- This is a smaller, more focused component than the original T05 proposed

### T06 (Error Messages) — No changes
Audit-and-improve approach approved.

---

## Revised Execution Order

| Order | Task | Rationale |
|---|---|---|
| 1 | T01 — Fix CLI docs | Quick win, no dependencies |
| 2 | T04 — Session API cleanup | Small, clean, independent of UX model |
| 3 | T03 — Naming consistency | Independent, cross-layer coordination |
| 4 | T02 — useAgentSetup hardening (with unified model) | State machine + save-or-use-once toggle. Now includes AgentEnvForm toggle. |
| 5 | T05 — Follow-up message runtimeEnv input | Smaller scope: just the ad-hoc override for in-session follow-ups |
| 6 | T06 — Error messages | Polish pass |

---

## Settings Page

No structural changes. Personal Environment section stays as-is with clearer labeling: "Auto-created personal environment" to communicate it's system-managed for convenience, not a separate concept the user needs to understand.
