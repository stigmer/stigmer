# Unified Runner Phase 3a: ExecuteDeepAgent Walking Skeleton

**Date**: May 19, 2026

## Summary

Replaced the ExecuteDeepAgent activity stub with a fully functional walking skeleton that exercises the complete setup-to-execution path: hydrating the execution from the database, resolving the full resource chain, provisioning workspace, connecting MCP servers, constructing the LangGraph agent via `createDeepAgent`, and persisting a final status. This is the first time the unified TypeScript runner can actually execute deep agents end-to-end.

## Problem Statement

The unified runner (`backend/services/runner/`) had a working `ExecuteCursor` activity (ported in Phase 1) and shared infrastructure (Phase 2), but `ExecuteDeepAgent` was still a stub returning EXECUTION_FAILED. Deep agent executions continued routing to the Python `agent-runner` via the `ExecuteGraphton` activity.

### Pain Points

- Two runtime services (Python + TypeScript) for agent execution
- Cannot validate the shared infrastructure (checkpointer, MCP manager, workspace provisioner) against the deep agent path until it's wired
- No end-to-end TypeScript path for LangGraph-based agents

## Solution

Implement Phase 3a as a "walking skeleton" — a minimal but complete activity that exercises every integration point without yet implementing production middleware or progressive streaming. This validates the architecture before investing in the complex middleware port (Phase 3b).

## Implementation Details

### New Modules

| Module | Responsibility |
|--------|---------------|
| `setup.ts` | Orchestrates the full setup pipeline: chain resolution, checkpointer, workspace, environment, MCP, model, agent graph |
| `environment.ts` | Fetches ExecutionContext via gRPC, extracts env vars with secret tracking |
| `prompt-builder.ts` | Assembles system prompt from workspace, skills, file refs, response rules, sub-agent delegation rules |

### Activity Lifecycle

```
ExecuteDeepAgent(executionId, threadId)
  → performSetup(config, client, executionId, threadId)
    → getExecution → getSession → getAgentInstance → getAgent
    → createCheckpointer (memory or http)
    → resolveEnvironment (from ExecutionContext)
    → provisionWorkspace (git, local path, or empty)
    → resolveMcpServers + connectMcpServers
    → buildEnhancedSystemPrompt
    → constructModel (ChatAnthropic with proxy baseURL)
    → createDeepAgent({ model, checkpointer, tools, systemPrompt })
  → agentGraph.invoke(input, config)
  → buildFinalStatus (extract assistant messages)
  → persistStatus (gRPC)
  → slimStatus (Temporal return value)
  → cleanup (close MCP connections)
```

### Key Design Choices

- **Pre-constructed model**: `ChatAnthropic` with explicit `baseURL` for proxy routing (not global fetch interceptor)
- **invoke() not streamEvents()**: Simpler for Phase 3a; Phase 3b will switch to streaming
- **SetupResult trimmed**: Excludes artifact storage, writeback, inline publisher (added in 3b)
- **Graceful errors**: Failed status persisted via gRPC; slim status always returned to Temporal

## Benefits

- First complete TypeScript execution path for deep agents
- Validates all Phase 2 shared infrastructure against real execution flow
- Establishes the module structure for Phase 3b middleware additions
- 24 new tests covering environment resolution, prompt construction, and activity lifecycle
- Clear deferred-items documentation ensures nothing falls through cracks

## Impact

- **Unified runner**: Now has both activities functional (ExecuteCursor + ExecuteDeepAgent)
- **Migration progress**: Phase 3 split into 3a/3b/3c with 3a complete
- **Developer experience**: Next contributor can resume Phase 3b from a working baseline

## Related Work

- Phase 1: Service scaffold — `checkpoints/2026-05-19-session-2.md`
- Phase 2: Shared infrastructure — `checkpoints/2026-05-19-session-3-phase2.md`
- Graphton module audit — `design-decisions/001-t01a-graphton-module-audit.md`
- Gate decision — `design-decisions/003-t01-gate-decision.md`

---

**Status**: ✅ Production Ready (walking skeleton — full middleware in Phase 3b)
**Timeline**: 1 session (~2 hours)
