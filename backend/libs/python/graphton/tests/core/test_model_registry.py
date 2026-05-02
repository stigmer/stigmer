"""Unit tests for the Model Registry.

Tests cover:
- CostTier and TokenCounterMethod enums
- ModelMetadata frozen dataclass immutability
- ModelRegistry.get() for known and unknown models
- ModelRegistry.get_or_default() fallback behavior
- ModelRegistry.get_summarization_model() provider-aware selection
- ModelRegistry.list_by_provider() filtering
- ModelRegistry.list_all() enumeration
- ModelRegistry.is_registered() checking
- ModelRegistry.list_providers() enumeration
- ModelRegistry.get_economy_models() filtering
"""

from dataclasses import FrozenInstanceError

import pytest

from graphton.core.model_registry import (
    CostTier,
    ModelMetadata,
    ModelRegistry,
    TokenCounterMethod,
)

# =============================================================================
# TestCostTierEnum - Tests for CostTier enumeration
# =============================================================================


class TestCostTierEnum:
    """Tests for CostTier enum values and behavior."""

    def test_economy_tier_exists(self):
        """Test that ECONOMY tier exists with correct value."""
        assert CostTier.ECONOMY.value == "economy"

    def test_standard_tier_exists(self):
        """Test that STANDARD tier exists with correct value."""
        assert CostTier.STANDARD.value == "standard"

    def test_premium_tier_exists(self):
        """Test that PREMIUM tier exists with correct value."""
        assert CostTier.PREMIUM.value == "premium"

    def test_all_tiers_unique(self):
        """Test that all tier values are unique."""
        values = [tier.value for tier in CostTier]
        assert len(values) == len(set(values))
        assert len(values) == 3

    def test_tier_comparison(self):
        """Test that tiers can be compared for equality."""
        assert CostTier.ECONOMY == CostTier.ECONOMY
        assert CostTier.ECONOMY != CostTier.PREMIUM


# =============================================================================
# TestTokenCounterMethodEnum - Tests for TokenCounterMethod enumeration
# =============================================================================


class TestTokenCounterMethodEnum:
    """Tests for TokenCounterMethod enum values and behavior."""

    def test_tiktoken_cl100k_exists(self):
        """Test that TIKTOKEN_CL100K method exists."""
        assert TokenCounterMethod.TIKTOKEN_CL100K.value == "tiktoken_cl100k"

    def test_tiktoken_o200k_exists(self):
        """Test that TIKTOKEN_O200K method exists."""
        assert TokenCounterMethod.TIKTOKEN_O200K.value == "tiktoken_o200k"

    def test_anthropic_native_exists(self):
        """Test that ANTHROPIC_NATIVE method exists."""
        assert TokenCounterMethod.ANTHROPIC_NATIVE.value == "anthropic_native"

    def test_approximate_exists(self):
        """Test that APPROXIMATE method exists."""
        assert TokenCounterMethod.APPROXIMATE.value == "approximate"

    def test_all_methods_unique(self):
        """Test that all method values are unique."""
        values = [method.value for method in TokenCounterMethod]
        assert len(values) == len(set(values))
        assert len(values) == 4


# =============================================================================
# TestModelMetadataImmutability - Tests for frozen dataclass
# =============================================================================


class TestModelMetadataImmutability:
    """Tests for ModelMetadata frozen dataclass immutability."""

    @pytest.fixture
    def sample_metadata(self):
        """Create a sample ModelMetadata instance."""
        return ModelMetadata(
            model_id="test-model",
            provider="test",
            display_name="Test Model",
            context_window_tokens=8192,
            max_output_tokens=4096,
            summarization_trigger_threshold=7000,
            summarization_target_tokens=6000,
            max_summary_tokens=500,
            token_counter_method=TokenCounterMethod.APPROXIMATE,
            cost_tier=CostTier.ECONOMY,
        )

    def test_cannot_modify_model_id(self, sample_metadata):
        """Test that model_id cannot be modified after creation."""
        with pytest.raises(FrozenInstanceError):
            sample_metadata.model_id = "modified"

    def test_cannot_modify_context_window(self, sample_metadata):
        """Test that context_window_tokens cannot be modified."""
        with pytest.raises(FrozenInstanceError):
            sample_metadata.context_window_tokens = 999999

    def test_cannot_modify_cost_tier(self, sample_metadata):
        """Test that cost_tier cannot be modified."""
        with pytest.raises(FrozenInstanceError):
            sample_metadata.cost_tier = CostTier.PREMIUM

    def test_metadata_is_hashable(self, sample_metadata):
        """Test that frozen metadata can be used in sets/dicts."""
        # Should not raise - frozen dataclasses are hashable
        metadata_set = {sample_metadata}
        assert len(metadata_set) == 1

    def test_default_values_applied(self):
        """Test that default values are applied correctly."""
        metadata = ModelMetadata(
            model_id="test",
            provider="test",
            display_name="Test",
            context_window_tokens=8192,
            max_output_tokens=4096,
            summarization_trigger_threshold=7000,
            summarization_target_tokens=6000,
            max_summary_tokens=500,
            token_counter_method=TokenCounterMethod.APPROXIMATE,
            cost_tier=CostTier.ECONOMY,
        )
        # Check defaults
        assert metadata.input_price_per_million is None
        assert metadata.output_price_per_million is None
        assert metadata.cache_creation_price_per_million is None
        assert metadata.cache_read_price_per_million is None
        assert metadata.supports_tool_use is True
        assert metadata.supports_vision is False
        assert metadata.supports_streaming is True


