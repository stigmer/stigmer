"""Tests for per-sub-agent model routing in the HITL compilation path.

The HITL path in ``create_deep_agent`` compiles each sub-agent via
``compile_subagent``.  When a sub-agent dict carries a ``"model"`` key,
the HITL path must resolve it (via ``parse_model_string`` for strings)
and pass the resolved instance — not the parent's model — to
``compile_subagent``.

Tests:
- Sub-agent with ``"model"`` string: resolved via ``parse_model_string``,
  override instance passed to ``compile_subagent``.
- Sub-agent with ``"model"`` as a ``BaseChatModel`` instance: used directly.
- Sub-agent without ``"model"``: parent model used (regression guard).
- Mixed list: each sub-agent gets the correct model.
"""

from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_subagent_dict(name: str, *, model=None):
    """Build a minimal sub-agent dict compatible with create_deep_agent."""
    d: dict = {
        "name": name,
        "description": f"Sub-agent: {name}",
        "system_prompt": f"You are {name}.",
        "tools": [],
    }
    if model is not None:
        d["model"] = model
    return d


def _stub_create_deep_agent(mock_parse_model, mock_compile_proxy, mock_deepagents_create):
    """Wire up the common mock scaffolding for create_deep_agent calls."""
    mock_parent_model = MagicMock(name="parent-model-instance")
    mock_parse_model.return_value = mock_parent_model

    mock_compile_proxy.return_value = {
        "name": "stub",
        "description": "stub",
        "runnable": MagicMock(),
    }

    mock_graph = MagicMock()
    mock_graph.with_config.return_value = mock_graph
    mock_deepagents_create.return_value = mock_graph

    return mock_parent_model


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSubagentModelRouting:
    """HITL path: per-sub-agent model override in create_deep_agent."""

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.interrupt_proxy.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    def test_string_model_override_resolved_via_parse_model_string(
        self,
        mock_parse_model,
        mock_compile_proxy,
        mock_deepagents_create,
    ):
        """A sub-agent with model='claude-haiku-4.5' triggers a second
        parse_model_string call, and the result is passed to
        compile_subagent instead of the parent model."""
        from graphton.core.agent import create_deep_agent

        mock_parent = MagicMock(name="parent-model")
        mock_override = MagicMock(name="override-model")

        # First call: parent model.  Second call: sub-agent override.
        mock_parse_model.side_effect = [mock_parent, mock_override]

        mock_compile_proxy.return_value = {
            "name": "x", "description": "x", "runnable": MagicMock(),
        }
        mock_graph = MagicMock()
        mock_graph.with_config.return_value = mock_graph
        mock_deepagents_create.return_value = mock_graph

        create_deep_agent(
            model="claude-sonnet-4",
            system_prompt="Parent prompt",
            subagents=[_make_subagent_dict("searcher", model="claude-haiku-4.5")],
            checkpointer=MagicMock(),
            approval_checker=MagicMock(),
        )

        # parse_model_string called twice: once for parent, once for override
        assert mock_parse_model.call_count == 2
        override_call = mock_parse_model.call_args_list[1]
        assert override_call.kwargs["model"] == "claude-haiku-4.5"

        # First compile call is the explicit sub-agent with override model.
        # Last call is the auto-injected general-purpose sub-agent.
        explicit_call = mock_compile_proxy.call_args_list[0]
        assert explicit_call.kwargs["model"] is mock_override

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.interrupt_proxy.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    def test_model_instance_used_directly(
        self,
        mock_parse_model,
        mock_compile_proxy,
        mock_deepagents_create,
    ):
        """A sub-agent with a pre-built BaseChatModel instance skips
        parse_model_string and is passed directly to compile."""
        from graphton.core.agent import create_deep_agent

        _stub_create_deep_agent(
            mock_parse_model, mock_compile_proxy, mock_deepagents_create,
        )

        pre_built = MagicMock(name="pre-built-haiku")
        create_deep_agent(
            model="claude-sonnet-4",
            system_prompt="Parent prompt",
            subagents=[_make_subagent_dict("searcher", model=pre_built)],
            checkpointer=MagicMock(),
            approval_checker=MagicMock(),
        )

        # parse_model_string called only once (for parent)
        assert mock_parse_model.call_count == 1

        # First compile call is the explicit sub-agent with pre-built model.
        explicit_call = mock_compile_proxy.call_args_list[0]
        assert explicit_call.kwargs["model"] is pre_built

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.interrupt_proxy.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    def test_no_model_key_uses_parent_model(
        self,
        mock_parse_model,
        mock_compile_proxy,
        mock_deepagents_create,
    ):
        """Without a 'model' key, the sub-agent inherits the parent's model."""
        from graphton.core.agent import create_deep_agent

        mock_parent = _stub_create_deep_agent(
            mock_parse_model, mock_compile_proxy, mock_deepagents_create,
        )

        create_deep_agent(
            model="claude-sonnet-4",
            system_prompt="Parent prompt",
            subagents=[_make_subagent_dict("reviewer")],  # no model key
            checkpointer=MagicMock(),
            approval_checker=MagicMock(),
        )

        # parse_model_string called only once (for parent)
        assert mock_parse_model.call_count == 1

        # First compile call is the explicit sub-agent with parent model.
        explicit_call = mock_compile_proxy.call_args_list[0]
        assert explicit_call.kwargs["model"] is mock_parent

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.interrupt_proxy.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    def test_mixed_subagents_each_get_correct_model(
        self,
        mock_parse_model,
        mock_compile_proxy,
        mock_deepagents_create,
    ):
        """A list with both override and non-override sub-agents routes
        the correct model to each."""
        from graphton.core.agent import create_deep_agent

        mock_parent = MagicMock(name="parent")
        mock_haiku = MagicMock(name="haiku-override")

        # Call 1: parent model.  Call 2: haiku override.
        mock_parse_model.side_effect = [mock_parent, mock_haiku]

        mock_compile_proxy.return_value = {
            "name": "x", "description": "x", "runnable": MagicMock(),
        }
        mock_graph = MagicMock()
        mock_graph.with_config.return_value = mock_graph
        mock_deepagents_create.return_value = mock_graph

        create_deep_agent(
            model="claude-sonnet-4",
            system_prompt="Parent prompt",
            subagents=[
                _make_subagent_dict("reviewer"),  # inherits parent
                _make_subagent_dict("searcher", model="claude-haiku-4.5"),
            ],
            checkpointer=MagicMock(),
            approval_checker=MagicMock(),
        )

        # 2 explicit + 1 general-purpose = 3 compile calls
        assert mock_compile_proxy.call_count == 3

        # First sub-agent: parent model
        first_call = mock_compile_proxy.call_args_list[0]
        assert first_call.kwargs["model"] is mock_parent

        # Second sub-agent: override model
        second_call = mock_compile_proxy.call_args_list[1]
        assert second_call.kwargs["model"] is mock_haiku

        # Third (auto-injected general-purpose): parent model
        gp_call = mock_compile_proxy.call_args_list[2]
        assert gp_call.kwargs["name"] == "general-purpose"
        assert gp_call.kwargs["model"] is mock_parent
