# Improve Sub-Agent Subject Differentiation and Concurrency Cap

**Date**: March 12, 2026

## Summary

Sub-agent executions in the CLI displayed identical subjects (e.g., "Research Cloud Resource protobuf definitions" repeated 15 times) even though their underlying tasks were different. Additionally, the main agent could spawn an unbounded number of sub-agents concurrently. This change fixes both issues: subjects are now context-aware and deduplicated, and the system prompt caps concurrent sub-agents at 4.

## Problem Statement

When the main agent spawns multiple sub-agents for related exploration tasks, the economy-tier LLM that generates subject titles (`_generate_sub_agent_subject`) independently reduces each task's full prompt to a generic 3-7 word title. Because the tasks share a common domain, the titles converge to identical strings.

### Pain Points

- Users see 15+ sub-agent entries with the same name and cannot tell which is doing what
- No concurrency limit allows the agent to over-parallelize, spawning far more sub-agents than necessary
- The subject generator has no awareness of previously assigned titles

## Solution

Three-layer fix:

1. **Context-aware subject generation** — the subject generator now receives a list of already-assigned subjects and is instructed not to duplicate them
2. **Deterministic deduplication fallback** — if the LLM still produces a duplicate, a numeric suffix `(2)`, `(3)` etc. is appended
3. **System prompt concurrency cap** — the agent is instructed to spawn no more than 4 sub-agents concurrently

## Implementation Details

### Subject generation (`status_builder.py`)

- `_generate_sub_agent_subject()` gains an `existing_subjects` parameter
- The system prompt now includes: "The title MUST be unique — it must NOT duplicate any of the existing titles listed below"
- Existing titles are injected into the user prompt as "Existing titles (do NOT repeat these)"
- The prompt also discourages filler verbs like "research" and "explore", and encourages leading with the differentiator (directory, module, file)

### Deduplication fallback (`status_builder.py`)

- `StatusBuilder` tracks assigned subjects in `_subject_counts: dict[str, int]`
- On collision, appends ` (2)`, ` (3)` etc., truncating the base to respect `_MAX_SUBJECT_LENGTH`
- First occurrence is never modified

### Concurrency cap (`execute_graphton.py`)

- Added "Concurrency limit" section: max 4 concurrent sub-agents, batch if more needed
- Added "When NOT to delegate" rules: single-step lookups and file reads should use tools directly
- Restructured into subsections: Concurrency limit, When NOT to delegate, Delegation best practices

### Tests (`test_status_builder.py`)

- 6 test cases in `TestSubAgentSubjectDeduplication`:
  - First subject unchanged
  - Duplicate gets `(2)` suffix
  - Triple duplicate increments to `(3)`
  - Different subjects are not affected
  - Long subjects truncated to fit suffix within max length
  - Empty subjects skip deduplication

## Benefits

- Users can now distinguish between concurrent sub-agents at a glance
- Reduced visual noise from excessive sub-agent spawning (capped at 4)
- The fix is layered: LLM-level differentiation as primary, deterministic suffix as safety net
- Zero cost increase — the existing economy-tier LLM call just receives slightly more context

## Impact

- **CLI users**: Clearer sub-agent display with unique titles
- **Agent behavior**: More disciplined sub-agent spawning (max 4 concurrent)
- **Backend**: Backward-compatible — `existing_subjects` defaults to `None`

## Related Work

- Sub-agent visibility (Phase 2.3) — namespace-based event routing
- `2026-03-12-051220-propagate-summarization-middleware-to-sub-agents.md` — sub-agent context management

---

**Status**: ✅ Production Ready