# =============================================================================
# TestModelRegistryGet - Tests for ModelRegistry.get()
# =============================================================================


class TestModelRegistryGet:
    """Tests for ModelRegistry.get() method."""

    def test_get_claude_sonnet_4_5(self):
        """Test getting Claude Sonnet 4.5 metadata."""
        metadata = ModelRegistry.get("claude-sonnet-4.5")
        assert metadata.model_id == "claude-sonnet-4.5"
        assert metadata.provider == "anthropic"
        assert metadata.context_window_tokens == 200000
        assert metadata.cost_tier == CostTier.STANDARD

    def test_get_claude_opus_4(self):
        """Test getting Claude Opus 4 metadata."""
        metadata = ModelRegistry.get("claude-opus-4")
        assert metadata.model_id == "claude-opus-4"
        assert metadata.provider == "anthropic"
        assert metadata.cost_tier == CostTier.PREMIUM
        assert metadata.input_price_per_million == 15.0

    def test_get_claude_haiku_4(self):
        """Test getting Claude Haiku 4 metadata."""
        metadata = ModelRegistry.get("claude-haiku-4.5")
        assert metadata.model_id == "claude-haiku-4.5"
        assert metadata.cost_tier == CostTier.ECONOMY

    def test_get_gpt_4(self):
        """Test getting GPT-4 metadata."""
        metadata = ModelRegistry.get("gpt-4")
        assert metadata.model_id == "gpt-4"
        assert metadata.provider == "openai"
        assert metadata.context_window_tokens == 8192
        assert metadata.token_counter_method == TokenCounterMethod.TIKTOKEN_CL100K

    def test_get_gpt_4o(self):
        """Test getting GPT-4o metadata."""
        metadata = ModelRegistry.get("gpt-4o")
        assert metadata.model_id == "gpt-4o"
        assert metadata.context_window_tokens == 128000
        assert metadata.token_counter_method == TokenCounterMethod.TIKTOKEN_O200K
        assert metadata.supports_vision is True

    def test_get_gpt_4o_mini(self):
        """Test getting GPT-4o Mini metadata."""
        metadata = ModelRegistry.get("gpt-4o-mini")
        assert metadata.model_id == "gpt-4o-mini"
        assert metadata.cost_tier == CostTier.ECONOMY
        assert metadata.input_price_per_million == 0.15

    def test_get_o1(self):
        """Test getting o1 metadata."""
        metadata = ModelRegistry.get("o1")
        assert metadata.model_id == "o1"
        assert metadata.context_window_tokens == 200000
        assert metadata.supports_tool_use is False  # o1 has limited tool support

    def test_get_qwen_coder(self):
        """Test getting Qwen 2.5 Coder metadata."""
        metadata = ModelRegistry.get("qwen2.5-coder:7b")
        assert metadata.model_id == "qwen2.5-coder:7b"
        assert metadata.provider == "ollama"
        assert metadata.context_window_tokens == 32768
        assert metadata.input_price_per_million is None  # Local model, no cost

    def test_get_unknown_model_raises_keyerror(self):
        """Test that getting unknown model raises KeyError."""
        with pytest.raises(KeyError) as exc_info:
            ModelRegistry.get("nonexistent-model-xyz")
        assert "nonexistent-model-xyz" in str(exc_info.value)
        assert "not found" in str(exc_info.value)
        assert "get_or_default" in str(exc_info.value)

    def test_get_empty_string_raises_keyerror(self):
        """Test that getting empty string raises KeyError."""
        with pytest.raises(KeyError):
            ModelRegistry.get("")


# =============================================================================
# TestModelRegistryGetOrDefault - Tests for graceful fallback
# =============================================================================


class TestModelRegistryGetOrDefault:
    """Tests for ModelRegistry.get_or_default() method."""

    def test_known_model_returns_actual_metadata(self):
        """Test that known models return actual metadata."""
        metadata = ModelRegistry.get_or_default("claude-sonnet-4.5")
        assert metadata.model_id == "claude-sonnet-4.5"
        assert metadata.context_window_tokens == 200000

    def test_unknown_model_returns_defaults(self):
        """Test that unknown models return conservative defaults."""
        metadata = ModelRegistry.get_or_default("my-custom-model")
        assert metadata.model_id == "my-custom-model"
        assert metadata.context_window_tokens == 8192  # Conservative default
        assert metadata.cost_tier == CostTier.ECONOMY

    def test_unknown_model_uses_provided_provider(self):
        """Test that unknown models use the provided provider."""
        metadata = ModelRegistry.get_or_default("custom-model", provider="anthropic")
        assert metadata.provider == "anthropic"

    def test_unknown_model_default_provider(self):
        """Test that unknown models default to 'unknown' provider."""
        metadata = ModelRegistry.get_or_default("custom-model")
        assert metadata.provider == "unknown"

    def test_unknown_model_uses_approximate_token_counting(self):
        """Test that unknown models use approximate token counting."""
        metadata = ModelRegistry.get_or_default("custom-model")
        assert metadata.token_counter_method == TokenCounterMethod.APPROXIMATE

    def test_unknown_model_display_name(self):
        """Test that unknown models get appropriate display name."""
        metadata = ModelRegistry.get_or_default("my-custom-model")
        assert "my-custom-model" in metadata.display_name

    def test_unknown_model_summarization_thresholds(self):
        """Test that unknown models get conservative summarization thresholds."""
        metadata = ModelRegistry.get_or_default("custom-model")
        assert metadata.summarization_trigger_threshold == 7000
        assert metadata.summarization_target_tokens == 6000
        assert metadata.max_summary_tokens == 500


