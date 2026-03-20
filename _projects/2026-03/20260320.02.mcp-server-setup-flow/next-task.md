# Next Task: 20260320.02.mcp-server-setup-flow

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260320.02.mcp-server-setup-flow

**Description**: Add proactive secret collection, live tool discovery, and per-tool selection for MCP servers in the SessionComposer — mirroring the agent setup flow but adapted for multi-select.
**Goal**: When a user selects MCP servers in SessionComposer, proactively check env_spec, collect credentials via inline form, trigger on-demand tool discovery, display discovered tools for selection, and build McpServerUsageInput with enabledTools. Extract shared EnvVarForm from AgentEnvForm for reuse.
**Tech Stack**: TypeScript/React (SDK hooks and components in @stigmer/react), Go (backend on-demand discovery endpoint)
**Components**: @stigmer/react (McpServerPicker, McpServerConfigPanel, McpToolSelector, useMcpServerSetup, SessionComposer), backend McpServer service (discovery RPC), @stigmer/react shared EnvVarForm extraction

## Current State

**Created**: 2026-03-20
**Current Task**: Phase 2, T02.1 complete. Next: Phase 2, T02.2 — `McpServerConfigPanel` component
**Status**: In progress — Phase 0 done, Phase 1 done, Phase 2 T02.1 done, ready for T02.2

## Session Progress (2026-03-20)

### Session 4: Phase 2, T02.1 — McpToolSelector component — COMPLETE

**What was accomplished:**
- Planned and implemented `McpToolSelector.tsx` — pure presentational tool checklist component
- Two design decisions made during planning (both approved):
  - Empty state: clean default only (no CLI hint — SDK-appropriate for platform builders)
  - Width: no hardcoded width (fills container, parent controls layout)
- Updated barrel exports in `mcp-server/index.ts` and `index.ts`
- Zero lint errors, zero TypeScript errors
- Committed: `05ea4318`

**File created:**
- `sdk/react/src/mcp-server/McpToolSelector.tsx` — 243 lines, pure presentational component

**Component API:**
- Props: `tools`, `toolApprovals`, `enabledTools`, `onChange`, `disabled`, `className`
- Controlled component — parent owns all state
- Approval badge with shield icon + `title` tooltip for approval message template
- Bulk selection via "All" / "None" compact text buttons
- Scrollable list via `useScrollShadows` + `ScrollFade` with `max-h-52`
- Empty state for undiscovered tools
- `useId()` for SSR-safe unique IDs per checkbox

**Files modified:**
- `sdk/react/src/mcp-server/index.ts` — Added `McpToolSelector` + `McpToolSelectorProps` exports
- `sdk/react/src/index.ts` — Added re-exports in MCP Server section

**Key decisions:**
- Native `<input type="checkbox">` with `accent-primary size-3` — inherently keyboard-accessible, matches `EnvironmentVariableEditor` pattern
- Approval lookup via `useMemo` Map for O(1) per-row lookups
- No hardcoded width — component is a building block that fills its container
- Clean empty state without CLI hint — platform builders embedding in their own products don't need Stigmer CLI references
- Approval badge uses `bg-warning/15 text-warning` with shield icon (matches existing badge patterns from `ToolCallItem`)

### Session 3: Phase 1, T01.2 — useMcpServerSetup orchestration hook — COMPLETE

**What was accomplished:**
- Planned and implemented `useMcpServerSetup.ts` — the Layer 2 orchestration hook for multi-server MCP setup
- Made five design refinements from the master plan (all approved during planning):
  - DD-R5: `entries` as `Record` (not `Map`) — matches reducer, avoids conversion cost
  - DD-R6: `usageInputs` as derived `useMemo` value (not `toUsageInputs()` function)
  - DD-R7: `pendingRuntimeEnv` via flat `useRef` accumulation, cleared on reset
  - DD-R8: Error handling — dispatch `SET_ERROR` without re-throwing (multi-server: callers read entries reactively)
  - DD-R9: `clearError(ref)` per-server (not global like agent flow)
- Updated barrel exports in `mcp-server/index.ts` and `index.ts`
- Zero lint errors, zero TypeScript errors

**File created:**
- `sdk/react/src/mcp-server/useMcpServerSetup.ts` — Orchestration hook composing `useReducer(mcpServerSetupReducer)`, `usePersonalEnvironment`, `diffEnvSpec`, `useStigmer().mcpServer`

