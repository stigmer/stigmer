"""Unit tests for Anthropic prompt caching (Phase 4).

Tests cover:
- _inject_cache_control: system prompt caching (string, list-of-blocks, None)
- _inject_cache_control: tool definition caching (non-empty, empty, absent)
- _inject_cache_control: combined system + tool caching
- _inject_cache_control: idempotency (existing cache_control not overwritten)
- _EagerToolStreamingChatAnthropic: _prompt_caching flag opt-out
- _EagerToolStreamingChatAnthropic: integration with _get_request_payload
"""

import copy

import pytest

from graphton.core.models import (
    _CACHE_CONTROL_EPHEMERAL,
    _EagerToolStreamingChatAnthropic,
    _inject_cache_control,
)


# =============================================================================
# _inject_cache_control — Layer 1: system prompt
# =============================================================================


class TestInjectCacheControlSystem:
    """Tests for cache_control injection on the system prompt."""

    def test_string_system_prompt_converted_to_blocks(self):
        """A plain string system prompt is wrapped in a content block list."""
        payload = {"system": "You are a helpful assistant."}
        _inject_cache_control(payload)

        assert isinstance(payload["system"], list)
        assert len(payload["system"]) == 1
        block = payload["system"][0]
        assert block["type"] == "text"
        assert block["text"] == "You are a helpful assistant."
        assert block["cache_control"] == _CACHE_CONTROL_EPHEMERAL

    def test_list_system_prompt_gets_cache_control_on_last_block(self):
        """A list-of-blocks system prompt gets cache_control on the last block only."""
        payload = {
            "system": [
                {"type": "text", "text": "First section."},
                {"type": "text", "text": "Second section."},
            ],
        }
        _inject_cache_control(payload)

        assert "cache_control" not in payload["system"][0]
        assert payload["system"][1]["cache_control"] == _CACHE_CONTROL_EPHEMERAL

    def test_single_block_list_system_prompt(self):
        """A single-element list system prompt gets cache_control."""
        payload = {
            "system": [{"type": "text", "text": "Only block."}],
        }
        _inject_cache_control(payload)

        assert payload["system"][0]["cache_control"] == _CACHE_CONTROL_EPHEMERAL

    def test_none_system_prompt_unchanged(self):
        """None system prompt is left as-is."""
        payload = {"system": None}
        _inject_cache_control(payload)
        assert payload["system"] is None

    def test_missing_system_key_no_error(self):
        """Payload without a 'system' key does not raise."""
        payload = {"messages": []}
        _inject_cache_control(payload)
        assert "system" not in payload

    def test_empty_string_system_prompt_unchanged(self):
        """An empty string system prompt is not converted to blocks."""
        payload = {"system": ""}
        _inject_cache_control(payload)
        assert payload["system"] == ""

    def test_empty_list_system_prompt_unchanged(self):
        """An empty list system prompt is left as-is."""
        payload = {"system": []}
        _inject_cache_control(payload)
        assert payload["system"] == []


# =============================================================================
# _inject_cache_control — Layer 1: idempotency
# =============================================================================


class TestInjectCacheControlSystemIdempotency:
    """Existing cache_control markers are never overwritten."""

    def test_existing_cache_control_on_last_block_preserved(self):
        """If the last block already has cache_control, it is not replaced."""
        custom_cc = {"type": "ephemeral", "ttl": "1h"}
        payload = {
            "system": [
                {"type": "text", "text": "Content.", "cache_control": custom_cc},
            ],
        }
        _inject_cache_control(payload)
        assert payload["system"][0]["cache_control"] is custom_cc

    def test_string_conversion_always_adds(self):
        """String system prompts are always converted (no prior cache_control possible)."""
        payload = {"system": "Hello."}
        _inject_cache_control(payload)
        assert payload["system"][0]["cache_control"] == _CACHE_CONTROL_EPHEMERAL

        _inject_cache_control(payload)
        assert payload["system"][0]["cache_control"] == _CACHE_CONTROL_EPHEMERAL
        assert len(payload["system"]) == 1


# =============================================================================
# _inject_cache_control — Layer 2: tool definitions
# =============================================================================


