# Task T01: Quick Wins — Error Dedup, InlinePublisher, Recursion Limit

**Created**: 2026-03-30
**Status**: COMPLETED
**Type**: Refactoring (pure structural, no behavioral changes)
**Depends on**: None (these are independent, safe extractions)
**Blocks**: T04 (SetupOrchestrator extraction — smaller function = easier extraction)

## Objective

Reduce `execute_graphton.py` by ~180 lines through three independent, low-risk extractions that each address a specific code smell. These are preparatory changes that make the big extraction (T04) safer and cleaner.

## Background

`execute_graphton.py` is a 2,184-line Temporal activity. After thorough analysis, we confirmed that the event handlers, streaming buffers, and checkpoint validation are NOT duplicating LangGraph — they are a necessary product-level projection layer. The simplification opportunities are structural.

This task targets three independent quick wins (S3, S4, S5 from the plan) that can each be a separate commit or combined into one PR.

## Task Breakdown

### S3: Error Handling Deduplication (~100 lines affected)

**Current state**: Two error handlers build nearly identical failed status:
- Outer (`execute_graphton`, lines 216-257): catches errors escaping `_execute_graphton_impl`
- Inner (`_execute_graphton_impl`, lines 2062-2159): catches errors during execution

Both build `AgentMessage` lists, call `execution_client.update_status`, and return `_slim_status_for_temporal`.

**Change**:
1. Extract a helper function at module level:
   ```python
   async def _build_and_persist_failed_status(
       *,
       exc: Exception,
       execution_id: str,
       status_builder: StatusBuilder | None,
       execution_client: AgentExecutionClient | None,
       retry_executor: GrpcRetryExecutor | None,
       logger: logging.Logger,
   ) -> AgentExecutionStatus:
   ```
2. Outer handler calls it with `status_builder=None, retry_executor=None`
3. Inner handler calls it with initialized instances
4. The helper handles both paths: with/without StatusBuilder, with/without retry

**What stays the same**: Two-level try/except structure (defense-in-depth), error semantics, gRPC update behavior.

**Files**: `execute_graphton.py` only.

### S4: InlinePublisher Extraction (~65 lines moved)

**Current state**: Lines 1493-1556 define `_publish_file_inline` as a 65-line closure capturing 6 variables: `workspace_backend`, `sandbox`, `artifact_storage`, `status_builder`, `execution_id`, `activity_logger`.

**Change**:
1. Create `worker/activities/graphton/inline_publisher.py`:
   ```python
   class InlinePublisher:
       def __init__(self, *, workspace_backend, sandbox, artifact_storage,
                    status_builder, execution_id, logger): ...
       async def publish(self, path: str) -> None: ...
   ```
2. Replace the closure in `execute_graphton.py` with:
   ```python
   inline_publisher = InlinePublisher(
       workspace_backend=workspace_backend, sandbox=sandbox,
       artifact_storage=artifact_storage, status_builder=status_builder,
       execution_id=execution_id, logger=activity_logger,
   )
   ```
3. Pass `inline_publisher.publish` to `StreamExecutor(on_file_written=...)`.

**What stays the same**: Publishing behavior, error handling (catch + log + swallow), path normalization logic.

**Files**: `execute_graphton.py` (shrinks), new `inline_publisher.py`.

### S5: Recursion Limit Simplification (~15 lines simplified)

**Current state**: Three layers set recursion limit:
1. `LANGGRAPH_DEFAULT_RECURSION_LIMIT=10000000` env var (Go daemon_process.go)
2. `create_deep_agent(recursion_limit=...)` at compile time
3. `config["recursion_limit"]` at invoke time (final authority)

Plus a magic number: `unlimited_recursion = 10_000_000`.

**Change**:
1. Add named constant: `_LANGGRAPH_UNLIMITED = 10_000_000`
2. Stop passing `recursion_limit` to `create_deep_agent()` (let graphton use its internal default, which is overridden by invoke config anyway)
3. Simplify the invoke-config logic:
   ```python
   effective_recursion_limit = recursion_limit if recursion_limit is not None else _LANGGRAPH_UNLIMITED
   config = {"configurable": {...}, "recursion_limit": effective_recursion_limit}
   ```
4. Remove the env var from `daemon_process.go` (separate PR in stigmer-cloud if cross-repo, or note for later)

**What stays the same**: Actual runtime behavior (invoke config was always the final authority).

**Files**: `execute_graphton.py` (in-place simplification). Go env var removal is a separate follow-up.

## Verification

- Run the full `test_status_builder.py` suite (282 tests)
- Run `test_execute_graphton.py` tests
- Run any integration tests that exercise the streaming path
- No behavioral changes expected — all tests should pass unchanged

## Success Criteria for T01

- [ ] Error handling deduplicated to single helper function
- [ ] InlinePublisher extracted to its own module with explicit dependencies
- [ ] Recursion limit simplified to single source of truth with named constant
- [ ] All existing tests pass unchanged
- [ ] `execute_graphton.py` net reduction: ~100-130 lines

## Next Task Preview

**T02: Research — LangGraph v2 tool_call_id on astream_events** (S6 from plan)
Research whether the current LangGraph version exposes `tool_call_id` on tool start/end events, determining whether `ToolCallIdCapture` can be simplified.

## Full Task Sequence

| Task | Description | Type | Depends On |
|------|-------------|------|------------|
| T01 | Quick wins: error dedup, InlinePublisher, recursion limit | Code | None |
| T02 | Research: LangGraph v2 tool_call_id availability | Research | None |
| T03 | Eliminate HITL bidirectional fallback | Code | T02 |
| T04 | Extract SetupOrchestrator with parallelization | Code | T01, T03 |

## Notes

- Each S-item (S3, S4, S5) can be done as a separate commit for clean git history
- S3 and S4 create new helper functions/classes but do not change any interfaces
- S5 is an in-place simplification that could be its own atomic commit
- The Go daemon_process.go env var removal (S5 follow-up) is a separate concern and should not block this task
