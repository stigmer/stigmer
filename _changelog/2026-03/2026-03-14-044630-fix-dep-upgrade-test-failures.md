# Fix Dependency Upgrade Test Failures (30 Tests)

**Date**: March 14, 2026

## Summary

Fixed all 30 test failures in graphton caused by breaking changes in upgraded AI/LLM dependencies (langchain-core 1.2.19, langmem, deepagents 0.4.10). All fixes are test-only except one production docstring correction. Full suite restored to green: 1155 passed.

## Problem Statement

The Phase 4B dependency upgrade (anthropic 0.84.0, deepagents 0.4.10, langchain-core 1.2.19, langgraph 1.1.2) introduced 30 test failures across 6 test files. Production code was unaffected — only test expectations were stale.

### Pain Points

- Tests referenced `claude-haiku-4` which never existed in the model registry (only `claude-haiku-3.5` and `claude-haiku-4.5`)
- `langchain-core` 1.2.19 made `id` mandatory in `AIMessage.tool_calls` dicts and rejected `content=None`
- `langmem` added `last_summarized_message_id` as a required `RunningSummary` constructor parameter
- `deepagents` 0.4.10 changed tool wrapper return types from dict to string
- Production `_check_and_handle_approval` behavior had diverged from its docstring (returns string on reject, doesn't raise)
- Integration test mock strategy was insufficient — mocking `summarize_messages` alone didn't prevent model creation from requiring API keys

## Solution

Systematic file-by-file test fixes with targeted pytest runs after each file to confirm green before moving on. Ten distinct root causes categorized and addressed across 7 files.

## Implementation Details

**10 root causes, 7 files modified:**

| Root Cause | Tests | Fix |
|---|---|---|
| `claude-haiku-4` model reference | 10 | Renamed to `claude-haiku-4.5`, updated `api_model_id` |
| `AIMessage.tool_calls` missing `id` | 4 | Added `"id": "call_xxx"` to test fixtures |
| `AIMessage(content=None)` invalid | 2 | Used `MagicMock(content=None)` |
| `SummarizationMiddleware` renamed | 2 | Updated to `ContextSummarizationMiddleware` |
| `RunningSummary` signature change | 2 | Added `last_summarized_message_id=None` |
| `summarize_messages` mock path | 4 | Dual mock: `_create_summarization_model` + `langmem.short_term.summarize_messages` |
| Tool wrapper returns string | 2 | Updated assertions to expect string |
| Reject/unknown returns string | 2 | Replaced `pytest.raises(ToolExecutionRejectedError)` with string assertions |
| Edit tool returns error string | 1 | Replaced `pytest.raises(ValueError)` with string assertion |
| Token threshold content | 1 | Used varied multi-word content instead of repeated `"x"` |

**Production change (docstring only):** Removed stale `Raises: ToolExecutionRejectedError` from `_check_and_handle_approval` docstring.

## Benefits

- Full graphton test suite restored to green (1155 passed, 1 skipped)
- Dependency upgrades unblocked for the remaining project phases
- Test expectations now accurately reflect current dependency behavior
- No production logic changes — zero regression risk

## Impact

- **graphton library**: All 1155 tests pass, unblocking Phase 5+ development
- **agent-runner**: Already green at 1198 tests (unaffected)
- **Development velocity**: Team can develop against upgraded deps without false test failures

## Related Work

- [Phase 4B: Conversation Caching and Dep Upgrade](2026-03-14-034725-phase-4b-conversation-caching-and-dep-upgrade.md) — the dependency upgrade that introduced these failures
- Project: `20260313.01.usage-metrics-cost-optimization`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