# =============================================================================
# TestModelRegistryGetSummarizationModel - Tests for summarization model selection
# =============================================================================


class TestModelRegistryGetSummarizationModel:
    """Tests for ModelRegistry.get_summarization_model() method."""

    def test_anthropic_uses_haiku(self):
        """Test that Anthropic models use claude-haiku-4.5 for summarization."""
        summarizer = ModelRegistry.get_summarization_model("claude-opus-4")
        assert summarizer == "claude-haiku-4.5"

    def test_anthropic_sonnet_uses_haiku(self):
        """Test that Claude Sonnet uses Haiku for summarization."""
        summarizer = ModelRegistry.get_summarization_model("claude-sonnet-4.5")
        assert summarizer == "claude-haiku-4.5"

    def test_anthropic_haiku_uses_haiku(self):
        """Test that Claude Haiku uses itself for summarization."""
        summarizer = ModelRegistry.get_summarization_model("claude-haiku-4.5")
        assert summarizer == "claude-haiku-4.5"

    def test_openai_uses_gpt4o_mini(self):
        """Test that OpenAI models use gpt-4o-mini for summarization."""
        summarizer = ModelRegistry.get_summarization_model("gpt-4")
        assert summarizer == "gpt-4o-mini"

    def test_openai_gpt4o_uses_mini(self):
        """Test that GPT-4o uses gpt-4o-mini for summarization."""
        summarizer = ModelRegistry.get_summarization_model("gpt-4o")
        assert summarizer == "gpt-4o-mini"

    def test_openai_o1_uses_mini(self):
        """Test that o1 uses gpt-4o-mini for summarization."""
        summarizer = ModelRegistry.get_summarization_model("o1")
        assert summarizer == "gpt-4o-mini"

    def test_ollama_uses_same_model(self):
        """Test that Ollama models use themselves for summarization (no cost)."""
        summarizer = ModelRegistry.get_summarization_model("qwen2.5-coder:7b")
        assert summarizer == "qwen2.5-coder:7b"

    def test_ollama_llama_uses_same_model(self):
        """Test that Llama uses itself for summarization."""
        summarizer = ModelRegistry.get_summarization_model("llama3.2:3b")
        assert summarizer == "llama3.2:3b"

    def test_unknown_model_uses_self(self):
        """Test that unknown models use themselves for summarization."""
        # Unknown models default to 'unknown' provider, which has no default summarizer
        summarizer = ModelRegistry.get_summarization_model("custom-model")
        assert summarizer == "custom-model"


# =============================================================================
# TestModelRegistryListByProvider - Tests for provider filtering
# =============================================================================


class TestModelRegistryListByProvider:
    """Tests for ModelRegistry.list_by_provider() method."""

    def test_list_anthropic_models(self):
        """Test listing all Anthropic models."""
        models = ModelRegistry.list_by_provider("anthropic")
        assert len(models) >= 5
        assert all(m.provider == "anthropic" for m in models)
        model_ids = [m.model_id for m in models]
        assert "claude-opus-4" in model_ids
        assert "claude-sonnet-4.5" in model_ids
        assert "claude-haiku-4.5" in model_ids

    def test_list_openai_models(self):
        """Test listing all OpenAI models."""
        models = ModelRegistry.list_by_provider("openai")
        assert len(models) >= 7
        assert all(m.provider == "openai" for m in models)
        model_ids = [m.model_id for m in models]
        assert "gpt-4" in model_ids
        assert "gpt-4o" in model_ids
        assert "gpt-4o-mini" in model_ids

    def test_list_ollama_models(self):
        """Test listing all Ollama models."""
        models = ModelRegistry.list_by_provider("ollama")
        assert len(models) >= 5
        assert all(m.provider == "ollama" for m in models)
        model_ids = [m.model_id for m in models]
        assert "qwen2.5-coder:7b" in model_ids
        assert "llama3.2:3b" in model_ids

    def test_list_unknown_provider_returns_empty(self):
        """Test that unknown provider returns empty list."""
        models = ModelRegistry.list_by_provider("nonexistent-provider")
        assert models == []

    def test_list_results_sorted(self):
        """Test that results are sorted by model_id."""
        models = ModelRegistry.list_by_provider("anthropic")
        model_ids = [m.model_id for m in models]
        assert model_ids == sorted(model_ids)


# =============================================================================
# TestModelRegistryListAll - Tests for full enumeration
# =============================================================================


class TestModelRegistryListAll:
    """Tests for ModelRegistry.list_all() method."""

    def test_list_all_returns_all_models(self):
        """Test that list_all returns all registered models."""
        models = ModelRegistry.list_all()
        assert len(models) >= 17  # At least 17 models per plan

    def test_list_all_includes_all_providers(self):
        """Test that list_all includes models from all providers."""
        models = ModelRegistry.list_all()
        providers = {m.provider for m in models}
        assert "anthropic" in providers
        assert "openai" in providers
        assert "ollama" in providers

    def test_list_all_sorted_by_provider_then_model(self):
        """Test that results are sorted by provider then model_id."""
        models = ModelRegistry.list_all()
        # Check that models are grouped by provider
        providers_seen = []
        for model in models:
            if model.provider not in providers_seen:
                providers_seen.append(model.provider)
        assert providers_seen == sorted(providers_seen)


# =============================================================================
# TestModelRegistryIsRegistered - Tests for registration checking
# =============================================================================


