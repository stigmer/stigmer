# DD001: Three-Layer Memory Architecture

**Status**: DEFERRED (pending LangMem evaluation)
**Date**: 2026-01-31
**Author**: Architecture Team
**Updated**: 2026-01-31

---

## Update (2026-01-31)

After technology landscape analysis, we discovered that **LangMem** (by LangGraph team) provides a battle-tested `SummarizationNode` that may solve the core problem without custom development.

**Decision**: Evaluate LangMem first. This design is preserved as fallback if LangMem doesn't meet requirements.

**See**: `tasks/T01_0_plan.md` for revised integration-first approach.

---

## Original Context

Stigmer agents accumulate conversation history without bound. As conversations grow, they eventually exceed model context windows (8K-200K tokens depending on model), causing failures or degraded output quality.

We need a solution that:
1. Prevents context overflow failures
2. Preserves critical information from earlier conversation
3. Remains transparent about what happened
4. Adapts to different model capabilities

## Proposed Design (Deferred)

A **three-layer memory architecture** inspired by human cognitive models:

### Layer 1: Semantic Memory (Facts)
- Key-value pairs extracted from conversation
- Persists indefinitely unless explicitly invalidated
- Examples: database_type=PostgreSQL, user_timezone=PST
- ~10% of token budget

### Layer 2: Episodic Memory (Summaries)
- Compressed summaries of conversation segments
- Created when working memory needs trimming
- Includes key decisions, tool usage summaries
- ~20% of token budget

### Layer 3: Working Memory (Recent Turns)
- Verbatim recent messages
- Gets summarized when approaching limits
- Always preserves minimum N turns (e.g., 5)
- ~70% of token budget

## Why Deferred

LangMem's `SummarizationNode` provides:
- Single-summary approach (simpler than 3-layer)
- Running summaries (incremental updates)
- Native LangGraph integration
- Battle-tested by LangChain team

**If LangMem meets requirements**, the additional complexity of 3-layer architecture isn't justified.

**If LangMem doesn't meet requirements**, this design provides the blueprint for custom implementation.

## Evaluation Criteria

LangMem must satisfy:
1. **Quality**: Key facts preserved in summaries
2. **Performance**: <2s summarization latency
3. **Tool handling**: Tool calls summarized correctly
4. **Multi-cycle**: Running summaries don't degrade over time

If any criterion fails, revisit this design.

## Alternatives Considered

### Alternative 1: Simple Truncation (Keep Last N Messages)
**Rejected because:**
- Loses critical early context (setup, preferences, constraints)
- No semantic preservation
- "Amnesia" problem - agent forgets important facts

### Alternative 2: LangMem Integration (Current Choice)
**Selected because:**
- Minimal development effort
- Same ecosystem (LangGraph)
- Battle-tested

### Alternative 3: Mem0 Integration
**Deferred because:**
- Solves different problem (cross-session memory)
- Requires additional infrastructure (vector store)
- Can be added later if needed

## References

- LangMem documentation: https://langchain-ai.github.io/langmem/
- Mem0 documentation: https://docs.mem0.ai/
- Original design: (preserved in git history of T01_0_plan.md)