class TestInjectCacheControlTools:
    """Tests for cache_control injection on tool definitions."""

    def test_last_tool_gets_cache_control(self):
        """The last tool definition receives cache_control."""
        payload = {
            "tools": [
                {"name": "read", "input_schema": {}},
                {"name": "write", "input_schema": {}},
            ],
        }
        _inject_cache_control(payload)

        assert "cache_control" not in payload["tools"][0]
        assert payload["tools"][1]["cache_control"] == _CACHE_CONTROL_EPHEMERAL

    def test_single_tool_gets_cache_control(self):
        """A single tool in the list receives cache_control."""
        payload = {"tools": [{"name": "execute", "input_schema": {}}]}
        _inject_cache_control(payload)
        assert payload["tools"][0]["cache_control"] == _CACHE_CONTROL_EPHEMERAL

    def test_empty_tools_list_unchanged(self):
        """An empty tools list is left as-is."""
        payload = {"tools": []}
        _inject_cache_control(payload)
        assert payload["tools"] == []

    def test_missing_tools_key_no_error(self):
        """Payload without a 'tools' key does not raise."""
        payload = {"system": "Hello."}
        _inject_cache_control(payload)
        assert "tools" not in payload

    def test_existing_cache_control_on_last_tool_preserved(self):
        """If the last tool already has cache_control, it is not replaced."""
        custom_cc = {"type": "ephemeral", "ttl": "1h"}
        payload = {
            "tools": [
                {"name": "search", "input_schema": {}, "cache_control": custom_cc},
            ],
        }
        _inject_cache_control(payload)
        assert payload["tools"][0]["cache_control"] is custom_cc


# =============================================================================
# _inject_cache_control — combined scenarios
# =============================================================================


