# Barrel Exports for Agent, Environment, and Agent Instance Modules

**Date**: March 19, 2026

## Summary

Wired the agent, environment, and agent-instance module barrels into the main `@stigmer/react` entry point, completing the public API surface for all Phase 1 building-block hooks. Platform builders can now import all new hooks and components directly from `@stigmer/react`.

## Problem Statement

Seven new hooks and one component were implemented across three domain modules (agent, environment, agent-instance) in sessions 1–7, but they were only exported from their module-level barrels — not from the package entry point. Consumers importing from `@stigmer/react` could not access them.

### Pain Points

- `useAgentSearch`, `AgentPicker`, `useEnvironment`, `useCreateEnvironment`, `useUpdateEnvironment`, `useAgentInstance`, and `useCreateAgentInstance` were unreachable from `@stigmer/react`
- Platform builders would have had to use deep imports (e.g., `@stigmer/react/agent`) which breaks the single-entry-point convention

## Solution

Added three new re-export sections to `sdk/react/src/index.ts` following the established pattern used by Skill, MCP Server, and GitHub modules: comment header, value exports, then type exports.

## Implementation Details

Single file modified: `sdk/react/src/index.ts` (+33 lines).

**Agent** (from `./agent`):
- Values: `useAgentSearch`, `AgentPicker`
- Types: `UseAgentSearchOptions`, `UseAgentSearchReturn`, `AgentPickerProps`

**Environment** (from `./environment`):
- Values: `useEnvironment`, `useCreateEnvironment`, `useUpdateEnvironment`
- Types: `UseEnvironmentReturn`, `UseCreateEnvironmentReturn`, `UseUpdateEnvironmentReturn`

**Agent Instance** (from `./agent-instance`):
- Values: `useAgentInstance`, `useCreateAgentInstance`
- Types: `UseAgentInstanceReturn`, `UseCreateAgentInstanceReturn`

## Benefits

- Platform builders can now import all agent-related hooks from a single entry point
- Consistent with existing SDK export conventions — no surprises for consumers already using `@stigmer/react`
- Completes the Layer 1 public API surface for the agent-picker-personal-env project

## Impact

- **SDK consumers**: All seven new hooks and the AgentPicker component are now part of the `@stigmer/react` public API
- **Phase 1 milestone**: Building-block layer (T01.1–T01.8) is complete; remaining Phase 1 tasks are integration/wiring

## Related Work

- Part of the `20260319.02.agent-picker-personal-env` project (Phase 1, Task T01.8)
- Depends on: T01.1–T01.7 (hooks and module barrels created in sessions 1–7)
- Enables: T01.9 (SessionComposer integration), T01.10 (useCreateSession wiring), T01.11 (Console integration)

---

**Status**: ✅ Production Ready
