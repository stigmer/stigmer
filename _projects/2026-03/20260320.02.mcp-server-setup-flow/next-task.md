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
**Current Task**: Phase 0 complete. Next: Phase 1 (T01.1 — mcpServerSetupReducer)
**Status**: In progress — Phase 0 done, ready for Phase 1

## Session Progress (2026-03-20)

### Phase 0: Extract EnvVarForm + Move diffEnvSpec — COMPLETE

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

1. **Phase 1, T01.1**: Create `mcpServerSetupReducer.ts` in `sdk/react/src/mcp-server/`
   - State machine for per-server setup: `loading → needs-setup → configuring → ready → error`
   - Map-based state keyed by `org/slug`
   - Pure reducer, independently testable
2. **Phase 1, T01.2**: Create `useMcpServerSetup.ts` orchestration hook
   - Composes `usePersonalEnvironment`, `diffEnvSpec`, MCP SDK client
   - `addServer`, `removeServer`, `submitEnvVars`, `setEnabledTools`, `toUsageInputs`
3. **Phase 2**: UI components — `McpToolSelector`, `McpServerConfigPanel`, enhanced `McpServerPicker`
4. **Phase 3**: SessionComposer integration, submission blocking, enhanced chips

## Context for Resume

- The plan (`T01_0_plan.md`) is the authoritative task breakdown
- Four phases: Phase 0 (EnvVarForm extraction) → Phase 1 (setup hook) → Phase 2 (UI components) → Phase 3 (SessionComposer integration)
- Key architectural decisions:
  - MCP secrets through personal environment (no McpServerInstance)
  - Browse-then-configure UX (drill-in pattern in popover)
  - Show already-discovered tools only (no backend changes)
  - Shared EnvVarForm extraction from AgentEnvForm
  - Submission blocking for unconfigured servers
- Phase 0 is committed and verified — no lint errors, all exports work

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.02.mcp-server-setup-flow/checkpoints/2026-03-20-session-1.md
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
| `sdk/react/src/environment/EnvVarForm.tsx` | **NEW** — Shared env var collection form |
| `sdk/react/src/environment/diffEnvSpec.ts` | **MOVED** — Env spec diffing (shared) |
| `sdk/react/src/agent/AgentEnvForm.tsx` | Thin wrapper over EnvVarForm |
| `sdk/react/src/agent/useAgentSetup.ts` | Agent setup orchestration (pattern to mirror) |
| `sdk/react/src/agent/agentSetupReducer.ts` | Agent setup state machine (pattern to mirror) |
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
- "Continue with next task" - Start Phase 1 (mcpServerSetupReducer)
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