class TestModelRegistryIsRegistered:
    """Tests for ModelRegistry.is_registered() method."""

    def test_registered_model_returns_true(self):
        """Test that registered models return True."""
        assert ModelRegistry.is_registered("claude-sonnet-4.5") is True
        assert ModelRegistry.is_registered("gpt-4o") is True
        assert ModelRegistry.is_registered("qwen2.5-coder:7b") is True

    def test_unregistered_model_returns_false(self):
        """Test that unregistered models return False."""
        assert ModelRegistry.is_registered("nonexistent-model") is False
        assert ModelRegistry.is_registered("") is False
        assert ModelRegistry.is_registered("gpt-999") is False

    def test_case_sensitive(self):
        """Test that model ID matching is case-sensitive."""
        assert ModelRegistry.is_registered("claude-sonnet-4.5") is True
        assert ModelRegistry.is_registered("Claude-Sonnet-4.5") is False


# =============================================================================
# TestModelRegistryListProviders - Tests for provider enumeration
# =============================================================================


class TestModelRegistryListProviders:
    """Tests for ModelRegistry.list_providers() method."""

    def test_list_all_providers(self):
        """Test that all providers are listed."""
        providers = ModelRegistry.list_providers()
        assert "anthropic" in providers
        assert "openai" in providers
        assert "ollama" in providers

    def test_providers_sorted(self):
        """Test that providers are sorted alphabetically."""
        providers = ModelRegistry.list_providers()
        assert providers == sorted(providers)

    def test_providers_unique(self):
        """Test that provider list has no duplicates."""
        providers = ModelRegistry.list_providers()
        assert len(providers) == len(set(providers))


# =============================================================================
# TestModelRegistryGetEconomyModels - Tests for economy model filtering
# =============================================================================


class TestModelRegistryGetEconomyModels:
    """Tests for ModelRegistry.get_economy_models() method."""

    def test_returns_only_economy_tier(self):
        """Test that only economy tier models are returned."""
        models = ModelRegistry.get_economy_models()
        assert all(m.cost_tier == CostTier.ECONOMY for m in models)

    def test_includes_haiku(self):
        """Test that Claude Haiku models are included."""
        models = ModelRegistry.get_economy_models()
        model_ids = [m.model_id for m in models]
        assert "claude-haiku-4.5" in model_ids

    def test_includes_gpt4o_mini(self):
        """Test that GPT-4o Mini is included."""
        models = ModelRegistry.get_economy_models()
        model_ids = [m.model_id for m in models]
        assert "gpt-4o-mini" in model_ids

    def test_includes_ollama_models(self):
        """Test that Ollama models are included (all economy)."""
        models = ModelRegistry.get_economy_models()
        ollama_models = [m for m in models if m.provider == "ollama"]
        assert len(ollama_models) >= 5

    def test_excludes_premium_models(self):
        """Test that premium models are excluded."""
        models = ModelRegistry.get_economy_models()
        model_ids = [m.model_id for m in models]
        assert "claude-opus-4" not in model_ids
        assert "gpt-4" not in model_ids

    def test_results_sorted(self):
        """Test that results are sorted by provider then model_id."""
        models = ModelRegistry.get_economy_models()
        # Check sorting
        for i in range(len(models) - 1):
            current = models[i]
            next_model = models[i + 1]
            assert (current.provider, current.model_id) <= (next_model.provider, next_model.model_id)


# =============================================================================
# TestModelMetadataFields - Tests for specific field values
# =============================================================================


class TestModelMetadataFields:
    """Tests for specific ModelMetadata field values and relationships."""

    def test_summarization_trigger_less_than_context(self):
        """Test that trigger threshold is less than context window."""
        for model in ModelRegistry.list_all():
            assert model.summarization_trigger_threshold < model.context_window_tokens, \
                f"{model.model_id}: trigger ({model.summarization_trigger_threshold}) >= " \
                f"context ({model.context_window_tokens})"

    def test_summarization_target_less_than_trigger(self):
        """Test that target is less than trigger threshold."""
        for model in ModelRegistry.list_all():
            assert model.summarization_target_tokens < model.summarization_trigger_threshold, \
                f"{model.model_id}: target ({model.summarization_target_tokens}) >= " \
                f"trigger ({model.summarization_trigger_threshold})"

    def test_max_output_less_than_context(self):
        """Test that max output tokens is less than context window."""
        for model in ModelRegistry.list_all():
            assert model.max_output_tokens <= model.context_window_tokens, \
                f"{model.model_id}: max_output ({model.max_output_tokens}) > " \
                f"context ({model.context_window_tokens})"

    def test_anthropic_models_use_native_counter(self):
        """Test that Anthropic models use native token counting."""
        for model in ModelRegistry.list_by_provider("anthropic"):
            assert model.token_counter_method == TokenCounterMethod.ANTHROPIC_NATIVE, \
                f"{model.model_id} should use ANTHROPIC_NATIVE"

    def test_ollama_models_use_approximate_counter(self):
        """Test that Ollama models use approximate token counting."""
        for model in ModelRegistry.list_by_provider("ollama"):
            assert model.token_counter_method == TokenCounterMethod.APPROXIMATE, \
                f"{model.model_id} should use APPROXIMATE"

    def test_ollama_models_have_no_cost(self):
        """Test that Ollama models have no cost (local)."""
        for model in ModelRegistry.list_by_provider("ollama"):
            assert model.input_price_per_million is None, \
                f"{model.model_id} should have no input cost"
            assert model.output_price_per_million is None, \
                f"{model.model_id} should have no output cost"

    def test_paid_models_have_costs(self):
        """Test that paid models have cost information."""
        for model in ModelRegistry.list_by_provider("anthropic"):
            assert model.input_price_per_million is not None, \
                f"{model.model_id} should have input cost"
            assert model.output_price_per_million is not None, \
                f"{model.model_id} should have output cost"


