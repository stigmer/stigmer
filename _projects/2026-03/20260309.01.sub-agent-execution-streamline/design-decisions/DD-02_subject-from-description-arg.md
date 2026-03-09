# DD-02: `subject` Populated from Task Tool `description` Arg, Not LLM

**Date**: 2026-03-09
**Status**: ACCEPTED

## Decision

The `subject` field on `SubAgentExecution` must be populated directly from `tool_args.get("description", "")` — the short label the invoking LLM already provided. The `_generate_sub_agent_subject()` function and its economy-tier LLM call are deleted.

## Rationale

- The task tool's `description` arg is already a concise label (3-10 words like "Explore CLI rendering code") — the invoking LLM chose this as its own summary
- `_generate_sub_agent_subject()` takes the full prompt, sends it to another LLM, producing a redundant summary of what the invoking LLM already summarized
- Adds latency (LLM round-trip), cost (economy model tokens), and non-determinism for zero value
- The LLM-generated subject is capped at 50 chars but is not necessarily better than the original `description`

## Runner Changes (PR2)

- In `_handle_sub_agent_start` (status_builder.py): set `subject = tool_args.get("description", "")` directly
- Delete `_generate_sub_agent_subject()` function and all supporting code (`_SUBJECT_SYSTEM_PROMPT`, `_MAX_SUBJECT_LENGTH`, the economy model instantiation)
- Stop putting description into metadata `Struct` — it lives on `subject` now
