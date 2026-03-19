# Task T01: Agent Picker + Personal Environment Flow

**Created**: 2026-03-19
**Status**: Planning (pending review)

## Overview

This project adds agent selection to the SessionComposer and builds the "personal environment" flow that lets users seamlessly use agents requiring credentials — without ever seeing the words "AgentInstance" or "Environment."

The SDK hooks are designed in two layers to serve both consumer profiles of the platform.

---

## Two Consumer Profiles

Every hook and component in this project serves one or both of these profiles. The distinction is a first-class design concern, not an afterthought.

### Profile A: Platform Builders

Platform builders embed Stigmer into their own product. They:
- Pre-provision agents, environments, and agent instances via API or their own backend
- Control which agents their end users see
- Provide credentials server-side (their end users never enter env vars)
- May or may not use `SessionComposer` — they might build their own UI
- Need **low-level building-block hooks** that do one thing each, with no magic

**What they use**: `useAgentSearch`, `AgentPicker`, `useCreateEnvironment`, `useCreateAgentInstance`, `useCreateSession` with explicit `agentInstanceId`.

### Profile B: Direct Stigmer Users

Users of the Stigmer Console (or any app that wants the full agent-selection experience). They:
- Pick an agent from a searchable list
- Get prompted for credentials on first use (inline, contextual)
- Never see "AgentInstance" or "Environment" as concepts
- Expect it to "just work" on subsequent uses
- Need **high-level orchestration hooks** that handle the multi-step provisioning flow

**What they use**: `usePersonalEnvironment`, `usePersonalAgentInstance`, `AgentEnvForm`, `SessionComposer` with agent props.

### Hook Layering

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Orchestration Hooks (Profile B — Direct Users)     │
│                                                              │
│  usePersonalEnvironment(org)                                 │
│    → get/create personal env, add variables                  │
│                                                              │
│  usePersonalAgentInstance(org, agentRef)                      │
│    → get/create personal instance, link to personal env      │
│                                                              │
│  AgentEnvForm                                                │
│    → inline form rendered from agent env_spec                │
│                                                              │
│  SessionComposer (with agent props)                          │
│    → full agent picker + env form + session creation          │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Building-Block Hooks (Profile A — Platform Builders)│
│                                                              │
│  useAgentSearch(org)                                         │
│    → search agents, returns SearchResult[]                   │
│                                                              │
│  AgentPicker                                                 │
│    → single-select searchable list in popover                │
│                                                              │
│  useCreateEnvironment()                                      │
│    → create any environment (not just personal)              │
│                                                              │
│  useUpdateEnvironment()                                      │
│    → update any environment                                  │
│                                                              │
│  useCreateAgentInstance()                                     │
│    → create any agent instance                               │
│                                                              │
│  useCreateSession()                                          │
│    → accepts agentInstanceId directly OR agentRef            │
│                                                              │
│  useEnvironment(ref)                                         │
│    → fetch a single environment by reference                 │
│                                                              │
│  useAgentInstance(ref)                                        │
│    → fetch a single agent instance by reference              │
└─────────────────────────────────────────────────────────────┘
```

Platform builders use Layer 1 directly. The Console composes Layer 2 on top of Layer 1. Both layers are exported from `@stigmer/react`.

---

## Architecture

### Data model (existing, no changes)

```
Agent (blueprint)          -- public/org-visible, searchable
  └─ env_spec              -- declares required variables (schema)
AgentInstance (deployment)  -- RESTRICTED, owner-only by default
  └─ environment_refs      -- references to Environment resources
Environment (secrets)      -- RESTRICTED, owner-only by default
  └─ data                  -- map<string, EnvironmentValue>
Session
  └─ agent_instance_id     -- resolved at creation time
