# ClassifyToolApprovals Activity Ported to Unified TypeScript Runner

**Date**: May 19, 2026

## Summary

Ported the `ClassifyToolApprovals` Temporal activity from the Python agent-runner to the unified TypeScript runner service. This activity uses a lightweight LLM structured-output call to classify each MCP server tool as safe (auto-approve) or sensitive (requires human approval), feeding the lowest-priority layer of the four-level tool approval policy chain.

## Problem Statement

The Python agent-runner still handles `ClassifyToolApprovals` on the shared Temporal task queue. The unified runner migration (Phase 4) requires porting all supporting activities to TypeScript before the Python worker can be decommissioned.

### Pain Points

- Python agent-runner is the last remaining dependency for the connect workflow's classification step
- No TypeScript equivalent existed for the LLM-based tool safety classification
- The model selection logic (economy-tier derivation from primary model) had no TS implementation

## Solution

Ported the activity with exact behavioral parity: same system prompt, same batching (40 tools per batch), same fallback strategy (requires_approval=true on failure), same output filtering (only tools requiring approval returned). Used `@langchain/openai` with Zod-based `.withStructuredOutput()` to mirror the Python `with_structured_output(Pydantic)` pattern.

## Implementation Details

**New files (4):**
- `src/shared/model-registry.ts` — `getSummarizationModel()` with provider→economy tier derivation (anthropic→claude-haiku-4.5, openai→gpt-4o-mini)
- `src/activities/classify-tool-approvals.ts` — Core `classifyTools()` function + `createClassifyToolApprovalsActivities(config)` factory
- `src/activities/__tests__/classify-tool-approvals.test.ts` — 18 unit tests
- `src/shared/__tests__/model-registry.test.ts` — 6 unit tests

**Modified files (4):**
- `src/config.ts` — Added `primaryModel` field (env: `STIGMER_PRIMARY_MODEL`, default: `gpt-4.1`)
- `src/main.ts` — Registered `ClassifyToolApprovals` in the activity map
- `package.json` — Added `@langchain/openai` and `zod` as direct dependencies
- 2 existing test fixtures updated with new Config field

**Key design decisions:**
- DD-1: `@langchain/openai` with `withStructuredOutput()` for LLM calls (mirrors Python exactly)
- DD-2: Model registry tier-derivation ported from Python `ModelRegistry.get_summarization_model()`
- DD-3: `X-Stigmer-Mcp-Server-Id` header passed for FGA-scoped proxy authorization

## Benefits

- Unified runner now handles 4 activities: ExecuteCursor, ExecuteDeepAgent, EnsureThread, ClassifyToolApprovals
- 376 tests passing (24 new), typecheck clean, lint clean
- Python agent-runner one step closer to decommission
- Economy-tier model selection available for future classification/summarization tasks

## Impact

- **Unified runner**: Now registers `ClassifyToolApprovals` activity
- **Connect workflow**: Can route to the TS runner once `DiscoverMcpServer` is also ported (next task)
- **Python agent-runner**: Still active until Phase 4 completes all supporting activities

## Related Work

- Phase 4 of unified-runner-migration project (20260518.01)
- Prior: EnsureThread ported (Session 9), Phase 3c HITL/approval gate (Session 8)
- Next: DiscoverMcpServer activity port

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes)
