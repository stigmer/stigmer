# AgentEnvForm Component and SessionComposer Personal Environment Integration

**Date**: March 19, 2026

## Summary

Added inline environment variable collection to the agent selection flow. When a user picks an agent that declares env_spec variables, the SessionComposer popover transitions from the AgentPicker to a new AgentEnvForm, collects the required values, provisions a personal environment and agent instance server-side, and resolves to an agentInstanceId that flows through to session creation. This completes Phase 2 tasks T02.3 and T02.4 of the agent-picker-personal-env project.

## Problem Statement

After Phase 1 delivered agent selection via AgentPicker, users could pick an agent but had no way to provide the environment variables that agent needs (API keys, tokens, secrets). The agent's `env_spec` declares what it requires, but nothing in the UI collected those values or provisioned the server-side resources (personal environment, personal agent instance) needed to store them.

### Pain Points

- Agents requiring env vars would fail silently at execution time — no upfront validation
- No UI surface for collecting env vars inline during agent selection
- Personal environment and agent instance provisioning required manual API calls
- The gap between "pick an agent" and "agent is ready to run" had no orchestration

## Solution

Three new artifacts that layer cleanly into the existing SDK architecture:

1. **AgentEnvForm** (Layer 1 — building block): A pure presentational React component that renders labeled inputs for each env var, with password toggles for secrets, client-side validation, and submit/cancel actions. No API calls, no domain knowledge beyond what's passed via props.

2. **useAgentSetup** (Layer 2 — orchestration): A behavior hook that provides two imperative functions — `resolveAgent(ref)` determines whether an agent is ready or needs env vars by fetching the full agent, checking for an existing personal instance, and diffing env_spec against stored variables. `submitEnvVars(values)` provisions the personal environment and agent instance, stores the variables, and returns a ready result with the instanceId.

3. **SessionComposer integration**: The agent ContextPopover is now controlled, enabling programmatic transitions between the AgentPicker view and the AgentEnvForm view. A new `onAgentInstanceIdChange` callback communicates the resolved instanceId to SessionLauncher, which passes it to `createSession()`.

## Implementation Details

### New Files

- `sdk/react/src/agent/AgentEnvForm.tsx` (~270 lines) — Presentational form component
  - Props: `agentName`, `variables: AgentEnvFormVariable[]`, `onSubmit`, `onCancel`, `isSubmitting`, `disabled`, `className`
  - Output: `Record<string, EnvVarInput>` with `isSecret` preserved per value
  - Password fields with eye-toggle visibility control
  - Submit disabled until all fields non-empty
  - Width `w-72` matches AgentPicker for seamless popover transition

- `sdk/react/src/agent/useAgentSetup.ts` (~240 lines) — Layer 2 behavior hook
  - `resolveAgent(ref)` → fetches agent, checks env_spec, looks up existing personal instance, diffs stored vs required vars → returns `"ready"` or `"needsEnvVars"`
  - `submitEnvVars(values)` → getOrCreate personal env, addVariables, create personal instance → returns `"ready"` with instanceId
  - Composes `usePersonalEnvironment(org)` for env operations
  - Uses `useStigmer()` directly for agent and instance queries
  - Discriminated union return type: `AgentSetupResult`

### Modified Files

- `sdk/react/src/composer/SessionComposer.tsx` (+191 lines)
  - Agent popover made controlled (`open`/`onOpenChange`)
  - View state machine: `"picker"` ↔ `"envForm"`
  - Loading overlay during `resolveAgent` in-flight
  - Inline error display for resolve and submit failures
  - New prop: `onAgentInstanceIdChange`

- `client-apps/web/src/components/session/SessionLauncher.tsx` (+4 lines)
  - `agentInstanceId` state wired to SessionComposer and createSession

- `sdk/react/src/agent/index.ts`, `sdk/react/src/index.ts` — barrel exports

## Benefits

- **Zero-friction agent setup**: Users provide env vars inline during agent selection — no separate settings page, no manual provisioning
- **Platform builder reuse**: `AgentEnvForm` is a standalone Layer 1 component — platform builders can embed it in their own flows without the SessionComposer
- **Orchestration encapsulated**: `useAgentSetup` handles the full resolve-or-collect flow — platform builders get `resolveAgent` + `submitEnvVars` without understanding personal environments, instances, or env diffs
- **Secure by default**: Secret values stored server-side via personal environment, never persisted in browser state
- **Seamless popover UX**: Width-matched transition from picker to form, with back navigation and dismissal

## Impact

- **End users**: Can now select agents that require configuration (API keys, tokens) and provide those values inline during session creation
- **Platform builders**: Gain three new exports (`AgentEnvForm`, `useAgentSetup`, `AgentSetupResult`) for building custom agent onboarding flows
- **SDK surface**: Six new public exports added to `@stigmer/react`
- **No breaking changes**: `SessionComposer` gains optional props; existing usage unchanged

## Related Work

- Phase 1 (T01.1–T01.11): AgentPicker, Layer 1 hooks, SessionComposer agent toolbar — foundation this builds on
- T02.1–T02.2: `usePersonalEnvironment` and `usePersonalAgentInstance` orchestration hooks — composed by `useAgentSetup`
- Sub-project 20260319.03: FGA auth model for personal environments — enables member-level env creation
- Sub-project 20260319.05: SDK labels codegen + updateVariables/removeVariables RPCs — enables `addVariables` in `useAgentSetup`
- Next: Phase 3 (T03.1–T03.3) backend env_spec whitelist filter, Phase 4 GitHub token migration

---

**Status**: ✅ Production Ready (pending T02.5 manual e2e validation)
**Timeline**: Single session (~2 hours)
