# Fix Cursor Harness Follow-Up Messages and Session Subject Generation

**Date**: May 2, 2026

## Summary

Fixed two critical bugs in the Cursor harness that prevented follow-up messages from executing and session subjects from being generated. The follow-up bug was caused by `Agent.resume()` not receiving the `model` parameter (required by the Cursor SDK for local agents). The subject bug was caused by `model-registry.json` not being locatable in embedded runtimes, causing the summarization model to fall back to the raw display name which Anthropic's API rejects.

## Problem Statement

Since the Cursor harness was introduced, no session has ever had more than one execution (follow-ups never worked), and all sessions showed "Auto-created session" instead of LLM-generated titles.

### Pain Points

- Every follow-up message on a Cursor harness session silently failed at the cursor-runner level
- All 19 Cursor harness sessions in production had exactly 1 execution
- Session subjects were permanently stuck at "Auto-created session" in the sidebar
- The model-registry.json was placed at `app/model-registry.json` but the Python code looked in the graphton package data directory, which didn't have it in embedded runtimes

## Solution

**Follow-up fix**: Added `model` to `ResumeAgentOptions` and forwarded it from `resolveAgent`'s `createOptions.model` to `Agent.resume()`. The Cursor SDK requires `model: { id }` on resume for local agents — without it, `agent.send()` throws `ConfigurationError`.

**Subject fix**: Added a `_load_registry_text()` method to `ModelRegistry` with a 3-source fallback: (1) package data via `importlib.resources`, (2) `STIGMER_MODEL_REGISTRY_PATH` env var, (3) filesystem ancestor walk that finds `model-registry.json` in sibling `app/` directories. This ensures the registry loads regardless of installation method.

## Implementation Details

**cursor-runner fix** (`session-lifecycle.ts`):
- Added `model?: string` to `ResumeAgentOptions`
- Pass `model: options.model ? { id: options.model } : undefined` to `Agent.resume()`
- Forward `createOptions.model` in `resolveAgent`'s resume path

**graphton fix** (`model_registry.py`):
- Extracted `_load_registry_text()` classmethod with ordered fallback
- Primary: `importlib.resources.files("graphton.data")` (standard pip installs)
- Secondary: `STIGMER_MODEL_REGISTRY_PATH` env var (explicit override)
- Tertiary: Walk up from module `__file__` checking ancestors and `app/` siblings

**Tests written**:
- Integration test proving `Agent.resume` without model throws, with model succeeds (5 tests, real Cursor API key)
- Regression test proving empty registry causes wrong summarization model selection (3 tests)
- React hook lifecycle test proving the UI follow-up flow works correctly (1 test)

## Benefits

- Cursor harness follow-up messages will now work end-to-end
- Session subjects will be generated using the correct economy-tier model (claude-haiku-4.5)
- Comprehensive test coverage prevents regression
- The model registry fallback makes the system resilient to packaging variations

## Impact

- **Users**: Follow-up conversations in Cursor harness sessions will now function. Sessions will display meaningful auto-generated titles.
- **Architecture**: The `ResumeAgentOptions` interface now mirrors `CreateAgentOptions` in carrying model information, making the API symmetrical.
- **Resilience**: The model registry can now load from multiple sources, preventing silent failures in embedded/packaged runtimes.

## Related Work

- [Cursor harness session subject generation](2026-05-02-104611-fix-cursor-harness-session-subject.md) — earlier fix that added the `GenerateSessionSubject` call to the Cursor workflow
- [Unified model registry](2026-05-01-183214-unified-model-registry.md) — established the shared JSON registry
- [Cursor harness project](../_projects/2026-04/20260430.01.cursor-harness/) — parent feature

---

**Status**: Production Ready
**Timeline**: Investigation + fix completed in single session (test-driven)
