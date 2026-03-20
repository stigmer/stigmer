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
**Current Task**: Phase 2, T02.2 complete. Next: Phase 2, T02.3 — Enhance `McpServerPicker` with setup integration
**Status**: In progress — Phase 0 done, Phase 1 done, Phase 2 T02.1 done, Phase 2 T02.2 done, ready for T02.3

## Session Progress (2026-03-20)

### Session 5: Phase 2, T02.2 — McpServerConfigPanel component — COMPLETE

**What was accomplished:**
- Planned and implemented `McpServerConfigPanel.tsx` — per-server drill-in configuration panel composing `EnvVarForm` + `McpToolSelector`
- Discovered and fixed two issues in the reducer/hook:
  - DD-R10: `submitting` variant was missing `missingVariables` → added to prevent form flash-unmount during credential submission
  - DD-R11: No error recovery path on submission failure → added `SUBMIT_FAIL` action for `submitting → needsSetup` transition
- Five design decisions made (DD-R12 through DD-R16):
  - No "Apply" button — EnvVarForm owns credential submission, tool toggles apply immediately
  - Decomposed props with grouped `credentials?` sub-object for SDK-first reusability
  - Tool selector disabled while credentials are pending (progressive disclosure)
  - No separate `onCancel` for EnvVarForm (panel header Back button suffices)
  - EnvVarForm width override via `className="w-full"` (tailwind-merge)
- Updated barrel exports in `mcp-server/index.ts` and `index.ts`
- Zero lint errors, zero TypeScript errors

**File created:**
- `sdk/react/src/mcp-server/McpServerConfigPanel.tsx` — 260 lines, pure presentational component

**Component API:**
- Props: `mcpServer`, `credentials?`, `discoveredTools`, `toolApprovals`, `enabledTools`, `onEnabledToolsChange`, `onBack`, `error?`, `disabled?`, `className?`
- Exported types: `McpServerConfigPanelProps`, `McpServerCredentialsProps`
- `credentials?` sub-object controls form visibility — present = credentials form + disabled tool selector, absent = tool-selector only
- Header with back button, optional server icon, name, truncated description
- `EnvVarForm` composition with no `onCancel` and `className="w-full"` override
- `McpToolSelector` always rendered; disabled while credentials are pending
- Inline error display with `role="alert"`

**Files modified:**
- `sdk/react/src/mcp-server/mcpServerSetupReducer.ts` — Added `missingVariables` to `submitting` variant, added `SUBMIT_FAIL` action + case
- `sdk/react/src/mcp-server/useMcpServerSetup.ts` — Changed catch block from `SET_ERROR` to `SUBMIT_FAIL`
- `sdk/react/src/mcp-server/index.ts` — Added `McpServerConfigPanel` + types exports
- `sdk/react/src/index.ts` — Added re-exports in MCP Server section

**Key decisions:**
- No "Apply" button (DD-R12) — EnvVarForm already has "Save"/"Use once" submit; tool changes are immediate local state. Batch "Apply" would fight component contract.
- Decomposed props (DD-R13) — Platform builders can use any state management, not just our reducer. `credentials?` presence controls form rendering.
- `SUBMIT_FAIL` action (DD-R11) — Enables retry on credential submission failure. Entry transitions `submitting → needsSetup` with error preserved.
- `submitting` carries `missingVariables` (DD-R10) — Prevents form flash-unmount during async credential save.

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
- `sdk/react/src/mcp-server/mcpServerSetupReducer.ts` — Pure reducer with 4 statuses (`loading`, `needsSetup`, `submitting`, `ready`), 11-action union (including `SUBMIT_FAIL`), `Record<string, Entry>` state keyed by `org/slug`, orthogonal error per entry

**Exports:**
- Types: `McpServerSetupPhase`, `McpServerSetupEntry`, `McpServerSetupState`, `McpServerSetupAction`
- Constants: `INITIAL_MCP_SETUP_STATE`
- Functions: `mcpServerSetupReducer`, `toServerKey`

**Key decisions:**
- `Record<string, Entry>` over `Map` for idiomatic React reducer spreading
- Error orthogonal to phase (matches `AgentSetupState` pattern) — preserves form context on submission failure
- No `configuring` status — picker owns drill-in navigation via local `useState`
- No `McpServerUsageInput` in reducer state — derived by hook in `usageInputs`
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

1. **Phase 2, T02.3**: Enhance `McpServerPicker` with setup integration
   - Setup state indicators per server (loading spinner, needs-setup amber badge, ready green badge, error red badge)
   - Drill-in support: clicking "Configure" transitions popover from picker list to `McpServerConfigPanel`
   - New additive props: `setupEntries?`, `onServerAdded?`, `onServerRemoved?`, `onSubmitEnvVars?`, `onEnabledToolsChange?`
   - Backward-compatible: if `setupEntries` not provided, picker behaves exactly as today
2. **Phase 3**: SessionComposer integration, submission blocking, enhanced chips, runtimeEnv aggregation

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
- Phase 2, T02.2 is implemented and verified (`McpServerConfigPanel`)
- 16 design refinements from master plan (DD-R1 through DD-R16) — all approved and applied
- The full orchestration layer is ready: reducer (state machine) + hook (composition, methods, derived state)
- Both UI building blocks are ready: `McpToolSelector` (tool checklist) + `McpServerConfigPanel` (config panel composing form + selector)
- Phase 2 continues — T02.3 enhances `McpServerPicker` with setup indicators and drill-in to `McpServerConfigPanel`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.02.mcp-server-setup-flow/checkpoints/2026-03-20-session-5.md
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
| `sdk/react/src/mcp-server/McpServerConfigPanel.tsx` | **NEW** — Per-server config: credentials + tools |
| `sdk/react/src/mcp-server/McpToolSelector.tsx` | Tool checklist with approval badges |
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
- "Continue with next task" - Start T02.3 (Enhance McpServerPicker)
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
