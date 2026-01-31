# LangMem Evaluation Report

**Task**: T02 - LangMem Evaluation  
**Status**: Complete (Unit Tests)  
**Date**: 2026-01-31

---

## Executive Summary

LangMem's `SummarizationNode` and `summarize_messages()` function have been evaluated for integration into Stigmer's agent execution pipeline. A comprehensive evaluation suite has been implemented with 33 tests covering quality, performance, tool handling, and multi-cycle stability.

**Preliminary Recommendation**: **CONDITIONAL GO**

The evaluation infrastructure is production-ready. Unit tests validate:
- Conversation fixtures with 50+ messages each
- Model Registry integration for threshold configuration
- Report generation and decision logic
- Latency measurement framework

LLM-dependent tests require `OPENAI_API_KEY` for final validation.

---

## Evaluation Suite Implementation

### Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `backend/services/agent-runner/tests/fixtures/__init__.py` | 20 | Fixture module exports |
| `backend/services/agent-runner/tests/fixtures/conversations.py` | 715 | 4 conversation scenarios |
| `backend/services/agent-runner/tests/langmem_evaluation.py` | 960 | 33 evaluation tests |

### Files Modified

| File | Change |
|------|--------|
| `backend/services/agent-runner/pyproject.toml` | Added `langmem = ">=0.0.30"` |
| `backend/services/agent-runner/poetry.lock` | Updated with langmem dependencies |

---

## Test Results

### Unit Tests (No LLM Required)

```
======================== 25 passed, 8 skipped in 0.80s =========================
```

| Test Class | Tests | Status |
|------------|-------|--------|
| TestConversationFixtures | 11 | 11 PASSED |
| TestSummarizationQuality (unit) | 2 | 2 PASSED |
| TestToolCallHandling (unit) | 1 | 1 PASSED |
| TestMultiCycleSummarization (unit) | 1 | 1 PASSED |
| TestPerformanceBenchmarks (unit) | 2 | 2 PASSED |
| TestModelRegistryIntegration | 4 | 4 PASSED |
| TestEvaluationReport | 4 | 4 PASSED |

### LLM Tests (Require OPENAI_API_KEY)

| Test | Status |
|------|--------|
| test_database_conversation_fact_retention | SKIPPED |
| test_api_conversation_fact_retention | SKIPPED |
| test_infrastructure_conversation_fact_retention | SKIPPED |
| test_tool_names_preserved_in_summary | SKIPPED |
| test_tool_results_context_preserved | SKIPPED |
| test_four_cycle_stability | SKIPPED |
| test_summarization_latency_p95 | SKIPPED |
| test_full_evaluation_suite | SKIPPED |

---

## Conversation Fixtures

### 1. Database Configuration (67 messages)
- **Facts**: 10 critical facts (host, port, SSL, pooling, timeouts)
- **Scenario**: PostgreSQL setup with SSL and connection pooling
- **Key Facts**: `db.prod.example.com`, `verify-full`, `pool_size=20`

### 2. API Integration (59 messages)
- **Facts**: 10 critical facts (OAuth2, rate limits, tokens)
- **Scenario**: OAuth2 setup with PKCE and rate limiting
- **Key Facts**: `client_id=abc123xyz789`, `1000/hour`, `/oauth/token`

### 3. Infrastructure Setup (57 messages)
- **Facts**: 10 critical facts (K8s resources, health checks)
- **Scenario**: Kubernetes deployment configuration
- **Key Facts**: `namespace=production`, `replicas=3`, `memory_limit=2Gi`

### 4. Tool-Heavy Troubleshooting (55 messages)
- **Tool Calls**: 14 tool calls with matching results
- **Tools Used**: `execute_sql`, `check_connection`, `list_tables`
- **Key Facts**: `PostgreSQL 15.4`, `rows_affected=42`, `query_time_ms=156`

---

## Model Registry Integration

The evaluation suite successfully integrates with the Model Registry created in Task 1:

```python
# Verified working integrations
ModelRegistry.get("gpt-4o-mini")  # Returns correct metadata
ModelRegistry.get_summarization_model("claude-sonnet-4.5")  # Returns economy model
ModelRegistry.get_or_default("unknown-model", "unknown")  # Returns safe defaults
```

### Configuration Mapping

| Registry Field | LangMem Parameter |
|----------------|-------------------|
| `summarization_target_tokens` | `max_tokens` |
| `summarization_trigger_threshold` | `max_tokens_before_summary` |
| `max_summary_tokens` | `max_summary_tokens` |

---

## Decision Criteria

| Criterion | Target | Validation Method | Status |
|-----------|--------|-------------------|--------|
| Key Fact Retention | >90% | `test_*_fact_retention` | Ready |
| Summarization Latency | <2s p95 | `test_summarization_latency_p95` | Ready |
| Tool Call Handling | Preserved | `test_tool_*_preserved` | Ready |
| Multi-Cycle Stability | <5% degradation/cycle | `test_four_cycle_stability` | Ready |

---

## LangMem API Findings

### Verified Capabilities

1. **SummarizationNode**: Works as a LangGraph node
2. **summarize_messages()**: Functional primitive for direct use
3. **RunningSummary**: Tracks summarized message IDs correctly
4. **Token Counting**: Supports custom token counters

### Potential Concerns

1. **Message IDs Required**: LangMem requires all messages to have an `id` field
2. **Running Summary Merge Issue**: Known issue (#118) with summary merging when `max_tokens` changes
3. **System Messages**: Excluded from summarization (correct behavior)

### Integration Notes

```python
# Messages must have IDs for LangMem
HumanMessage(content="Hello", id="msg_001")  # Required
HumanMessage(content="Hello")  # Will raise ValueError
```

---

## Next Steps

### To Complete Full Evaluation

1. Set `OPENAI_API_KEY` environment variable
2. Run full test suite:
   ```bash
   cd backend/services/agent-runner
   poetry run pytest tests/langmem_evaluation.py -v --tb=short
   ```
3. Review output from `test_full_evaluation_suite` for comprehensive report

### Expected Outcome

If all LLM tests pass:
- **Recommendation**: **GO** - Proceed to Phase 2 integration
- **Action**: Integrate `SummarizationNode` into Graphton agent graph

If any LLM test fails:
- **Recommendation**: **CONDITIONAL** - Evaluate specific failure
- **Options**:
  1. Custom prompts via `initial_summary_prompt` parameter
  2. Fallback to DD001 three-layer architecture

---

## Conclusion

The LangMem evaluation infrastructure is complete and production-ready. The suite covers:

- **Quality**: 3 conversation scenarios with 30 critical facts
- **Performance**: Latency benchmarking with p50/p95/p99 metrics
- **Tool Handling**: Tool call preservation validation
- **Multi-Cycle**: Running summary stability testing
- **Integration**: Model Registry threshold configuration

**Final recommendation pending LLM test execution.**

---

## Appendix: Running the Evaluation

```bash
# Full evaluation (requires OPENAI_API_KEY)
export OPENAI_API_KEY="sk-..."
cd backend/services/agent-runner
poetry run pytest tests/langmem_evaluation.py -v

# Unit tests only (no API key needed)
poetry run pytest tests/langmem_evaluation.py -v -m "not requires_llm"

# Single test
poetry run pytest tests/langmem_evaluation.py::test_full_evaluation_suite -v
```