**Hook API:**
- Methods: `addServer`, `removeServer`, `submitEnvVars`, `setEnabledTools`, `clearError`, `reset`
- Derived: `allReady`, `needsSetupCount`, `pendingRuntimeEnv`, `usageInputs`
- Supports saved (personal environment) and one-time (runtimeEnv) credential paths

**Files modified:**
- `sdk/react/src/mcp-server/index.ts` — Added hook, types, and reducer type exports
- `sdk/react/src/index.ts` — Added re-exports in MCP Server section

**Key decisions:**
- No re-throw on error (DD-R8) — unlike `useAgentSetup`, errors are only dispatched to reducer for reactive reading via `entries[key].error`
- `usageInputs` derived via `useMemo` — when enabledTools matches all discovered tools, passes `undefined` (API convention for "all tools")
- `pendingRuntimeEnv` tracked in `useRef` — consumed imperatively at session creation, not reactive
- `computeDefaultEnabledTools` helper — uses `spec.defaultEnabledTools` if non-empty, otherwise all discovered tool names
- Known edge case accepted: personal environment loading race (same as agent flow)

### Session 2: Phase 1, T01.1 — mcpServerSetupReducer — COMPLETE

**What was accomplished:**
- Planned and implemented `mcpServerSetupReducer.ts` — the pure state machine for per-server MCP setup
- Made four design refinements from the master plan (all approved during planning):
  - DD-R1: Merged `ready` and `ready-default` into single `ready` status
  - DD-R2: Removed `configuring` from reducer (UI navigation state, not data state)
  - DD-R3: Added `submitting` status for UX feedback on credential form
  - DD-R4: Error orthogonal to phase (matching `agentSetupReducer` pattern)
- Zero lint errors, zero TypeScript errors

**File created:**
- `sdk/react/src/mcp-server/mcpServerSetupReducer.ts` — Pure reducer with 4 statuses (`loading`, `needsSetup`, `submitting`, `ready`), 10-action union, `Record<string, Entry>` state keyed by `org/slug`, orthogonal error per entry

**Exports:**
- Types: `McpServerSetupPhase`, `McpServerSetupEntry`, `McpServerSetupState`, `McpServerSetupAction`
- Constants: `INITIAL_MCP_SETUP_STATE`
- Functions: `mcpServerSetupReducer`, `toServerKey`

**Key decisions:**
- `Record<string, Entry>` over `Map` for idiomatic React reducer spreading
- Error orthogonal to phase (matches `AgentSetupState` pattern) — preserves form context on submission failure
- No `configuring` status — picker owns drill-in navigation via local `useState`
- No `McpServerUsageInput` in reducer state — derived by hook in `toUsageInputs()`
- `SUBMIT_START` guards from `needsSetup` only; `SUBMIT_DONE` guards from `submitting` only
- `SET_ENABLED_TOOLS` guards from `ready` only
- `ADD_SERVER` always resets to `loading` (hook prevents misuse)

### Session 1: Phase 0 — Extract EnvVarForm + Move diffEnvSpec — COMPLETE

**What was accomplished:**
- Reviewed and approved the master plan (T01_0_plan.md)
- Executed Phase 0 in full: extracted shared `EnvVarForm` from `AgentEnvForm`
- Moved `diffEnvSpec` from `agent/` to `environment/` module
- Updated all barrel exports with zero breaking changes

**Files created:**
- `sdk/react/src/environment/EnvVarForm.tsx` — Shared env var form with generic props (`title`, `description`, `submitLabel`, `cancelLabel`, `ariaLabel`), `useId()` for SSR-safe unique IDs, full form logic + icons
- `sdk/react/src/environment/diffEnvSpec.ts` — Moved from `agent/`, updated to use `EnvVarFormVariable` type, generalized JSDoc

**Files modified:**
- `sdk/react/src/agent/AgentEnvForm.tsx` — Thin wrapper over `EnvVarForm`, backward-compatible type aliases with `@deprecated`
- `sdk/react/src/agent/useAgentSetup.ts` — Updated `diffEnvSpec` import path
- `sdk/react/src/agent/index.ts` — Updated `diffEnvSpec` re-export source
- `sdk/react/src/environment/index.ts` — Added `EnvVarForm`, types, `diffEnvSpec` exports
- `sdk/react/src/index.ts` — Added `EnvVarForm` and types to environment section

**Files deleted:**
- `sdk/react/src/agent/diffEnvSpec.ts` — Moved to `environment/`

