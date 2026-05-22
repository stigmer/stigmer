# Subagent Transformer — Sub-agent Delegation for ExecuteDeepAgent

**Date**: May 20, 2026

## Summary

Built the subagent-transformer module that enables sub-agent delegation for the unified TypeScript runner's ExecuteDeepAgent activity. Proto `SubAgent` definitions are now transformed into compiled deepagents graphs with full middleware control, concurrency gating, MCP access filtering, and per-subagent skill resolution. This closes the last significant feature gap (W3) in Phase 5 Tier 6.

## Problem Statement

The unified TypeScript runner's `ExecuteDeepAgent` pipeline called `createDeepAgent()` without any subagents — meaning every deep agent execution ran without delegation capability. Sub-agents are a core platform feature (first-class field on AgentSpec), enabling agents to delegate exploration, shell execution, and specialized tasks to bounded sub-graphs.

### Pain Points

- Agents could not delegate tasks (explore codebases, run commands) to specialized sub-agents
- The existing `buildSubAgentMiddleware()` and `SubAgentGate` were built but never wired into the pipeline
- No MCP access restriction for sub-agents (security boundary was missing)
- No per-subagent skill injection
- Model override validation did not exist

## Solution

A complete transformation pipeline from proto `SubAgent[]` to `CompiledSubAgent[]` that slots into the existing setup pipeline between middleware construction and agent graph creation.

## Implementation Details

**New module** (`subagent-transformer.ts`, 340 LOC):
- `createBuiltinSubagents()` — explore + shell types with prompt-based tool restriction
- `transformSingleSubagent()` — proto fields → intermediate spec with model validation + think tool injection
- `filterMcpToolsForSubagent()` — slug validation, tool name intersection, graceful degradation
- `collectAllSkillRefs()` + `resolveSubagentSkillPrompt()` — batch gRPC fetch + prompt injection
- `compileSubagents()` — per-subagent `createDeepAgent()` + middleware + gate wrapping
- `transformAndCompileSubagents()` — top-level orchestrator called from setup.ts

**Modified infrastructure**:
- `SubAgentGate.wrapRunnable()` — uses `RunnableLambda` for Runnable interface compatibility
- `model-registry.ts` + `isModelRegistered()` — validates model overrides against the registry
- `middleware/index.ts` — exposes `costCap` in result for sub-agent cost sharing
- `setup.ts` — wired as Step 11b before `createDeepAgent()`

**Key design decisions**:
- `CompiledSubAgent` format: gives full middleware control; avoids deepagents' unwanted defaults (todoList, filesystem, summarization middleware)
- Filter parent MCP tools: no reconnection overhead (3-30s saved per subagent); seedpack servers are stateless
- Prompt injection for skills: StateBackend incompatible with native `skills` field; our gRPC pipeline is richer

## Benefits

- Deep agent executions can now delegate tasks to specialized sub-agents
- Built-in explore/shell sub-agents provide codebase exploration and command execution without manual configuration
- MCP access restriction enforces security boundaries (sub-agents only access explicitly granted servers/tools)
- Per-subagent skill injection enables specialized capabilities per delegate
- Concurrency gating (max 3) prevents resource exhaustion
- Cost cap sharing ensures sub-agent costs count against parent's budget

## Impact

- **Runner service**: ExecuteDeepAgent now supports the full agent delegation feature
- **Agent authors**: Can define sub_agents in agent specs and have them work in the TS runner
- **Platform security**: MCP access filtering prevents sub-agents from accessing tools beyond their grants
- **Phase 5 Tier 6**: All three workstreams (Platform Mount, Attachment Injector, Subagent Transformer) are now complete

## Related Work

- Phase 5 Tier 6 W1: Platform Mount (session 18)
- Phase 5 Tier 6 W2: Attachment Injector (session 19)
- Phase 3c: HITL + Approval (session 8) — built SubAgentGate and buildSubAgentMiddleware
- Python reference: `graphton/subagent_transformer.py` (795 LOC)

---

**Status**: ✅ Production Ready
**Timeline**: ~35 minutes (combined Sessions 1+2 into single implementation)