# =============================================================================
# TestCachePricing - Tests for cache pricing fields
# =============================================================================


class TestCachePricing:
    """Tests for cache_creation_price_per_million and cache_read_price_per_million."""

    def test_anthropic_models_have_cache_pricing(self):
        """Test that all Anthropic models have cache pricing set."""
        for model in ModelRegistry.list_by_provider("anthropic"):
            assert model.cache_creation_price_per_million is not None, \
                f"{model.model_id} should have cache creation price"
            assert model.cache_read_price_per_million is not None, \
                f"{model.model_id} should have cache read price"

    def test_openai_models_have_cache_pricing(self):
        """Test that all OpenAI models have cache pricing set."""
        for model in ModelRegistry.list_by_provider("openai"):
            assert model.cache_creation_price_per_million is not None, \
                f"{model.model_id} should have cache creation price"
            assert model.cache_read_price_per_million is not None, \
                f"{model.model_id} should have cache read price"

    def test_ollama_models_have_no_cache_pricing(self):
        """Test that Ollama models have no cache pricing (local, no provider caching)."""
        for model in ModelRegistry.list_by_provider("ollama"):
            assert model.cache_creation_price_per_million is None, \
                f"{model.model_id} should have no cache creation price"
            assert model.cache_read_price_per_million is None, \
                f"{model.model_id} should have no cache read price"

    def test_anthropic_cache_creation_is_1_25x_input(self):
        """Test that Anthropic cache creation = 1.25x input (5-min ephemeral TTL)."""
        for model in ModelRegistry.list_by_provider("anthropic"):
            expected = model.input_price_per_million * 1.25
            assert model.cache_creation_price_per_million == pytest.approx(expected), \
                f"{model.model_id}: cache_creation {model.cache_creation_price_per_million} " \
                f"!= 1.25 * input {expected}"

    def test_anthropic_cache_read_is_0_1x_input(self):
        """Test that Anthropic cache read = 0.1x input (90% discount)."""
        for model in ModelRegistry.list_by_provider("anthropic"):
            expected = model.input_price_per_million * 0.1
            assert model.cache_read_price_per_million == pytest.approx(expected), \
                f"{model.model_id}: cache_read {model.cache_read_price_per_million} " \
                f"!= 0.1 * input {expected}"

    def test_openai_cache_creation_equals_input(self):
        """Test that OpenAI cache creation = input price (no write premium)."""
        for model in ModelRegistry.list_by_provider("openai"):
            assert model.cache_creation_price_per_million == model.input_price_per_million, \
                f"{model.model_id}: cache_creation {model.cache_creation_price_per_million} " \
                f"!= input {model.input_price_per_million}"

    def test_openai_cache_read_is_0_5x_input(self):
        """Test that OpenAI cache read = 0.5x input (50% discount)."""
        for model in ModelRegistry.list_by_provider("openai"):
            expected = model.input_price_per_million * 0.5
            assert model.cache_read_price_per_million == pytest.approx(expected), \
                f"{model.model_id}: cache_read {model.cache_read_price_per_million} " \
                f"!= 0.5 * input {expected}"

    def test_specific_sonnet_cache_pricing(self):
        """Test exact cache pricing values for claude-sonnet-4.5."""
        metadata = ModelRegistry.get("claude-sonnet-4.5")
        assert metadata.input_price_per_million == 3.0
        assert metadata.output_price_per_million == 15.0
        assert metadata.cache_creation_price_per_million == 3.75
        assert metadata.cache_read_price_per_million == 0.30

    def test_default_metadata_has_no_cache_pricing(self):
        """Test that unknown models get None for cache pricing."""
        metadata = ModelRegistry.get_or_default("unknown-custom-model")
        assert metadata.cache_creation_price_per_million is None
        assert metadata.cache_read_price_per_million is None


# =============================================================================
# TestModelMetadataGetApiModelId - Tests for API model ID resolution
# =============================================================================


class TestModelMetadataGetApiModelId:
    """Tests for ModelMetadata.get_api_model_id() method."""

    def test_anthropic_model_returns_api_id(self):
        """Test that Anthropic models return their api_model_id."""
        metadata = ModelRegistry.get("claude-sonnet-4.5")
        assert metadata.get_api_model_id() == "claude-sonnet-4-5-20250929"

    def test_anthropic_opus_returns_api_id(self):
        """Test that Claude Opus returns its api_model_id."""
        metadata = ModelRegistry.get("claude-opus-4")
        assert metadata.get_api_model_id() == "claude-opus-4-20250514"

    def test_anthropic_haiku_returns_api_id(self):
        """Test that Claude Haiku returns its api_model_id."""
        metadata = ModelRegistry.get("claude-haiku-4.5")
        assert metadata.get_api_model_id() == "claude-haiku-4-5-20251001"

    def test_anthropic_sonnet_3_5_returns_api_id(self):
        """Test that Claude Sonnet 3.5 returns its api_model_id."""
        metadata = ModelRegistry.get("claude-sonnet-3.5")
        assert metadata.get_api_model_id() == "claude-3-5-sonnet-20241022"

    def test_anthropic_haiku_3_5_returns_api_id(self):
        """Test that Claude Haiku 3.5 returns its api_model_id."""
        metadata = ModelRegistry.get("claude-haiku-3.5")
        assert metadata.get_api_model_id() == "claude-3-5-haiku-20241022"

    def test_openai_model_returns_model_id(self):
        """Test that OpenAI models return model_id (no api_model_id mapping)."""
        metadata = ModelRegistry.get("gpt-4o")
        assert metadata.get_api_model_id() == "gpt-4o"

    def test_ollama_model_returns_model_id(self):
        """Test that Ollama models return model_id (no api_model_id mapping)."""
        metadata = ModelRegistry.get("qwen2.5-coder:7b")
        assert metadata.get_api_model_id() == "qwen2.5-coder:7b"

    def test_all_anthropic_models_have_api_model_id(self):
        """Test that all Anthropic models have api_model_id set."""
        for model in ModelRegistry.list_by_provider("anthropic"):
            assert model.api_model_id is not None, \
                f"{model.model_id} should have api_model_id set"
            assert model.api_model_id != model.model_id, \
                f"{model.model_id} api_model_id should differ from model_id"

    def test_openai_ollama_models_no_api_model_id(self):
        """Test that OpenAI and Ollama models have api_model_id=None."""
        for provider in ["openai", "ollama"]:
            for model in ModelRegistry.list_by_provider(provider):
                assert model.api_model_id is None, \
                    f"{model.model_id} should not have api_model_id set"


