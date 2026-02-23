# Add Claude Opus 4.5, Opus 4.6, Sonnet 4.6 and Fix Stale Model Metadata

**Date**: February 24, 2026

## Summary

Added three new Anthropic Claude models (Opus 4.5, Opus 4.6, Sonnet 4.6) to the model registry and corrected stale `max_output_tokens` values on two existing entries. All values verified against Anthropic's official documentation as of February 2026. The Anthropic section was also reordered by generation for maintainability.

## Problem Statement

The model registry was missing the latest Claude models, and existing entries had incorrect `max_output_tokens` values that didn't match Anthropic's actual API limits.

### Pain Points

- `claude-opus-4.6` was already referenced in `02_draft_agent_creator.sh` but had no registry entry, causing resolution to fall through to conservative 8K defaults
- `claude-opus-4` was registered with `max_output_tokens=8192` when the actual API limit is 32K
- `claude-sonnet-4.5` was registered with `max_output_tokens=8192` when the actual API limit is 64K
- The Anthropic section had no logical ordering, making it harder to locate entries

## Solution

Single-file update to `model_registry.py` — the platform's single source of truth for model metadata. Added three new entries, fixed two existing entries, and reordered the Anthropic section by generation (4.6 > 4.5 > 4 > 3.5) with tier ordering (Opus > Sonnet > Haiku) within each generation.

## Implementation Details

### New Models Added

| model_id | api_model_id | max_output | cost_tier | pricing (per 1M) |
|---|---|---|---|---|
| `claude-opus-4.6` | `claude-opus-4-6` | 128K | PREMIUM | $5 / $25 |
| `claude-sonnet-4.6` | `claude-sonnet-4-6` | 64K | STANDARD | $3 / $15 |
| `claude-opus-4.5` | `claude-opus-4-5-20251101` | 64K | PREMIUM | $5 / $25 |

### Existing Models Fixed

| model_id | field | old | new |
|---|---|---|---|
| `claude-opus-4` | `max_output_tokens` | 8192 | 32768 |
| `claude-sonnet-4.5` | `max_output_tokens` | 8192 | 65536 |

### Design Decisions

- **Context window registered at 200K standard**: Opus 4.6 and Sonnet 4.6 support 1M context via beta header (`context-1m-2025-08-07`), but registering 1M without the platform sending the header would cause summarization to never trigger and API errors at 200K. The 1M upgrade is a coordinated platform change for later.
- **No date suffix on 4.6 API model IDs**: Anthropic changed their convention for the 4.6 generation — `claude-opus-4-6` and `claude-sonnet-4-6` are the official API identifiers (no date suffix).
- **Haiku 4 left at 8192**: Confirmed that pre-4.5 Haiku models had ~8K max output, so the existing value is correct.

## Benefits

- Agents can now be configured to use the latest Claude models with correct metadata
- Summarization and context management work correctly with accurate `max_output_tokens` values
- The `02_draft_agent_creator.sh` reference to `claude-opus-4-6` now resolves through the registry
- Consistent ordering makes the registry easier to maintain as new models are added

## Impact

- **Model Registry**: 3 new entries, 2 corrected entries, section reordered (total: 22 models)
- **Agent Runner**: Agents using Opus 4 or Sonnet 4.5 now get correct output limits instead of the artificially low 8K cap
- **Seedpack**: The skill-creator agent's model reference (`claude-opus-4-6`) is now registry-backed

## Related Work

- Think tool for structured agent reasoning (2026-02-24)
- Model name resolution centralization (2026-02-13)

---

**Status**: ✅ Production Ready
