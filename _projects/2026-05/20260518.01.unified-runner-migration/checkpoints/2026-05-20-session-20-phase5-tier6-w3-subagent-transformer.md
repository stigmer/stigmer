# Session 20: Phase 5 Tier 6 W3 — Subagent Transformer

**Date**: 2026-05-20
**Duration**: ~35 min
**Status**: COMPLETE

## Accomplishments

- Built `subagent-transformer.ts` — full transformation pipeline from proto `SubAgent[]` to `CompiledSubAgent[]`
- Added `isModelRegistered()` to model registry for model override validation
- Added `wrapRunnable()` to SubAgentGate for CompiledSubAgent integration
- Exposed `costCap` in `MiddlewareStackResult` for sub-agent cost sharing
- Wired into `setup.ts` as Step 11b: transform + compile + pass subagents to `createDeepAgent`
- MCP access filtering with slug validation and tool intersection
- Per-subagent skill resolution via batch gRPC fetch + prompt injection
- Built-in explore/shell subagents with prompt-based tool restriction
- 45 new tests passing, 1057 total (tsc --noEmit clean)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Subagent format | `CompiledSubAgent` | Full middleware control; deepagents defaults (todoList, filesystem, summarization) are unwanted for platform subagents |
| MCP tools | Filter parent tools | Performance (no 3-30s reconnection); seedpack servers are stateless REST bridges |
| Skills | Prompt injection | StateBackend incompatible with native `skills` field; our pipeline is richer (gRPC, BM25, org-scoped) |
| Platform tools | StateBackend built-ins + prompt restriction | deepagents provides read/write/execute/etc from StateBackend; prompt boundaries restrict explore/shell |
| Model validation | Fail-fast on invalid override | Forces operators to fix config; prevents running on unintended model |
| Concurrency | SubAgentGate + RunnableLambda | Wraps compiled graph in capacity check; max 3 parallel subagents |

## Key Code Changes

| File | Change |
|------|--------|
| `src/activities/execute-deep-agent/subagent-transformer.ts` | NEW: 340 LOC — full transform + compile pipeline |
| `src/activities/execute-deep-agent/__tests__/subagent-transformer.test.ts` | NEW: 45 tests |
| `src/shared/model-registry.ts` | Added `isModelRegistered()` lookup |
| `src/shared/subagent-gate.ts` | Added `wrapRunnable()` with RunnableLambda |
| `src/middleware/index.ts` | Exposed `costCap` in MiddlewareStackResult |
| `src/activities/execute-deep-agent/setup.ts` | Wired Step 11b: subagent transform + compile |

## Architecture

```
proto SubAgent[] → transformAndCompileSubagents()
  ├── createBuiltinSubagents() → explore + shell specs
  ├── transformSingleSubagent() per proto
  │   ├── filterMcpToolsForSubagent() — slug + tool intersection
  │   ├── resolveSubagentSkillPrompt() — batch fetch + prompt inject
  │   ├── validateModelOverride() — registry lookup
  │   └── injectThinkTool() — for non-thinking models
  ├── compileSubagents()
  │   ├── createDeepAgent() per spec
  │   ├── buildSubAgentMiddleware() — loop, budget, truncation, cost cap
  │   └── SubAgentGate.wrapRunnable() — max 3 concurrency
  └── CompiledSubAgent[] → parent createDeepAgent({ subagents })
```

## Test Results

- **New tests**: 45 (subagent-transformer.test.ts)
- **Total passing**: 1057
- **Type check**: `tsc --noEmit` clean
- **No new dependencies**

## Next Session Plan

- **Phase 6: Deployment** — Docker image, queue routing, cutover plan
- Or: remaining Tier 6 items (integration test suites for skill/subagent pipelines)