# =============================================================================
# TestModelRegistryResolve - Tests for model name resolution
# =============================================================================


class TestModelRegistryResolve:
    """Tests for ModelRegistry.resolve() method."""

    def test_resolve_by_model_id(self):
        """Test resolution by exact model_id match."""
        api_id, metadata = ModelRegistry.resolve("claude-sonnet-4.5")
        assert api_id == "claude-sonnet-4-5-20250929"
        assert metadata.model_id == "claude-sonnet-4.5"

    def test_resolve_by_api_model_id(self):
        """Test resolution by exact api_model_id match."""
        api_id, metadata = ModelRegistry.resolve("claude-sonnet-4-5-20250929")
        assert api_id == "claude-sonnet-4-5-20250929"
        assert metadata.model_id == "claude-sonnet-4.5"

    def test_resolve_case_insensitive(self):
        """Test case-insensitive resolution."""
        api_id, metadata = ModelRegistry.resolve("Claude-Sonnet-4.5")
        assert api_id == "claude-sonnet-4-5-20250929"
        assert metadata.model_id == "claude-sonnet-4.5"

    def test_resolve_uppercase(self):
        """Test uppercase resolution."""
        api_id, metadata = ModelRegistry.resolve("CLAUDE-SONNET-4.5")
        assert api_id == "claude-sonnet-4-5-20250929"
        assert metadata.model_id == "claude-sonnet-4.5"

    def test_resolve_openai_model(self):
        """Test resolution of OpenAI model (no mapping)."""
        api_id, metadata = ModelRegistry.resolve("gpt-4o")
        assert api_id == "gpt-4o"
        assert metadata.model_id == "gpt-4o"

    def test_resolve_ollama_model(self):
        """Test resolution of Ollama model (no mapping)."""
        api_id, metadata = ModelRegistry.resolve("qwen2.5-coder:7b")
        assert api_id == "qwen2.5-coder:7b"
        assert metadata.model_id == "qwen2.5-coder:7b"

    def test_resolve_unknown_model_raises_keyerror(self):
        """Test that unknown models raise KeyError."""
        with pytest.raises(KeyError) as exc_info:
            ModelRegistry.resolve("nonexistent-model-xyz")
        assert "nonexistent-model-xyz" in str(exc_info.value)
        assert "not found" in str(exc_info.value)

    def test_resolve_empty_string_raises_keyerror(self):
        """Test that empty string raises KeyError."""
        with pytest.raises(KeyError) as exc_info:
            ModelRegistry.resolve("")
        assert "empty" in str(exc_info.value).lower()

    def test_resolve_whitespace_only_raises_keyerror(self):
        """Test that whitespace-only string raises KeyError."""
        with pytest.raises(KeyError) as exc_info:
            ModelRegistry.resolve("   ")
        assert "empty" in str(exc_info.value).lower()

    def test_resolve_strips_whitespace(self):
        """Test that leading/trailing whitespace is stripped."""
        api_id, metadata = ModelRegistry.resolve("  claude-sonnet-4.5  ")
        assert api_id == "claude-sonnet-4-5-20250929"
        assert metadata.model_id == "claude-sonnet-4.5"

    def test_resolve_all_anthropic_models(self):
        """Test that all Anthropic models resolve correctly."""
        expected = {
            "claude-opus-4": "claude-opus-4-20250514",
            "claude-sonnet-4.5": "claude-sonnet-4-5-20250929",
            "claude-haiku-4.5": "claude-haiku-4-5-20251001",
            "claude-sonnet-3.5": "claude-3-5-sonnet-20241022",
            "claude-haiku-3.5": "claude-3-5-haiku-20241022",
        }
        for model_id, expected_api_id in expected.items():
            api_id, metadata = ModelRegistry.resolve(model_id)
            assert api_id == expected_api_id, \
                f"{model_id} should resolve to {expected_api_id}, got {api_id}"


# =============================================================================
# TestModelRegistryResolveOrPassthrough - Tests for graceful resolution
# =============================================================================