```

### Personal resource identification

Both personal Environment and personal AgentInstance use:

- **Label**: `stigmer.ai/personal: "true"`
- **Additional label on AgentInstance**: `stigmer.ai/for-agent: "{org}/{slug}"`
- **Deterministic naming**: Environment slug = `personal`, AgentInstance slug = `{agent-slug}-personal`
- **FGA**: RESTRICTED model — only owner (creator) + org admins can see

Lookup is O(1) via `getByReference(org, slug, kind)`. Labels serve as semantic markers for queries and UI filtering.

### Frontend orchestration (Design Decision 004)

The multi-step provisioning flow lives in the **application layer** (SDK hooks / CLI commands), not in backend command handlers. Backend APIs remain single-responsibility:

```
┌─────────────────────────────────────────────────────┐
│  Application Layer (React hooks / CLI)               │
│                                                      │
│  1. environment.getByReference("personal")           │
│     └─ 404? → environment.create(slug: "personal")  │
│     └─ exists? → environment.update(add new vars)    │
│                                                      │
│  2. agentInstance.getByReference("{agent}-personal")  │
│     └─ 404? → agentInstance.create(...)              │
│     └─ exists? → use it                             │
│                                                      │
│  3. session.create(agent_instance_id: ...)           │
│                                                      │
│  4. execution.create(session_id: ..., message: ...)  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Backend (unchanged, single-responsibility)          │
│                                                      │
│  environment.create() → creates an Environment       │
│  agentInstance.create() → creates an AgentInstance    │
│  session.create() → creates a Session                │
│  execution.create() → creates an AgentExecution      │
│                                                      │
│  Each does ONE thing. No hidden side effects.        │
└─────────────────────────────────────────────────────┘
```

### Agent selection resolution flow (Profile B — Direct Users)

```
User picks Agent X in the picker
       │
       ▼
getByReference(org, "{agent-slug}-personal", agent_instance)
       │
   ┌───┴───┐
  EXISTS  NOT_FOUND
   │       │
   │       ▼
   │   Does Agent X have env_spec?
   │       │
   │   ┌───┴───┐
   │   NO     YES
   │   │       │
   │   │       ▼
   │   │   Show inline form (Phase 2)
   │   │   Collect values from user
   │   │   ┌──────────────────────┐
   │   │   │ Get/create personal  │
   │   │   │ Environment (slug:   │
   │   │   │ "personal")          │
   │   │   │ Add new vars to it   │
   │   │   └──────────────────────┘
   │   │       │
   │   ▼       ▼
   │   Create AgentInstance
   │   - slug: "{agent-slug}-personal"
   │   - label: stigmer.ai/personal: "true"
   │   - label: stigmer.ai/for-agent: "{org}/{slug}"
   │   - environment_refs: [personal-env-ref]
   │       │
   ▼       ▼
Use agentInstanceId for session creation
```

### Agent selection flow (Profile A — Platform Builders)

```
Platform builder provides agentInstanceId directly
       │
       ▼
session.create(agent_instance_id: "pre-provisioned-id")
       │
       ▼
Done. No env form. No personal resources.
```

Or, if using the AgentPicker component standalone:

```
Platform builder uses AgentPicker to let their user choose an agent
       │
       ▼
onChange(agentRef) → platform builder resolves to their
                     own pre-provisioned instance
       │
       ▼
