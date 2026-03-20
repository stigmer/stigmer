# Extract EnvVarForm — Shared Environment Variable Collection Component

**Date**: March 20, 2026

## Summary

Extracted a domain-generic `EnvVarForm` component from the agent-specific `AgentEnvForm`, and relocated `diffEnvSpec` from the `agent/` module to `environment/`. This establishes the shared foundation for proactive credential collection across both Agent and MCP server setup flows, with zero breaking changes to the existing public API.

## Problem Statement

The `AgentEnvForm` component and `diffEnvSpec` utility were agent-specific by name and module location, but their functionality was entirely generic — they operate on `EnvironmentSpec` data, which is shared by Agents, MCP servers, and any future resource type that declares required environment variables.

### Pain Points

- MCP servers have the same `env_spec` mechanism as Agents but no proactive credential collection flow
- Building the MCP server setup flow would require either duplicating the form component or creating a circular dependency from `mcp-server/` to `agent/`
- `diffEnvSpec` was in `agent/` despite operating on environment-domain types (`EnvironmentSpec`)
- The `AgentEnvForm` used a hardcoded element ID (`"stgm-env-save-toggle"`), which would break if multiple form instances coexisted

## Solution

Extracted the generic form logic into `EnvVarForm` in the `environment/` module, and made `AgentEnvForm` a thin wrapper. Moved `diffEnvSpec` alongside the form to its proper domain home.

## Implementation Details

### New: `sdk/react/src/environment/EnvVarForm.tsx`

- **Types**: `EnvVarFormVariable`, `EnvVarFormSubmitOptions`, `EnvVarFormProps`
- **Props**: Generic `title`/`description` (optional header), `submitLabel`/`cancelLabel` (customizable buttons), `ariaLabel`, `hideSaveToggle`, `defaultSaveForFuture`
- **IDs**: Uses React `useId()` for SSR-safe unique element IDs — supports multiple instances in the same DOM
- **Behavior**: Identical to the original `AgentEnvForm` — scroll shadows, password visibility toggles, save-for-future toggle, empty-field validation

### Refactored: `sdk/react/src/agent/AgentEnvForm.tsx`

- Reduced from ~400 lines to ~107 lines
- `AgentEnvFormVariable` and `AgentEnvFormSubmitOptions` are now `@deprecated` type aliases pointing to the new canonical types
- Component delegates to `EnvVarForm` with `title={agentName}` and agent-specific description

### Moved: `sdk/react/src/environment/diffEnvSpec.ts`

- Relocated from `agent/diffEnvSpec.ts` — operates on `EnvironmentSpec`, not agent-specific data
- Return type updated to `EnvVarFormVariable[]`
- Re-exported from `agent/index.ts` for backward compatibility

### Barrel exports

- `environment/index.ts`: Exports `EnvVarForm`, types, and `diffEnvSpec`
- `agent/index.ts`: Updated `diffEnvSpec` re-export source
- `src/index.ts`: Added `EnvVarForm` and types to environment section

## Benefits

- **DRY**: One form component for all credential collection flows (Agent, MCP server, future resource types)
- **Correct module ownership**: Environment-domain utilities live in `environment/`, not `agent/`
- **Multi-instance safe**: `useId()` enables multiple concurrent forms without ID collisions
- **Flexible embedding**: Optional header, customizable labels, and `ariaLabel` support different embedding contexts (popover, panel, standalone)
- **Zero migration cost**: All existing imports and type references continue to work unchanged

## Impact

- **Platform builders**: New `EnvVarForm` available as a standalone component for custom credential collection UIs
- **SDK consumers**: No breaking changes — `AgentEnvForm` and all existing types/exports work identically
- **Internal**: Unblocks Phase 1+ of the MCP server setup flow (hooks and UI components can import from `environment/` cleanly)

## Related Work

- Part of the [MCP Server Setup Flow project](../_projects/2026-03/20260320.02.mcp-server-setup-flow/) (Phase 0)
- Builds on the [Agent Picker + Personal Environment](../_projects/2026-03/20260319.02.agent-picker-personal-env/) flow that established `AgentEnvForm` and `diffEnvSpec`
- Builds on the [Secrets Flow Hardening](../_projects/2026-03/20260319.06.secrets-flow-hardening/) project that established the save-or-use-once model

---

**Status**: Production Ready