class TestModelRegistryResolveOrPassthrough:
    """Tests for ModelRegistry.resolve_or_passthrough() method."""

    def test_known_model_resolved(self):
        """Test that known models are resolved normally."""
        api_id, metadata = ModelRegistry.resolve_or_passthrough("claude-sonnet-4.5")
        assert api_id == "claude-sonnet-4-5-20250929"
        assert metadata.model_id == "claude-sonnet-4.5"

    def test_unknown_model_passed_through(self):
        """Test that unknown models are passed through as-is."""
        api_id, metadata = ModelRegistry.resolve_or_passthrough("my-custom-model")
        assert api_id == "my-custom-model"
        assert metadata.model_id == "my-custom-model"

    def test_unknown_model_gets_default_metadata(self):
        """Test that unknown models get conservative default metadata."""
        api_id, metadata = ModelRegistry.resolve_or_passthrough("my-custom-model")
        assert metadata.context_window_tokens == 8192  # Conservative default
        assert metadata.cost_tier == CostTier.ECONOMY

    def test_unknown_model_uses_provided_provider(self):
        """Test that unknown models use the provided provider hint."""
        api_id, metadata = ModelRegistry.resolve_or_passthrough(
            "my-custom-model",
            provider="anthropic",
        )
        assert metadata.provider == "anthropic"

    def test_unknown_model_default_provider(self):
        """Test that unknown models default to 'unknown' provider."""
        api_id, metadata = ModelRegistry.resolve_or_passthrough("my-custom-model")
        assert metadata.provider == "unknown"

    def test_case_insensitive_known_model(self):
        """Test case-insensitive resolution for known models."""
        api_id, metadata = ModelRegistry.resolve_or_passthrough("Claude-Sonnet-4.5")
        assert api_id == "claude-sonnet-4-5-20250929"

    def test_empty_string_passed_through(self):
        """Test that empty string is handled gracefully."""
        # Should not raise, just pass through
        api_id, metadata = ModelRegistry.resolve_or_passthrough("")
        assert api_id == ""


# =============================================================================
# TestModuleExports - Tests for __all__ exports
# =============================================================================


class TestModuleExports:
    """Tests for module-level exports."""

    def test_import_from_model_registry(self):
        """Test that all expected symbols can be imported."""
        from graphton.core.model_registry import (
            CostTier,
            ModelMetadata,
            ModelRegistry,
            TokenCounterMethod,
        )
        assert CostTier is not None
        assert ModelMetadata is not None
        assert ModelRegistry is not None
        assert TokenCounterMethod is not None

    def test_import_from_core(self):
        """Test that symbols can be imported from core package."""
        from graphton.core import (
            CostTier,
            ModelMetadata,
            ModelRegistry,
            TokenCounterMethod,
        )
        assert CostTier is not None
        assert ModelMetadata is not None
        assert ModelRegistry is not None
        assert TokenCounterMethod is not None

    def test_import_from_graphton(self):
        """Test that symbols can be imported from main package."""
        from graphton import (
            CostTier,
            ModelMetadata,
            ModelRegistry,
            TokenCounterMethod,
        )
        assert CostTier is not None
        assert ModelMetadata is not None
        assert ModelRegistry is not None
        assert TokenCounterMethod is not None


# =============================================================================
# TestSupportsThinking - Tests for supports_thinking capability flag
# =============================================================================


class TestSupportsThinking:
    """Tests for the supports_thinking field on ModelMetadata."""

    def test_defaults_to_false(self):
        """Test that supports_thinking defaults to False on ModelMetadata."""
        metadata = ModelMetadata(
            model_id="test-model",
            provider="anthropic",
            display_name="Test",
            context_window_tokens=8192,
            max_output_tokens=4096,
            summarization_trigger_threshold=7000,
            summarization_target_tokens=6000,
            max_summary_tokens=500,
            token_counter_method=TokenCounterMethod.APPROXIMATE,
            cost_tier=CostTier.ECONOMY,
        )
        assert metadata.supports_thinking is False
        assert metadata.supports_adaptive_thinking is False

    @pytest.mark.parametrize("model_id", [
        "claude-sonnet-4.6",
        "claude-opus-4.5",
        "claude-sonnet-4.5",
        "claude-opus-4",
    ])
    def test_thinking_enabled_models(self, model_id):
        """Test that supported models have supports_thinking=True."""
        metadata = ModelRegistry.get(model_id)
        assert metadata.supports_thinking is True, (
            f"{model_id} should have supports_thinking=True"
        )

    @pytest.mark.parametrize("model_id", [
        "claude-haiku-4.5",
        "claude-sonnet-3.5",
        "claude-haiku-3.5",
    ])
    def test_thinking_disabled_models(self, model_id):
        """Test that unsupported models have supports_thinking=False."""
        metadata = ModelRegistry.get(model_id)
        assert metadata.supports_thinking is False, (
            f"{model_id} should have supports_thinking=False"
        )
        assert metadata.supports_adaptive_thinking is False, (
            f"{model_id} should have supports_adaptive_thinking=False"
        )

    def test_opus_4_6_adaptive_thinking(self):
        """Test that Opus 4.6 uses adaptive thinking (not manual)."""
        metadata = ModelRegistry.get("claude-opus-4.6")
        assert metadata.supports_thinking is False, (
            "Opus 4.6 should NOT use manual thinking"
        )
        assert metadata.supports_adaptive_thinking is True, (
            "Opus 4.6 should use adaptive thinking"
        )

    def test_manual_and_adaptive_mutually_exclusive(self):
        """Test that no model has both manual and adaptive thinking enabled."""
        for model in ModelRegistry.list_by_provider("anthropic"):
            assert not (model.supports_thinking and model.supports_adaptive_thinking), (
                f"{model.model_id} has both supports_thinking and "
                f"supports_adaptive_thinking set to True"
            )


# =============================================================================
# TestGetByApiModelId - Tests for reverse API model ID lookup (Phase 3)
# =============================================================================