**Key decisions:**
- Used React `useId()` instead of hardcoded element IDs — critical for MCP flow where multiple forms may coexist
- `AgentEnvFormVariable` and `AgentEnvFormSubmitOptions` kept as deprecated type aliases for backward compatibility
- `diffEnvSpec` accessible from both environment barrel (canonical) and agent barrel (backward-compatible re-export)
- `EnvVarForm` renders header only when `title` is provided — allows headerless embedding in `McpServerConfigPanel`

## Next Steps

1. **Phase 2, T02.2**: Create `McpServerConfigPanel` component
   - Per-server drill-in config: credentials form (EnvVarForm) + tool selector (McpToolSelector)
   - Header with server name/icon + "Back" button
   - State-driven layout: needsSetup shows credentials first, ready shows both sections
2. **Phase 2, T02.3**: Enhance `McpServerPicker` with setup integration
   - Setup state indicators, drill-in to config panel
3. **Phase 3**: SessionComposer integration, submission blocking, enhanced chips

## Context for Resume

- The plan (`T01_0_plan.md`) is the authoritative task breakdown
- Four phases: Phase 0 (EnvVarForm extraction) → Phase 1 (setup hook) → Phase 2 (UI components) → Phase 3 (SessionComposer integration)
- Key architectural decisions:
  - MCP secrets through personal environment (no McpServerInstance)
  - Browse-then-configure UX (drill-in pattern in popover)
  - Show already-discovered tools only (no backend changes)
  - Shared EnvVarForm extraction from AgentEnvForm
  - Submission blocking for unconfigured servers
- Phase 0 is committed and verified
- Phase 1 is committed and verified (reducer + hook)
- Phase 2, T02.1 is committed and verified (`McpToolSelector`)
- 9 design refinements from master plan (DD-R1 through DD-R9) — all approved and applied
- The full orchestration layer is ready: reducer (state machine) + hook (composition, methods, derived state)
- `McpToolSelector` is the first UI component — pure presentational, controlled via props
- Phase 2 continues — T02.2 (`McpServerConfigPanel`) composes `EnvVarForm` + `McpToolSelector`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.02.mcp-server-setup-flow/checkpoints/2026-03-20-session-4.md
```

### 2. Current Task Plan
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.02.mcp-server-setup-flow/tasks/T01_0_plan.md
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.02.mcp-server-setup-flow/README.md`

## Key Related Projects

These projects established patterns and infrastructure this project builds on:

1. **Agent Picker + Personal Environment Flow**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/tasks/T01_0_plan.md`
   - Established: `useAgentSetup`, `AgentEnvForm`, `diffEnvSpec`, personal environment/instance flow
   - `useMcpServerSetup` mirrors this architecture

2. **Secrets Flow Hardening**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/tasks/T01_2_revised_plan.md`
   - Established: state machine in useAgentSetup, save-or-use-once model, `OneTimeSecretsInput`, `SecretFlowErrorGuide`, Error type migration
   - Unified "saved vs one-time" model applies to MCP server secrets too

## Key Source Files

| File | Purpose |
|------|---------|
| `sdk/react/src/mcp-server/McpToolSelector.tsx` | **NEW** — Tool checklist with approval badges |
| `sdk/react/src/mcp-server/useMcpServerSetup.ts` | Multi-server setup orchestration hook |
| `sdk/react/src/mcp-server/mcpServerSetupReducer.ts` | Per-server setup state machine |
| `sdk/react/src/environment/EnvVarForm.tsx` | Shared env var collection form |
| `sdk/react/src/environment/diffEnvSpec.ts` | Env spec diffing (shared) |
| `sdk/react/src/agent/AgentEnvForm.tsx` | Thin wrapper over EnvVarForm |
| `sdk/react/src/agent/useAgentSetup.ts` | Agent setup orchestration (pattern to mirror) |
| `sdk/react/src/agent/agentSetupReducer.ts` | Agent setup state machine (pattern mirrored) |
| `sdk/react/src/mcp-server/McpServerPicker.tsx` | Current MCP picker (enhance in Phase 2) |
| `sdk/react/src/composer/SessionComposer.tsx` | Composer (wire setup hook in Phase 3) |
| `sdk/react/src/environment/usePersonalEnvironment.ts` | Personal env hook (reused by MCP setup) |

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.02.mcp-server-setup-flow/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.02.mcp-server-setup-flow/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.02.mcp-server-setup-flow/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.02.mcp-server-setup-flow/dont-dos/
```

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Continue with next task" - Start T02.2 (McpServerConfigPanel)
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