session.create(agent_instance_id: ...)
```

### Security: env_spec whitelist filtering

The backend env merge (`envmerge.MergeEnvironmentLayers`) currently passes ALL env vars from all environments to the execution. This violates least privilege when a personal environment accumulates many secrets but an agent only needs a subset.

**Fix**: After merging layers, filter the result to only include keys declared in the agent's `env_spec`. The agent's env_spec becomes a whitelist.

```
merged = merge(agent.env_spec, environments, runtime_env)
final  = filter(merged, allowed_keys=agent.env_spec.keys())
```

---

## Task Breakdown

### Phase 1: Building-Block Hooks + AgentPicker (Layer 1)

**Goal**: Ship the foundational hooks that both platform builders and direct users need. User can pick an agent in the composer. Session creation resolves to the agent's default instance. No env var collection yet.

#### T01.1 — `useAgentSearch` data hook
- **File**: `sdk/react/src/agent/useAgentSearch.ts` (new)
- **Profile**: Both A and B
- Wraps `stigmer.agent.list()` via `useResourceSearch`
- Follows exact pattern of `useSkillSearch` and `useMcpServerSearch`
- Export types: `UseAgentSearchOptions`, `UseAgentSearchReturn`

#### T01.2 — `AgentPicker` component
- **File**: `sdk/react/src/agent/AgentPicker.tsx` (new)
- **Profile**: Both A and B
- **Single-select** variant of the picker pattern (unlike multi-select SkillPicker/McpServerPicker)
- Props: `value: ResourceRef | null`, `onChange: (ref: ResourceRef | null) => void`
- Shows currently selected agent (if any) with deselect button
- Searchable list in popover (same UI pattern as other pickers)
- Clicking a result replaces current selection
- **Important**: This component is purely a selection UI. It has no knowledge of personal instances or env forms. Platform builders can use it standalone.

#### T01.3 — `useEnvironment` data hook
- **File**: `sdk/react/src/environment/useEnvironment.ts` (new)
- **Profile**: A (building block)
- Fetches a single Environment by reference: `stigmer.environment.getByReference(ref)`
- Returns: `{ environment, isLoading, error, refetch }`

#### T01.4 — `useCreateEnvironment` behavior hook
- **File**: `sdk/react/src/environment/useCreateEnvironment.ts` (new)
- **Profile**: A (building block)
- Wraps `stigmer.environment.create()` with loading/error state
- Returns: `{ create, isCreating, error, clearError }`

#### T01.5 — `useUpdateEnvironment` behavior hook
- **File**: `sdk/react/src/environment/useUpdateEnvironment.ts` (new)
- **Profile**: A (building block)
- Wraps `stigmer.environment.update()` with loading/error state
- Returns: `{ update, isUpdating, error, clearError }`

#### T01.6 — `useAgentInstance` data hook
- **File**: `sdk/react/src/agent-instance/useAgentInstance.ts` (new)
- **Profile**: A (building block)
- Fetches a single AgentInstance by reference: `stigmer.agentInstance.getByReference(ref)`
- Returns: `{ instance, isLoading, error, refetch }`

#### T01.7 — `useCreateAgentInstance` behavior hook
- **File**: `sdk/react/src/agent-instance/useCreateAgentInstance.ts` (new)
- **Profile**: A (building block)
- Wraps `stigmer.agentInstance.create()` with loading/error state
- Returns: `{ create, isCreating, error, clearError }`

#### T01.8 — Barrel exports
- **File**: `sdk/react/src/agent/index.ts` (new)
- **File**: `sdk/react/src/environment/index.ts` (new)
- **File**: `sdk/react/src/agent-instance/index.ts` (new)
- **File**: `sdk/react/src/index.ts` (modify) — add agent, environment, agent-instance module exports

#### T01.9 — SessionComposer integration
- **File**: `sdk/react/src/composer/SessionComposer.tsx` (modify)
- New props: `agentRef?: ResourceRef | null`, `onAgentRefChange?: (ref: ResourceRef | null) => void`
- Add `AgentPicker` in `ContextPopover` as **first** toolbar item (before Workspace)
- Add `"agent"` to `ChipItem["type"]` union and `CHIP_TYPE_LABELS`
- Agent chip shows when selected (at most one)
- Visibility: `showAgent = onAgentRefChange != null && org != null`

#### T01.10 — `useCreateSession` wiring
- **File**: `sdk/react/src/session/useCreateSession.ts` (modify)
- Add `agentRef?: ResourceRef` to `CreateSessionInput`
- Add `agentInstanceId?: string` to `CreateSessionInput` (for platform builders who have the ID directly)
- Resolution priority: `agentInstanceId` (if provided) > `agentRef` (resolved to default instance) > omitted (backend default)
- If `agentRef` provided: call `stigmer.agent.getByReference(ref)` → extract `status.defaultInstanceId` → pass as `agentInstanceId` to `session.create()`

#### T01.11 — Console integration
- **File**: `client-apps/web/src/components/session/SessionLauncher.tsx` (modify)
- Add `agentRef` state, wire to `SessionComposer` props
- Pass `agentRef` to `createSession` call

### Phase 2: Personal Environment + Inline Env Var Collection (Layer 2)

**Goal**: When a direct user picks an agent needing env vars and has no personal instance, collect values inline and create Environment + AgentInstance automatically. Platform builders never see this flow.

#### T02.1 — `usePersonalEnvironment` orchestration hook
- **File**: `sdk/react/src/environment/usePersonalEnvironment.ts` (new)
- **Profile**: B (direct users only)
- **Composes**: `useEnvironment` + `useCreateEnvironment` + `useUpdateEnvironment` (Layer 1 hooks)
- Encapsulates the "personal" convention: slug = `personal`, label = `stigmer.ai/personal: "true"`
- Returns: `{ environment, isLoading, error, getOrCreate, addVariables }`
- `getOrCreate()`: if personal env doesn't exist, create it with label `stigmer.ai/personal: "true"`
- `addVariables(vars)`: update personal env to include new variables (merges with existing)
- **JSDoc**: Must document that this is for the "direct user" flow. Platform builders who manage environments programmatically should use `useCreateEnvironment` / `useUpdateEnvironment` directly.

#### T02.2 — `usePersonalAgentInstance` orchestration hook
- **File**: `sdk/react/src/agent-instance/usePersonalAgentInstance.ts` (new)
- **Profile**: B (direct users only)
- **Composes**: `useAgentInstance` + `useCreateAgentInstance` (Layer 1 hooks)
- Encapsulates the "personal" convention: slug = `{agent-slug}-personal`, labels
- Returns: `{ instance, isLoading, error, getOrCreate }`
- `getOrCreate(agentRef, envRef)`: create personal instance with labels and environment_refs
- **JSDoc**: Must document that this is for the "direct user" flow. Platform builders who pre-provision instances should use `useCreateAgentInstance` directly.

#### T02.3 — `AgentEnvForm` component
- **File**: `sdk/react/src/agent/AgentEnvForm.tsx` (new)
- **Profile**: B (direct users only, but exported for anyone who wants it)
- Renders a compact form from the agent's `env_spec`
- Each variable: name, description, input field (password type for `is_secret: true`)
- Pre-fills any variables already present in user's personal environment
- Only shows variables that are missing (diff between env_spec and personal env)
- Submit creates/updates the personal environment + creates the agent instance
- Can be used standalone by platform builders who want a similar UI for their own env setup

#### T02.4 — Integrate env form into AgentPicker flow
- **File**: `sdk/react/src/composer/SessionComposer.tsx` (modify)
- When user selects an agent that needs env vars and has no personal instance:
  - Transition from picker list to env form within the same popover
  - On form submit: create resources, resolve instance, close popover
- When personal instance already exists: select immediately (no form)
- The composer does NOT call `onSubmit` until the agent instance is fully resolved

#### T02.5 — Update `useCreateSession` for personal instance resolution
- **File**: `sdk/react/src/session/useCreateSession.ts` (modify)
- The hook remains unchanged from Phase 1. The personal instance ID is resolved by the composer/hooks BEFORE calling `create()`. Session creation always receives an explicit `agentInstanceId`.

### Phase 3: Backend Env Merge Filtering

**Goal**: Agent executions only receive env vars declared in the agent's env_spec. Applies to both consumer profiles.

#### T03.1 — Whitelist filter in envmerge
- **File**: `backend/libs/go/envmerge/merge.go` (modify)
- After `MergeEnvironmentLayers` produces the merged map, filter to only include keys present in the agent's `env_spec.data`
- This is a post-merge filter, not a change to the merge algorithm itself
- Must be backward-compatible: if agent has no env_spec, pass all vars (legacy behavior)

#### T03.2 — Add filtering to execution context creation
- **File**: backend execution controller (Go) — `createExecutionContextStep`
- Apply the filter when building the `ExecutionContext`
- Log a warning (not error) for env vars that were available but filtered out

#### T03.3 — Tests
- Test: agent with env_spec only receives declared vars
- Test: agent without env_spec receives all vars (backward compat)
- Test: agent with env_spec receives runtime overrides only for declared vars

### Phase 4: GitHub Token Migration

**Goal**: Move the GitHub OAuth token from browser localStorage to the personal Environment on the server. This is a Profile B (direct user) concern.

#### T04.1 — Migration strategy
- On connect (OAuth callback): store token in personal Environment under key `GITHUB_TOKEN` (with `is_secret: true`)
- On mount: check personal Environment for `GITHUB_TOKEN` instead of localStorage
- Migration path: if token exists in localStorage but not in personal env, migrate it on next page load
- After migration: remove from localStorage

#### T04.2 — Update `useGitHubConnection`
- **File**: `sdk/react/src/github/useGitHubConnection.ts` (modify)
- Read token from personal Environment (server-side) instead of localStorage
- Write token to personal Environment on OAuth callback
- Add migration logic for existing localStorage tokens
- **Dependency**: Uses `usePersonalEnvironment` from Phase 2

#### T04.3 — Clean up localStorage usage
- Remove `stigmer:github:token` from localStorage after migration
- Keep `stigmer:github:oauth-state` in sessionStorage (CSRF state, ephemeral by design)
- Keep `stigmer:github:recent-repos` in localStorage (non-sensitive, UX convenience)

---

## Execution Order

Phase 1 is independent and can ship immediately.
Phase 3 is a backend-only change, independent of Phases 1-2, but should ship before Phase 2 goes to production (to ensure security before personal environments accumulate secrets).
Phase 2 depends on Phase 1 (uses the AgentPicker and Layer 1 hooks).
Phase 4 depends on Phase 2 (needs the personal environment infrastructure).

Recommended order: **Phase 1 → Phase 3 → Phase 2 → Phase 4**

---

## SDK Export Documentation

Every exported hook must include JSDoc that clearly states:
1. Which consumer profile it serves (or both)
2. Whether it is a building block (Layer 1) or orchestration (Layer 2)
3. A usage example for each profile

Example pattern:

```typescript
/**
 * Fetches a single Environment resource by reference.
 *
 * This is a building-block hook for platform builders who manage
 * environments programmatically. For the "personal environment" flow
 * used by the Stigmer Console, see {@link usePersonalEnvironment}.
 *
 * @example
 * ```tsx
 * // Platform builder: fetch a pre-provisioned environment
 * const { environment } = useEnvironment({
 *   org: "acme",
 *   slug: "prod-env",
 *   kind: ApiResourceKind.environment,
 * });
 * ```
 */
