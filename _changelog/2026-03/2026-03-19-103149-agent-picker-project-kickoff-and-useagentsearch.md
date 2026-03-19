# Agent Picker Project Kickoff and useAgentSearch Hook

**Date**: March 19, 2026

## Summary

Kicked off the agent-picker personal-env project with comprehensive planning (4 phases, 22 subtasks) and delivered the first implementation: the `useAgentSearch` data hook in `@stigmer/react`. This hook is the foundation for agent selection across the platform, serving both platform builders and direct Stigmer users.

## Problem Statement

The SessionComposer has no way to select an agent. Users must rely on implicit defaults or external configuration. Platform builders embedding Stigmer need a searchable agent selection primitive they can use standalone or compose into larger flows.

### Pain Points

- No agent search or selection capability in the React SDK
- No reusable hook for platform builders to build custom agent selection UIs
- Session creation cannot specify which agent to use from the frontend

## Solution

Created a Layer 1 building-block hook (`useAgentSearch`) that wraps `stigmer.agent.list()` with the shared `useResourceSearch` infrastructure, following the exact pattern established by `useSkillSearch` and `useMcpServerSearch`. Also produced the full project plan covering agent picker, personal environment flow, backend env filtering, and GitHub token migration.

## Implementation Details

- **`sdk/react/src/agent/useAgentSearch.ts`**: Data hook with debounced search, loading/error tracking, and cancellation-safe fetching. Takes `org` and optional `UseAgentSearchOptions` (pageSize, debounceMs). Returns `results`, `isLoading`, `error`, `query`, `setQuery`, `refetch`.
- **`sdk/react/src/agent/index.ts`**: Minimal barrel export. Will grow as AgentPicker and other agent module exports are added.
- **Type aliases**: `UseAgentSearchOptions` and `UseAgentSearchReturn` are aliases (not re-exports) of the shared types, preserving extension flexibility for agent-specific options later.

## Benefits

- Platform builders can now search agents with a single hook import
- Consistent API surface with existing resource search hooks (zero learning curve)
- Foundation for AgentPicker component (T01.2) and the broader agent selection flow

## Impact

- **`@stigmer/react`**: New `agent/` module with first export
- **Platform builders**: New hook available for custom agent selection UIs
- **Project**: Phase 1 progress — T01.1 of 11 subtasks complete

## Related Work

- Project plan: `_projects/2026-03/20260319.02.agent-picker-personal-env/tasks/T01_0_plan.md`
- Design decisions: 5 documents covering personal env pattern, resource identification, single-select picker, frontend orchestration, and two-profile hook layering

---

**Status**: In Progress (T01.1 complete, T01.2 next)
**Timeline**: Phase 1 of 4
