# Unified Session Variables and Cross-Source Environment Pool

**Date**: March 21, 2026

## Summary

Introduced a reactive session environment pool (`useSessionEnvPool`) that aggregates environment variables from all sources — personal environment, manual session variables, agent setup, and MCP server setup — into a single queryable pool. This eliminates duplicate credential prompting when the same variable is required by multiple agents or MCP servers, and renames the "OneTimeSecrets" concept to "SessionVariables" to accurately reflect the feature's expanded scope.

## Problem Statement

When a user configured a session with multiple agents and MCP servers, each component independently prompted for required credentials. A user who entered `GITHUB_TOKEN` in the manual secrets panel would still be asked for it again by an MCP server that also required it. This fragmented experience violated the principle that entering a credential once should satisfy all components that need it.

### Pain Points

- **Duplicate prompting**: The same environment variable was requested by multiple setup flows independently
- **No cross-referencing**: Manual secrets, agent env forms, and MCP server env forms were siloed — each unaware of values provided elsewhere
- **Misleading naming**: The "OneTimeSecrets" name was factually wrong after adding the "save for future" capability, creating confusion for platform builders integrating the SDK
- **Missing persistence path**: Manual secret entries had no way to opt into saving for future sessions, unlike agent/MCP-specific forms

## Solution

A layered approach that adds cross-source awareness without coupling individual setup flows:

1. **`useSessionEnvPool`** — a pure-computation hook that aggregates available env var keys from all sources into a reactive `Set`, enabling any component to check "is this key already provided?"
2. **Enhanced `diffEnvSpec`** — now accepts optional `poolKeys` to skip variables already satisfied by the pool
3. **`POOL_RESOLVE` reducer actions** — let agent and MCP setup reducers react to pool changes, auto-transitioning entries from `needsSetup` to `ready` when their requirements become satisfied
4. **Pre-fill and indicators** — `EnvVarForm` pre-fills from pool values; `SessionVariablesInput` shows which agents/MCP servers need each variable
5. **Complete rename** — `OneTimeSecrets` → `SessionVariables` across all public APIs, types, file names, and consumer code

## Implementation Details

### New: `useSessionEnvPool` hook (`sdk/react/src/environment/useSessionEnvPool.ts`)

Pure reactive aggregation — no side effects, no API calls. Accepts `personalEnvKeys`, `manualSecrets`, `agentRuntimeEnv`, and `mcpRuntimeEnv`. Exposes `availableKeys: Set<string>`, `getAvailableValue(key)`, and `isKeySatisfied(key)`.

### Enhanced: `diffEnvSpec` (`sdk/react/src/environment/diffEnvSpec.ts`)

Added optional third parameter `poolKeys?: Set<string>`. When provided, variables whose keys exist in the pool are excluded from the "missing" list, preventing redundant prompts.

### Enhanced: Agent and MCP setup reducers

Both `agentSetupReducer` and `mcpServerSetupReducer` gained a `POOL_RESOLVE` action. When the pool changes, a `useEffect` in the respective setup hooks re-evaluates missing variables and dispatches `POOL_RESOLVE` to update state — potentially transitioning entries to `ready` without user interaction.

### Enhanced: `EnvVarForm` pre-fill

Added optional `poolValues` prop. When provided, form fields are pre-filled with values from the pool, with a "Pre-filled from session variables" indicator. This reduces manual entry when a variable was already provided in another flow.

### Renamed: OneTimeSecrets → SessionVariables

| Old | New |
|-----|-----|
| `OneTimeSecretEntry` | `SessionVariableEntry` |
| `UseOneTimeSecretsReturn` | `UseSessionVariablesReturn` |
| `useOneTimeSecrets()` | `useSessionVariables()` |
| `OneTimeSecretsInput` | `SessionVariablesInput` |
| `OneTimeSecretsInputProps` | `SessionVariablesInputProps` |
| `SessionComposerProps.secrets` | `SessionComposerProps.sessionVariables` |
| `useOneTimeSecrets.ts` | `useSessionVariables.ts` |
| `OneTimeSecretsInput.tsx` | `SessionVariablesInput.tsx` |

### Per-entry "save for future" toggle

Each session variable entry now has a `saveForFuture` boolean. When toggled on, the value is persisted to the user's personal environment at submission time (via `personalEnv.addVariables`), making it available in future sessions without re-entry.

### "Used by" indicators

`SessionVariablesInput` now accepts a `requiredByMap` prop that maps env var keys to the names of agents/MCP servers requiring them. When a manual variable's key matches, a "Used by: GitHub MCP Server" label appears, confirming the cross-link.

## Benefits

- **Zero duplicate prompts**: A `GITHUB_TOKEN` entered anywhere is recognized everywhere
- **Accurate naming**: "Session Variables" correctly describes entries that can be ephemeral or persisted
- **Transparency**: Users see exactly which resources need each variable they enter
- **Reduced friction**: Pre-filled forms mean less typing when credentials overlap
- **SDK-first**: All changes are in `@stigmer/react` with clean, optional prop extensions — no backward compatibility breaks for consumers using defaults

## Impact

- **Platform builders**: New `useSessionEnvPool` hook available for custom UIs. `useSessionVariables` replaces `useOneTimeSecrets` (breaking rename, but the feature is pre-release).
- **End users**: Entering a credential once satisfies all components. "Save for future" option on every entry.
- **Console**: Both `SessionLauncher` and `SessionPage` updated to use the new API.

## Related Work

- [one-time-secrets-follow-up-messages](2026-03-20-120646-one-time-secrets-follow-up-messages.md) — original one-time secrets implementation
- [agent-env-form-and-session-composer-integration](2026-03-19-182911-agent-env-form-and-session-composer-integration.md) — agent env form foundation
- [mcp-server-setup-orchestration-hook](2026-03-20-141555-mcp-server-setup-orchestration-hook.md) — MCP setup hook foundation
- [runtime-env-aggregation-in-session-composer](2026-03-20-163410-runtime-env-aggregation-in-session-composer.md) — initial runtime env merge logic

---

**Status**: ✅ Production Ready
**Timeline**: Single session — architecture, implementation, and rename
