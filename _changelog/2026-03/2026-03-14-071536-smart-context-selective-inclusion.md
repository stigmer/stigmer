# Smart Context / Selective Inclusion (Phase 9)

**Date**: March 14, 2026

## Summary

Implemented BM25-based skill relevance filtering, tool count observability with description truncation guardrails, and a 28% system prompt compression. This is the final phase of the usage-metrics-cost-optimization project, closing out all 9 planned phases.

## Problem Statement

As agents accumulate more skills and MCP tools, three costs grow:
- **Prompt noise**: 10+ skills in the "Available Skills" section degrade the model's decision quality, causing wasted tool calls to activate irrelevant skills
- **Tool payload bloat**: 30+ MCP tools with verbose descriptions increase API payload size and degrade model tool-selection accuracy (research shows degradation above ~20 tools)
- **Fixed prompt overhead**: ~1,500 words of resilience/recovery guidance repeated on every LLM call, with redundancies accumulated across earlier phases

### Pain Points

- No mechanism to filter skills by relevance to the user's actual task
- Zero observability into how many tools are bound per agent execution
- The `ResolvedExecutionContext.excluded_skill_names` proto field (added in Phase 1) was never populated
- System prompt sections contained verbose explanations and recovery strategies for edge cases already covered elsewhere

## Solution

Three targeted optimizations, each independently shippable:

1. **Skill relevance filtering** (BM25-style) — Score each skill's `name + description` against the user message using a term-frequency-based algorithm. Exclude low-relevance skills when an agent has 8+ skills, but always keep at least half (safety floor). Append an "Also Available" note so the agent can self-activate excluded skills if needed.

2. **Tool count observability** — Log a structured warning when bound tools exceed 25. Automatically truncate MCP tool descriptions exceeding 500 characters. Pure observability with zero behavioral change to existing agents.

3. **System prompt compression** — Audit and condense all fixed sections in `prompt_enhancement.py`. Merge redundant recovery strategies, remove edge cases covered by other sections, tighten verbose explanations into concise directives.

## Implementation Details

### Skill Relevance Filtering (9.1)

New module `skill_relevance.py`:
- `_tokenize()` — Splits text into lowercase tokens, strips punctuation, drops stop words and single characters, splits kebab-case
- `score_skills()` — BM25-inspired scoring: computes IDF across the skill corpus, scores each skill using `sum(idf * tf_saturated)` with k1=1.5 and b=0.75 for length normalization
- `filter_skills()` — Threshold-based partitioning with a safety floor: always includes at least half the skills regardless of score. Returns `SkillFilterResult` with included indices and excluded names

Wiring in `execute_graphton.py`:
- Filtering activates only when `len(skills) >= 8` (below this, all skills pass through)
- Excluded skill names are passed to `status_builder.set_resolved_context()` to populate the proto

New `generate_also_available_section()` in `skill_writer.py`:
- Produces a markdown note listing excluded skill names with self-activation instructions
- Empty string when no skills are excluded (zero noise for small agents)

### Tool Count Observability (9.2)

In `agent.py`, before `deepagents_create_deep_agent()`:
- Structured warning log when `total_tool_count > 25`
- Info log with total count for all executions
- Description truncation loop: caps any tool description over 500 chars with `...`

### System Prompt Compression (9.3)

In `prompt_enhancement.py`:
- `RESILIENCE_PREAMBLE`: Condensed "Core Principles" explanations and merged "Never Do This" into concise directives
- `FILE_RECOVERY_STRATEGIES`: Removed "Edit Conflicts / Merge Issues" (not applicable to `edit` tool mechanism) and "Large File Issues" (covered by `FILESYSTEM_CAPABILITY`)
- `MCP_RECOVERY_STRATEGIES` and `EXECUTION_RECOVERY_STRATEGIES`: Condensed bullet points

**Before: 1,530 words. After: 1,107 words. Reduction: 28%. All 35 existing tests pass unchanged.**

## Benefits

- **Signal quality**: Agents with 10+ skills see only relevant ones, reducing wasted tool calls
- **Observability**: Operators get early warning when tool counts enter degradation territory
- **Cost reduction**: 28% fewer fixed prompt tokens on every LLM call (significant for Ollama/local models without caching; marginal for cloud models with prompt caching after first call)
- **Proto completeness**: `excluded_skill_names` field is now populated, enabling future analytics

## Impact

- **Agent execution quality**: Improved skill selection for agents with many skills
- **Operator experience**: New structured log warnings surface misconfiguration early
- **Cost**: Measurable reduction in system prompt token overhead
- **Zero breaking changes**: All filtering is additive with conservative defaults; agents with fewer than 8 skills see no change

## Related Work

- **Phase 1**: Defined `ResolvedExecutionContext.excluded_skill_names` proto field — now populated
- **Phase 4B**: Automatic conversation caching — prompt compression compounds with caching for first-call cost
- **Phase 8**: Diff-based output optimization — editing efficiency guidance was preserved during prompt compression

---

**Status**: Production Ready
**Timeline**: ~3 hours (1 session)