class TestInjectCacheControlCombined:
    """Tests for combined system + tool caching."""

    def test_both_system_and_tools_get_markers(self):
        """Both system prompt and tools receive cache_control in a single call."""
        payload = {
            "system": "You are helpful.",
            "tools": [
                {"name": "read", "input_schema": {}},
                {"name": "write", "input_schema": {}},
            ],
            "messages": [{"role": "user", "content": "Hello"}],
        }
        _inject_cache_control(payload)

        assert isinstance(payload["system"], list)
        assert payload["system"][0]["cache_control"] == _CACHE_CONTROL_EPHEMERAL
        assert "cache_control" not in payload["tools"][0]
        assert payload["tools"][1]["cache_control"] == _CACHE_CONTROL_EPHEMERAL
        assert "cache_control" not in payload["messages"][0]

    def test_messages_never_modified(self):
        """_inject_cache_control does not touch the messages list."""
        messages = [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello!"},
        ]
        payload = {
            "system": "System.",
            "tools": [{"name": "tool", "input_schema": {}}],
            "messages": copy.deepcopy(messages),
        }
        _inject_cache_control(payload)

        for msg in payload["messages"]:
            assert "cache_control" not in msg

    def test_realistic_payload(self):
        """Simulates a realistic Anthropic API payload with system + tools + messages."""
        payload = {
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 20000,
            "system": "You are a cloud infrastructure assistant.\n\n## Capabilities\n...",
            "tools": [
                {
                    "name": "list_organizations",
                    "description": "List all organizations accessible to the user.",
                    "input_schema": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
                {
                    "name": "create_resource",
                    "description": "Create a cloud resource.",
                    "input_schema": {
                        "type": "object",
                        "properties": {"kind": {"type": "string"}},
                        "required": ["kind"],
                    },
                    "eager_input_streaming": True,
                },
            ],
            "messages": [
                {"role": "user", "content": [{"type": "text", "text": "List orgs"}]},
            ],
            "temperature": None,
            "thinking": {"type": "enabled", "budget_tokens": 10000},
        }
        original_model = payload["model"]
        original_messages = copy.deepcopy(payload["messages"])

        _inject_cache_control(payload)

        assert payload["model"] == original_model
        assert isinstance(payload["system"], list)
        assert payload["system"][0]["cache_control"] == _CACHE_CONTROL_EPHEMERAL

        assert "cache_control" not in payload["tools"][0]
        assert payload["tools"][1]["cache_control"] == _CACHE_CONTROL_EPHEMERAL
        assert payload["tools"][1]["eager_input_streaming"] is True

        assert payload["messages"] == original_messages


# =============================================================================
# _EagerToolStreamingChatAnthropic — prompt caching flag
# =============================================================================


class TestPromptCachingFlag:
    """Tests for the _prompt_caching opt-out on the model class."""

    def test_prompt_caching_enabled_by_default(self):
        """New instances have prompt caching enabled."""
        model = _EagerToolStreamingChatAnthropic(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
        )
        assert model._prompt_caching is True

    def test_prompt_caching_can_be_disabled(self):
        """_prompt_caching can be set to False after construction."""
        model = _EagerToolStreamingChatAnthropic(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
        )
        model._prompt_caching = False
        assert model._prompt_caching is False


# =============================================================================
# _EagerToolStreamingChatAnthropic._get_request_payload — integration
# =============================================================================


class TestGetRequestPayloadIntegration:
    """Integration tests verifying cache_control appears in the final payload.

    These tests call _get_request_payload() on a real model instance with
    crafted input, validating that the full patching pipeline (eager streaming
    + effort + prompt caching) works end-to-end.
    """

    @pytest.fixture()
    def model(self):
        return _EagerToolStreamingChatAnthropic(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
        )

    @pytest.fixture()
    def model_no_cache(self):
        m = _EagerToolStreamingChatAnthropic(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
        )
        m._prompt_caching = False
        return m

    def _build_input(self, system: str = "You are helpful.") -> list[dict]:
        """Build a minimal message list with system + user message."""
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": "Hello"},
        ]

    def test_payload_has_cache_control_on_system(self, model):
        """The final payload should have cache_control on the system prompt."""
        payload = model._get_request_payload(self._build_input())

        system = payload.get("system")
        assert system is not None
        if isinstance(system, list):
            assert any(
                block.get("cache_control") == _CACHE_CONTROL_EPHEMERAL
                for block in system
                if isinstance(block, dict)
            )
        else:
            pytest.fail(f"Expected system to be a list, got {type(system)}")

    def test_payload_has_cache_control_on_tools(self, model):
        """When tools are present in the payload, the last one gets cache_control."""
        tool_defs = [
            {
                "name": "dummy_tool",
                "description": "A dummy tool.",
                "input_schema": {
                    "type": "object",
                    "properties": {"x": {"type": "string"}},
                },
            },
        ]
        payload = model._get_request_payload(self._build_input(), tools=tool_defs)

        tools = payload.get("tools", [])
        assert len(tools) >= 1
        assert tools[-1].get("cache_control") == _CACHE_CONTROL_EPHEMERAL

    def test_opt_out_skips_cache_control(self, model_no_cache):
        """With _prompt_caching=False, no cache_control is injected."""
        payload = model_no_cache._get_request_payload(self._build_input())

        system = payload.get("system")
        if isinstance(system, list):
            for block in system:
                if isinstance(block, dict):
                    assert "cache_control" not in block
        elif isinstance(system, str):
            pass  # string system has no place for cache_control — correct

    def test_eager_streaming_still_applied(self, model):
        """Prompt caching does not interfere with eager_input_streaming."""
        tool_defs = [
            {
                "name": "dummy_tool",
                "description": "A dummy tool.",
                "input_schema": {
                    "type": "object",
                    "properties": {"x": {"type": "string"}},
                },
            },
        ]
        payload = model._get_request_payload(self._build_input(), tools=tool_defs)

        tools = payload.get("tools", [])
        for t in tools:
            if isinstance(t, dict) and "input_schema" in t:
                assert t.get("eager_input_streaming") is True

    def test_effort_still_applied(self):
        """Prompt caching does not interfere with output_config.effort."""
        model = _EagerToolStreamingChatAnthropic(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
        )
        model._effort = "high"
        payload = model._get_request_payload(self._build_input())

        assert payload.get("output_config") == {"effort": "high"}
        system = payload.get("system")
        assert isinstance(system, list)
        assert system[0].get("cache_control") == _CACHE_CONTROL_EPHEMERAL
