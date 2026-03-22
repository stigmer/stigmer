# Adding New Models to the Model Registry

This guide documents the process for adding new LLM models to Stigmer's Model Registry. The Model Registry is the single source of truth for all model metadata, including context windows, token counting methods, cost tiers, and summarization thresholds.

## Overview

When a new model is released by a provider (Anthropic, OpenAI, Ollama, etc.), it must be registered in the Model Registry before it can be used with context summarization and other model-aware features.

**File Location**: `backend/libs/python/graphton/src/graphton/core/model_registry.py`

## Required Information (9 Fields)

Every model registration requires the following 9 pieces of information:

### 1. `model_id` (string)

The canonical model identifier used for API calls.

**Examples:**
- `claude-sonnet-4.5` (Anthropic)
- `gpt-4o` (OpenAI)
- `qwen2.5-coder:7b` (Ollama)

**Rules:**
- Use the exact string expected by the provider's API
- Include version/variant suffixes as appropriate
- For Ollama, include the tag (e.g., `:7b`, `:14b`)

### 2. `provider` (string)

The provider/vendor name.

**Supported values:**
- `anthropic` - Anthropic Claude models
- `openai` - OpenAI GPT/o1 models
- `ollama` - Locally-run models via Ollama

### 3. `context_window_tokens` (int)

Total context window size in tokens. This is the maximum combined size of input + output.

