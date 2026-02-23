---
name: Add Claude models to registry
overview: Add Claude Opus 4.5, Opus 4.6, and Sonnet 4.6 to the model registry, update existing entries (including Sonnet 4.5) to use correct max_output_tokens from Anthropic's current documentation, and maintain consistent ordering.
todos:
  - id: fix-existing-opus4
    content: Update claude-opus-4 max_output_tokens from 8192 to 32768
    status: completed
  - id: fix-existing-sonnet45
    content: Update claude-sonnet-4.5 max_output_tokens from 8192 to 65536
    status: completed
  - id: add-opus45
    content: Add claude-opus-4.5 entry with api_model_id claude-opus-4-5-20251101, 64K max output, PREMIUM tier, $5/$25 pricing
    status: completed
  - id: add-opus46
    content: Add claude-opus-4.6 entry with api_model_id claude-opus-4-6, 128K max output, PREMIUM tier, $5/$25 pricing
    status: completed
  - id: add-sonnet46
    content: Add claude-sonnet-4.6 entry with api_model_id claude-sonnet-4-6, 64K max output, STANDARD tier, $3/$15 pricing
    status: completed
  - id: reorder-anthropic
    content: "Reorder Anthropic models section: newest generation first, Opus > Sonnet > Haiku within generation"
    status: completed
  - id: update-docstring-count
    content: Update list_all() docstring example total from 19 to 22
    status: completed
  - id: verify-haiku4
    content: Verify claude-haiku-4 max_output_tokens - flag to user if actual limit differs from 8192
    status: completed
isProject: false
---

# Add New Claude Models and Fix Existing Entries in Model Registry

## File to modify

`[backend/libs/python/graphton/src/graphton/core/model_registry.py](backend/libs/python/graphton/src/graphton/core/model_registry.py)`

## Context

The model registry is the single source of truth for all LLM model metadata. We need to add 3 new Anthropic models and correct stale `max_output_tokens` values on 2 existing entries, verified against [Anthropic's official docs](https://docs.anthropic.com/en/docs/about-claude/models/all-models) as of February 2026.

## What changes and why

### 1. Fix stale `max_output_tokens` on existing Anthropic models

The current registry has `max_output_tokens=8192` for all Anthropic models. Per Anthropic's documentation:


| model_id            | Current (wrong) | Correct         | Source                                 |
| ------------------- | --------------- | --------------- | -------------------------------------- |
| `claude-opus-4`     | 8192            | **32768** (32K) | Anthropic docs "still available" table |
| `claude-sonnet-4.5` | 8192            | **65536** (64K) | Anthropic docs "still available" table |


Models `claude-haiku-4`, `claude-sonnet-3.5`, and `claude-haiku-3.5` are older and their 8192 values appear to be correct for their generation. `claude-haiku-4` is NOT listed on the current Anthropic docs page (superseded by Haiku 4.5), so I will flag it during implementation if I cannot confirm its actual limit rather than guessing.

### 2. Add 3 new model entries

All values sourced from Anthropic's official documentation (fetched and verified):

**Claude Opus 4.5** (released Nov 24, 2025):

- `model_id`: `"claude-opus-4.5"`
- `api_model_id`: `"claude-opus-4-5-20251101"`
- `context_window_tokens`: 200000
- `max_output_tokens`: 65536 (64K)
- `cost_tier`: PREMIUM
- `input_cost_per_1k`: 5.0 / `output_cost_per_1k`: 25.0
- `supports_vision`: True

**Claude Opus 4.6** (released Feb 5, 2026):

- `model_id`: `"claude-opus-4.6"`
- `api_model_id`: `"claude-opus-4-6"` (no date suffix; Anthropic changed the convention for 4.6 models)
- `context_window_tokens`: 200000 (standard; 1M beta NOT registered - see rationale in discussion)
- `max_output_tokens`: 131072 (128K)
- `cost_tier`: PREMIUM
- `input_cost_per_1k`: 5.0 / `output_cost_per_1k`: 25.0
- `supports_vision`: True

**Claude Sonnet 4.6** (released Feb 17, 2026):

- `model_id`: `"claude-sonnet-4.6"`
- `api_model_id`: `"claude-sonnet-4-6"` (no date suffix)
- `context_window_tokens`: 200000 (standard; 1M beta NOT registered)
- `max_output_tokens`: 65536 (64K)
- `cost_tier`: STANDARD
- `input_cost_per_1k`: 3.0 / `output_cost_per_1k`: 15.0
- `supports_vision`: True

All three share with existing Anthropic entries:

- `token_counter_method`: `ANTHROPIC_NATIVE`
- `summarization_trigger_threshold`: 180000 (~90% of 200K)
- `summarization_target_tokens`: 160000 (~80% of 200K)
- `max_summary_tokens`: 2000
- `supports_streaming`: True (default)
- `supports_tool_use`: True (default)

### 3. Reorder Anthropic section for consistency

Current order is ad-hoc. Reorder to: newest generation first, within a generation ordered by tier (Opus > Sonnet > Haiku). This matches how the Anthropic docs organize models and makes it easy to find entries:

1. `claude-opus-4.6` (NEW)
2. `claude-sonnet-4.6` (NEW)
3. `claude-opus-4.5` (NEW)
4. `claude-sonnet-4.5` (UPDATED)
5. `claude-opus-4` (UPDATED)
6. `claude-haiku-4`
7. `claude-sonnet-3.5`
8. `claude-haiku-3.5`

### 4. Update docstring example count

`list_all()` docstring (line 838) says "Total models: 19". After adding 3, update to 22.

## What we are NOT changing (and why)

- `**_DEFAULT_SUMMARIZATION_MODELS`**: Still maps `anthropic` -> `claude-haiku-4`. While Haiku 4.5 exists, it's not in the registry, and the user didn't request adding it. Haiku 4 remains a valid economy-tier option.
- **1M context window**: Not registering. Requires beta header, tiered pricing, and platform-level API changes. Clean upgrade path when ready.
- **Models the user didn't ask for**: Opus 4.1, Sonnet 4, Haiku 4.5 are all on Anthropic's docs but out of scope.
- **Non-Anthropic models**: No changes to OpenAI or Ollama entries.

## Existing reference that validates this change

`02_draft_agent_creator.sh` already references `claude-opus-4-6` (line 71, 104) but it's not yet in the registry. This addition closes that gap.