```

```typescript
/**
 * Manages the user's personal Environment for credential storage.
 *
 * This is an orchestration hook for the "direct user" flow (Stigmer
 * Console). It creates and manages a single personal Environment per
 * user per org, identified by slug `personal` and label
 * `stigmer.ai/personal: "true"`.
 *
 * Platform builders who manage environments programmatically should
 * use {@link useCreateEnvironment} and {@link useUpdateEnvironment}
 * directly.
 *
 * @example
 * ```tsx
 * const { getOrCreate, addVariables } = usePersonalEnvironment("acme");
 * ```
 */
```

---

## Open Questions

1. **Label-based queries**: Does the search service currently support filtering by labels? If not, Phase 2 can rely solely on `getByReference` with deterministic naming (labels are still set for future queryability).

2. **Agent env_spec fetching**: The AgentPicker uses `SearchResult` (from search service), which doesn't include the full agent spec. To check if an agent has `env_spec`, we need an additional `agent.getByReference()` call after selection. Is this acceptable latency, or should we extend `SearchResult` to include a `has_env_spec` flag?

3. **Rename timing**: Should AgentInstance → AgentPreset rename happen before this project (affecting the types we build against) or after? The recommendation was "before" but the rename is a separate multi-day project.

---

## Files Summary

### New files (13)
| File | Phase | Profile | Layer | Purpose |
|------|-------|---------|-------|---------|
| `sdk/react/src/agent/useAgentSearch.ts` | 1 | Both | 1 | Data hook for agent search |
| `sdk/react/src/agent/AgentPicker.tsx` | 1 | Both | 1 | Single-select agent picker |
| `sdk/react/src/agent/index.ts` | 1 | — | — | Barrel exports |
| `sdk/react/src/environment/useEnvironment.ts` | 1 | A | 1 | Fetch single environment |
| `sdk/react/src/environment/useCreateEnvironment.ts` | 1 | A | 1 | Create environment |
| `sdk/react/src/environment/useUpdateEnvironment.ts` | 1 | A | 1 | Update environment |
| `sdk/react/src/environment/index.ts` | 1 | — | — | Barrel exports |
| `sdk/react/src/agent-instance/useAgentInstance.ts` | 1 | A | 1 | Fetch single agent instance |
| `sdk/react/src/agent-instance/useCreateAgentInstance.ts` | 1 | A | 1 | Create agent instance |
| `sdk/react/src/agent-instance/index.ts` | 1 | — | — | Barrel exports |
| `sdk/react/src/environment/usePersonalEnvironment.ts` | 2 | B | 2 | Personal env orchestration |
| `sdk/react/src/agent-instance/usePersonalAgentInstance.ts` | 2 | B | 2 | Personal instance orchestration |
| `sdk/react/src/agent/AgentEnvForm.tsx` | 2 | B | 2 | Inline env var collection form |

### Modified files (5)
| File | Phase | Change |
|------|-------|--------|
| `sdk/react/src/index.ts` | 1 | Add agent, environment, agent-instance exports |
| `sdk/react/src/composer/SessionComposer.tsx` | 1, 2 | Agent trigger, chip, env form integration |
| `sdk/react/src/session/useCreateSession.ts` | 1 | agentRef + agentInstanceId on CreateSessionInput |
| `client-apps/web/src/components/session/SessionLauncher.tsx` | 1 | Wire agent state |
| `backend/libs/go/envmerge/merge.go` | 3 | Whitelist filter |
| `sdk/react/src/github/useGitHubConnection.ts` | 4 | Server-side token storage |