class TestGetByApiModelId:
    """Tests for ModelRegistry.get_by_api_model_id() reverse lookup."""

    def test_lookup_by_explicit_api_model_id(self):
        """Explicit api_model_id resolves to the correct entry."""
        metadata = ModelRegistry.get("claude-sonnet-4.6")
        if metadata.api_model_id:
            result = ModelRegistry.get_by_api_model_id(metadata.api_model_id)
            assert result is not None
            assert result.model_id == "claude-sonnet-4.6"

    def test_lookup_by_platform_model_id(self):
        """Platform model_id also resolves via the reverse index."""
        result = ModelRegistry.get_by_api_model_id("claude-sonnet-4.6")
        assert result is not None
        assert result.model_id == "claude-sonnet-4.6"

    def test_lookup_unknown_returns_none(self):
        """Unknown identifiers return None, not KeyError."""
        assert ModelRegistry.get_by_api_model_id("nonexistent-model-xyz") is None

    def test_ollama_model_resolves(self):
        """Ollama models (api_model_id is None) resolve by model_id."""
        if ModelRegistry.is_registered("qwen2.5-coder:7b"):
            result = ModelRegistry.get_by_api_model_id("qwen2.5-coder:7b")
            assert result is not None
            assert result.provider == "ollama"

    def test_openai_model_resolves(self):
        """OpenAI platform ID resolves correctly."""
        result = ModelRegistry.get_by_api_model_id("gpt-4o")
        assert result is not None
        assert result.provider == "openai"

    def test_index_is_lazily_built(self):
        """The reverse index is built once and cached."""
        ModelRegistry._API_MODEL_ID_INDEX = None
        _ = ModelRegistry.get_by_api_model_id("gpt-4o")
        assert ModelRegistry._API_MODEL_ID_INDEX is not None
        index_id = id(ModelRegistry._API_MODEL_ID_INDEX)
        _ = ModelRegistry.get_by_api_model_id("gpt-4o")
        assert id(ModelRegistry._API_MODEL_ID_INDEX) == index_id

    def test_all_models_with_api_model_id_resolvable(self):
        """Every model with an explicit api_model_id can be found via reverse lookup."""
        for model in ModelRegistry.list_all():
            if model.api_model_id:
                result = ModelRegistry.get_by_api_model_id(model.api_model_id)
                assert result is not None, (
                    f"api_model_id '{model.api_model_id}' for '{model.model_id}' "
                    f"not found via get_by_api_model_id"
                )
                assert result.model_id == model.model_id


# =============================================================================
# TestEmptyRegistrySubjectGenerationBug - Reproduces the production bug where
# model-registry.json is missing from the embedded runtime, causing
# generate_session_subject to send "claude-sonnet-4.5" to Anthropic (404).
# =============================================================================


class TestEmptyRegistrySubjectGenerationBug:
    """Reproduces the session subject generation failure in embedded runtimes.

    When model-registry.json fails to load (e.g., missing from graphton.data
    in the embedded venv), ModelRegistry._MODELS is empty. This causes:
    1. get_or_default("claude-sonnet-4.5") → provider="unknown" (not "anthropic")
    2. get_summarization_model returns the primary model unchanged
    3. The raw "claude-sonnet-4.5" display name is sent to Anthropic → 404
    """

    def setup_method(self):
        """Clear registry to simulate missing model-registry.json."""
        self._original_models = dict(ModelRegistry._MODELS)
        self._original_loaded = ModelRegistry._MODELS_LOADED
        self._original_index = ModelRegistry._API_MODEL_ID_INDEX
        ModelRegistry._MODELS = {}
        ModelRegistry._MODELS_LOADED = True
        ModelRegistry._API_MODEL_ID_INDEX = None

    def teardown_method(self):
        """Restore registry."""
        ModelRegistry._MODELS = self._original_models
        ModelRegistry._MODELS_LOADED = self._original_loaded
        ModelRegistry._API_MODEL_ID_INDEX = self._original_index

    def test_get_or_default_returns_unknown_provider(self):
        """With empty registry, get_or_default infers provider as 'unknown'."""
        metadata = ModelRegistry.get_or_default("claude-sonnet-4.5")
        assert metadata.provider == "unknown", (
            f"Expected provider='unknown' for empty registry, got '{metadata.provider}'"
        )

    def test_summarization_model_returns_primary_model_unchanged(self):
        """With empty registry, summarization model falls back to the primary model.

        This is the bug: it should return 'claude-haiku-4.5' but instead
        returns 'claude-sonnet-4.5' because provider is 'unknown' and there
        is no economy-tier mapping for unknown providers.
        """
        summarizer = ModelRegistry.get_summarization_model("claude-sonnet-4.5")
        assert summarizer == "claude-sonnet-4.5", (
            "Bug reproduction: empty registry should cause summarization model "
            f"to fall back to primary model, but got '{summarizer}'"
        )

    def test_correct_behavior_when_registry_loaded(self):
        """Contrast: with registry loaded, summarization correctly maps to haiku."""
        # Restore registry for this test
        ModelRegistry._MODELS = self._original_models
        ModelRegistry._MODELS_LOADED = self._original_loaded
        ModelRegistry._API_MODEL_ID_INDEX = self._original_index

        summarizer = ModelRegistry.get_summarization_model("claude-sonnet-4.5")
        assert summarizer == "claude-haiku-4.5", (
            f"With loaded registry, expected 'claude-haiku-4.5', got '{summarizer}'"
        )

        metadata = ModelRegistry.get_or_default("claude-sonnet-4.5")
        assert metadata.provider == "anthropic", (
            f"With loaded registry, expected provider='anthropic', got '{metadata.provider}'"
        )
