# Fix Anthropic Haiku Model Registry Entry

**Date**: February 26, 2026

## Summary

The `GenerateSessionSubject` activity was silently failing because the model registry contained a non-existent model entry `claude-haiku-4` with API ID `claude-haiku-4-20250313`. Anthropic never released a "Haiku 4" — they went from Haiku 3.5 directly to Haiku 4.5. The registry entry has been corrected to `claude-haiku-4.5` with API ID `claude-haiku-4-5-20251001`.

## Problem Statement

The session subject generation activity was completing successfully in Temporal but never writing a subject to the database. The agent-runner logs revealed:

```
anthropic.NotFoundError: Error code: 404 - model: claude-haiku-4-20250313
```

The activity's broad `try/except` caught the exception, logged it, and returned normally — making the failure invisible from Temporal's perspective (activity showed as "Completed").

### Pain Points

- Session subjects never populated for any session, making the entire subject-in-header feature non-functional
- The 404 error was only visible in agent-runner logs, not in Temporal UI
- The model registry entry `claude-haiku-4` was incorrect from the start — Anthropic skipped from Haiku 3.5 to Haiku 4.5

## Solution

Updated the model registry entry from the non-existent `claude-haiku-4` to the correct `claude-haiku-4.5`, including the correct API model ID `claude-haiku-4-5-20251001` and updated specs (64K max output tokens).

## Implementation Details

- **`model_registry.py`** — Renamed entry key `claude-haiku-4` → `claude-haiku-4.5`, updated `api_model_id` to `claude-haiku-4-5-20251001`, corrected `max_output_tokens` from 8192 to 64000, updated `_DEFAULT_SUMMARIZATION_MODELS["anthropic"]` to `"claude-haiku-4.5"`, updated all docstring examples
- **`summarization_middleware.py`** — Docstring reference updated
- **`summarization_config.py`** — Docstring examples updated
- **`summarization_callback.py`** — Docstring examples updated

## Benefits

- `GenerateSessionSubject` activity will now successfully call the Anthropic API and write session subjects
- The session subject feature (TUI header, `list sessions`) becomes functional end-to-end
- Summarization features that rely on the economy model selection will also work correctly

## Impact

- **Session subject generation**: Unblocked — was completely broken for all Anthropic-provider deployments
- **Context summarization**: Also affected — any summarization that picked the economy model would have hit the same 404

## Related Work

- [Session Subject End-to-End Fix](2026-02-25-231744-session-subject-end-to-end.md) — the workflow wiring and CLI display changes that depend on this model fix

---

**Status**: ✅ Production Ready
