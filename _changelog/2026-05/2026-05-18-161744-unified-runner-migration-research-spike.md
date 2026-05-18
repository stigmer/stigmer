# Unified Runner Migration — T01 Research Spike Complete

**Date**: May 18, 2026

## Summary

Completed the Phase 0 hard-gate research spike for migrating the Python
agent-runner and TypeScript cursor-runner into a single unified TypeScript
runner service. All three sub-tasks (module audit, checkpointer validation,
live PoC) passed, yielding a GO decision for the migration using DeepAgents
JS + a graphton-ts compatibility middleware layer.

## Problem Statement

The Stigmer agent execution path runs through two separate services in two
languages: Python `agent-runner` (LangGraph/deepagents for deep agents) and
TypeScript `cursor-runner` (Cursor SDK harness). This creates operational
complexity — a polyglot sandbox image, duplicated infrastructure (MCP
resolution, HITL, status updates, billing), and Python as a runtime
dependency in the agent execution path.

### Pain Points

- Two services, two languages, two sets of dependencies for agent execution
- Shared infrastructure (MCP, HITL, status builder) implemented independently in each
- Sandbox Dockerfile bundles Python + Node.js + Go runtimes
- `graphton` library (37 Python modules, 15K lines) has no TypeScript equivalent
- Python in the execution path prevents full TypeScript stack unification

## Solution

Validated that the JavaScript ecosystem (DeepAgents JS npm, LangGraph JS,
`@langchain/mcp-adapters`) is mature enough to replace the Python stack,
with a focused rebuild of 13 middleware modules (~2,720 TS lines) that have
no JS equivalent.

## Implementation Details

### T01a: Graphton Module Audit
Classified all 37 Python modules (15,017 lines):
- 9 modules (17.7%) → NATIVE in JS ecosystem
- 5 modules (16.1%) → already exist in cursor-runner TypeScript
- 13 modules (30.1%) → must be rebuilt as TypeScript middleware
- 12 modules (36.1%) → not needed (Python-specific or replaced by JS patterns)

### T01b: Checkpointer Validation
- `MemorySaver`: available in `@langchain/langgraph`
- `MongoDBSaver`: available via `@langchain/langgraph-checkpoint-mongodb`
- `interrupt()` + `Command({ resume })`: native in LangGraph JS
- Custom HTTP saver: feasible via `BaseCheckpointSaver` interface (deferred to Phase 2)

### T01c: Live PoC (4/4 pass)
Built and ran a standalone TypeScript PoC against Anthropic API:
1. `createDeepAgent` + `streamEvents` — streaming works, event types captured
2. Custom middleware `wrapToolCall` — middleware intercepts tool calls correctly
3. HITL `interruptOn` config — tool approval schema validated
4. Subagent delegation — `task` tool delegates to scoped subagent

### Deep Research
ChatGPT Deep Research report confirmed ecosystem assessment and corrected
the misconception that `MultiServerMCPClient` was missing in JS.

### Architectural Decision: Option A
`createDeepAgent` wrapped in `createStigmerAgentRunner()` with custom
middleware for loop detection, execution budget, cost cap, tool truncation,
graceful stop, and telemetry.

## Benefits

- Clear migration path with well-scoped rebuild surface (13 modules)
- cursor-runner's 41K-line TS codebase provides significant head start
- Updated timeline: 18-24 days (reduced from 20-29)
- Eliminates Python from agent execution path after cutover
- Unifies shared infrastructure (MCP, HITL, status builder) in single codebase

## Impact

- Affects: `backend/services/agent-runner/`, `backend/services/cursor-runner/`,
  `backend/libs/python/graphton/`, `backend/services/runner/` (new)
- Phase 0 gate cleared — Phase 1 (Service Scaffold) is unblocked
- Migration timeline and risk assessment documented for project planning

## Related Work

- Project: `_projects/2026-05/20260518.01.unified-runner-migration/`
- Deep Research: `research.deepagents-js-langgraph-js-feasibility/04.report.gpt.md`
- Gate decision: `design-decisions/003-t01-gate-decision.md`

---

**Status**: Phase 0 Complete, Phase 1 Ready
**Timeline**: 1 day (research spike); 18-24 days total estimated for full migration