**How to find:**
- Check provider documentation
- Look for "context length" or "context window" specs
- Anthropic: [Model Card](https://www.anthropic.com/claude)
- OpenAI: [Models](https://platform.openai.com/docs/models)
- Ollama: Check model's Hugging Face card or Ollama documentation

**Examples:**
| Model | Context Window |
|-------|---------------|
| Claude Sonnet 4.5 | 200,000 |
| GPT-4o | 128,000 |
| GPT-4 | 8,192 |
| Llama 3.2 3B | 128,000 |

### 4. `summarization_trigger_threshold` (int)

Token count at which context summarization is triggered. Typically ~90% of context window.

**Calculation:**
```
trigger_threshold = context_window_tokens * 0.90
```

**Examples:**
| Context Window | Trigger Threshold |
|---------------|------------------|
| 200,000 | 180,000 |
| 128,000 | 115,000 |
| 8,192 | 7,000 |

### 5. `summarization_target_tokens` (int)

Target token count after summarization. Typically ~80% of context window.

**Calculation:**
```
target_tokens = context_window_tokens * 0.80
```

**Examples:**
| Context Window | Target Tokens |
|---------------|---------------|
| 200,000 | 160,000 |
| 128,000 | 100,000 |
| 8,192 | 6,000 |

### 6. `token_counter_method` (TokenCounterMethod)

Strategy for counting tokens accurately for this model.

**Available methods:**

| Method | Use For | Implementation |
|--------|---------|----------------|
| `TIKTOKEN_CL100K` | GPT-4, GPT-3.5-turbo | tiktoken cl100k_base encoding |
| `TIKTOKEN_O200K` | GPT-4o, o1 family | tiktoken o200k_base encoding |
| `ANTHROPIC_NATIVE` | Claude models | Calibrated ~3.8 chars/token |
| `APPROXIMATE` | Ollama, unknown | Conservative ~4 chars/token |

**Selection Guide:**
- Anthropic models → `ANTHROPIC_NATIVE`
- OpenAI GPT-4/3.5 → `TIKTOKEN_CL100K`
- OpenAI GPT-4o/o1 → `TIKTOKEN_O200K`
- All others → `APPROXIMATE`

### 7. `cost_tier` (CostTier)

Economic classification for cost-aware operations.

**Tiers:**

| Tier | Description | Examples |
|------|-------------|----------|
| `ECONOMY` | Cheapest, used for summarization | Claude Haiku, GPT-4o-mini |
| `STANDARD` | Balanced cost/quality | Claude Sonnet, GPT-4o |
| `PREMIUM` | Highest quality, highest cost | Claude Opus, GPT-4, o1 |

**Importance:**
- Summarization uses ECONOMY tier models by default
- Cost reporting uses tiers for budgeting

### 8. `supports_tool_use` (bool)

Whether the model supports function/tool calling.

**Notes:**
- Most modern models support tools
- Some reasoning models (o1, o1-mini) have limited tool support
- Default to `True` unless known otherwise

### 9. `supports_vision` (bool)

Whether the model can process images.

**Notes:**
- Check provider documentation for multimodal support
- Default to `False` unless confirmed

## Additional Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `display_name` | str | model_id | Human-readable name for UI |
| `max_output_tokens` | int | 4096 | Maximum tokens in single response |
| `max_summary_tokens` | int | 2000 | Maximum tokens for summaries |
| `input_price_per_million` | float | None | USD per 1,000,000 input tokens |
| `output_price_per_million` | float | None | USD per 1,000,000 output tokens |
| `cache_creation_price_per_million` | float | None | USD per 1,000,000 cache-write tokens (see Cache Pricing Reference) |
| `cache_read_price_per_million` | float | None | USD per 1,000,000 cache-read tokens (see Cache Pricing Reference) |
| `supports_streaming` | bool | True | Whether streaming is supported |

## Step-by-Step Guide

### Step 1: Gather Information

Collect all 9 required fields from provider documentation:

```python
# Example for a new model
model_id = "claude-opus-5"
provider = "anthropic"
context_window_tokens = 250000
summarization_trigger_threshold = 225000  # 90%
summarization_target_tokens = 200000       # 80%
token_counter_method = TokenCounterMethod.ANTHROPIC_NATIVE
cost_tier = CostTier.PREMIUM
supports_tool_use = True
supports_vision = True
```

### Step 2: Add Entry to _MODELS

Open `backend/libs/python/graphton/src/graphton/core/model_registry.py` and add an entry:

```python
"claude-opus-5": ModelMetadata(
    model_id="claude-opus-5",
    provider="anthropic",
    display_name="Claude Opus 5",
    context_window_tokens=250000,
    max_output_tokens=8192,
    summarization_trigger_threshold=225000,
    summarization_target_tokens=200000,
    max_summary_tokens=2000,
    token_counter_method=TokenCounterMethod.ANTHROPIC_NATIVE,
    cost_tier=CostTier.PREMIUM,
    input_price_per_million=20.0,   # Update with actual pricing
    output_price_per_million=100.0,
    cache_creation_price_per_million=25.0,   # Anthropic: 1.25x input
    cache_read_price_per_million=2.0,        # Anthropic: 0.1x input
    supports_vision=True,
),
```

### Step 3: Update Default Summarization Model (If Needed)

If adding a new ECONOMY tier model that should be the default summarizer for a provider:

```python
_DEFAULT_SUMMARIZATION_MODELS: ClassVar[dict[str, str | None]] = {
    "anthropic": "claude-haiku-4",  # Update if new model is cheaper
    "openai": "gpt-4o-mini",
    "ollama": None,
}
```

### Step 4: Add Tests

Add test cases to `backend/libs/python/graphton/tests/core/test_model_registry.py`:

```python
def test_claude_opus_5_metadata():
    """Claude Opus 5 has correct metadata."""
    metadata = ModelRegistry.get("claude-opus-5")
    
    assert metadata.provider == "anthropic"
    assert metadata.context_window_tokens == 250000
    assert metadata.cost_tier == CostTier.PREMIUM
    assert metadata.supports_vision is True
```

### Step 5: Run Tests

```bash
cd backend/libs/python/graphton
poetry run pytest tests/core/test_model_registry.py -v
```

### Step 6: Create PR

Follow the PR checklist below.

## PR Checklist

When submitting a PR to add a new model, include the following:

```markdown
## New Model Registration: [model_id]

### Information Source
- [ ] Provider documentation link: [URL]
- [ ] Release announcement link (if applicable): [URL]

### Required Fields Verified
- [ ] `model_id` matches API identifier exactly
- [ ] `provider` is one of: anthropic, openai, ollama
- [ ] `context_window_tokens` verified from documentation
- [ ] `summarization_trigger_threshold` is ~90% of context
- [ ] `summarization_target_tokens` is ~80% of context
- [ ] `token_counter_method` is appropriate for provider
- [ ] `cost_tier` is appropriate (ECONOMY/STANDARD/PREMIUM)
- [ ] `supports_tool_use` verified
- [ ] `supports_vision` verified

### Testing
- [ ] Unit test added for new model
- [ ] All existing tests pass
- [ ] Manual verification with real API (if applicable)

### Optional Fields (if known)
- [ ] `input_price_per_million` documented
- [ ] `output_price_per_million` documented
- [ ] `cache_creation_price_per_million` documented (see Cache Pricing Reference)
- [ ] `cache_read_price_per_million` documented (see Cache Pricing Reference)
- [ ] `max_output_tokens` verified
```

## Common Mistakes to Avoid

1. **Wrong token counter method**: Using TIKTOKEN for non-OpenAI models
2. **Missing Ollama tag**: Using `qwen2.5-coder` instead of `qwen2.5-coder:7b`
3. **Incorrect threshold ratio**: Not using 90%/80% for trigger/target
4. **Wrong cost tier**: Marking economy models as standard/premium
5. **Forgetting vision support**: Many new models support vision
6. **Wrong pricing unit**: Pricing fields are per **million** tokens, not per thousand. Example: Claude Sonnet input = `3.0` means $3.00/MTok
7. **Missing cache pricing**: Paid models should include `cache_creation_price_per_million` and `cache_read_price_per_million` (see Cache Pricing Reference)

## Supported Models Reference

| Provider | Model | Context | Tier |
|----------|-------|---------|------|
| **Anthropic** |
| | claude-opus-4 | 200K | Premium |
| | claude-sonnet-4.5 | 200K | Standard |
| | claude-haiku-4 | 200K | Economy |
| **OpenAI** |
| | gpt-4 | 8K | Premium |
| | gpt-4-turbo | 128K | Standard |
| | gpt-4o | 128K | Standard |
| | gpt-4o-mini | 128K | Economy |
| | o1 | 200K | Premium |
| **Ollama** |
| | qwen2.5-coder:7b | 32K | Economy |
| | deepseek-coder-v2:16b | 128K | Economy |
| | llama3.2:3b | 128K | Economy |

See `model_registry.py` for the complete list.

## Cache Pricing Reference

Cache pricing fields enable accurate cost calculation when provider prompt caching is active.
All pricing values are in **USD per 1,000,000 tokens** (same unit as `input_price_per_million`).

### Anthropic (5-minute ephemeral TTL)

| Field | Multiplier | Example (Sonnet @ $3/MTok input) |
|-------|-----------|----------------------------------|
| `cache_creation_price_per_million` | 1.25x input | $3.75 |
| `cache_read_price_per_million` | 0.1x input | $0.30 |

Anthropic also offers a 1-hour cache TTL at 2.0x input, but the registry stores 5-minute
ephemeral pricing since that is the default `cache_control: {"type": "ephemeral"}` mode.

### OpenAI (automatic caching)

| Field | Multiplier | Example (GPT-4o @ $5/MTok input) |
|-------|-----------|----------------------------------|
| `cache_creation_price_per_million` | 1.0x input (no write premium) | $5.00 |
| `cache_read_price_per_million` | 0.5x input | $2.50 |

OpenAI caching is automatic for prompts >= 1024 tokens. No client-side opt-in needed.

### Ollama / Local Models

Set both cache fields to `None`. Local models have no provider caching or cost.

## Questions?

If you're unsure about any field values:

1. Check the provider's official documentation first
2. Look at similar existing models in the registry
3. When in doubt, use conservative defaults:
   - Smaller context window estimates
   - `APPROXIMATE` token counting
   - `ECONOMY` cost tier

Contact the platform team if you need help determining correct values.
