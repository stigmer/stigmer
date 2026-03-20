# One-Time Secrets for Follow-Up Messages

**Date**: March 20, 2026

## Summary

Added a headless hook (`useOneTimeSecrets`) and styled component (`OneTimeSecretsInput`) to `@stigmer/react` that let users attach ephemeral, execution-scoped environment variables to follow-up messages. Integrated into the `SessionComposer` toolbar as the fifth context popover, wired through the Console's `SessionPage`, and verified end-to-end with zero new type or lint errors.

## Problem Statement

After the initial session setup (T02), there was no way to attach one-time secrets to follow-up executions. The SDK's `sendFollowUp` accepted `runtimeEnv` and the backend processed it, but no UI existed for collecting these values from the user during a conversation.

### Pain Points

- Users with rotating credentials or per-execution overrides had no in-session path to provide them
- The initial setup flow (`AgentEnvForm`) handles only the first execution's secrets, guided by the agent's `env_spec`
- Follow-up executions inherited the session's environment but could not be augmented with ad-hoc values

## Solution

Built a headless-first hook + styled component pair in `@stigmer/react`, integrated into the existing `SessionComposer` toolbar using the same controlled-prop pattern as workspace, MCP servers, and skills.

## Implementation Details

### New Hook: `useOneTimeSecrets`

- Manages an array of `OneTimeSecretEntry` objects (id, key, value, isSecret)
- Operations: `addEntry`, `removeEntry`, `updateEntry`, `clear`
- `toRuntimeEnv()` converts valid entries to `Record<string, EnvVarInput>`, filtering empties and deduplicating by key (last wins)
- `isSecret: true` default for safer credential handling
- Follows `useWorkspaceEntries` pattern: `uid()`, `readonly` arrays, `clear()`, conversion method

### New Component: `OneTimeSecretsInput`

- Freeform key-value editor rendered in a popover
- Each entry: monospace key input, password/text value input, secret/plain toggle, remove button
- Duplicate key detection with inline warning
- Empty state with guidance, "Add variable" button
- All styling via `--stgm-*` tokens, matching `AgentEnvForm` patterns

### SessionComposer Integration

- New `secrets?: UseOneTimeSecretsReturn` prop
- Lock icon toolbar trigger with count badge
- "1-time" chips in Zone 2 showing key names only (never values)
- `ChipItem.type` extended with `"secret"`

### Console Wiring

- `SessionPage` instantiates `useOneTimeSecrets()`, passes to composer
- `handleSubmit` reads `secrets.toRuntimeEnv()`, passes as `runtimeEnv` to `sendFollowUp`, then calls `secrets.clear()`

## Benefits

- **Platform builders** get both headless (`useOneTimeSecrets`) and styled (`OneTimeSecretsInput`) APIs — use either independently
- **Ephemeral by design** — values auto-clear after submission, preventing stale secret leaks across follow-ups
- **Zero breaking changes** — `SessionComposer.onSubmit` signature unchanged, new prop is optional
- **Proven pattern** — fifth context type using the controlled-prop pattern, validating its extensibility

## Impact

- `@stigmer/react`: 2 new files (445 lines), 4 modified files (97 lines changed)
- `client-apps/web`: 1 modified file (12 lines changed)
- New public exports: `useOneTimeSecrets`, `UseOneTimeSecretsReturn`, `OneTimeSecretEntry`, `OneTimeSecretsInput`, `OneTimeSecretsInputProps`
- Build: zero new TS errors, zero lint errors

## Related Work

- **T02** (useAgentSetup hardening) — established the `AgentResolution` model and `oneTime` mode that this builds on
- **T04** (Session API cleanup) — provided the mutual-exclusion `CreateSessionInput` type used by the dual-path routing
- **Revised plan** (`T01_2_revised_plan.md`) — T05 scope narrowed from original plan after T02 handled initial setup runtimeEnv

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 min)
