"""Tests for recursion limit behavior and agent creation compatibility.

Verifies:
- Agent creation succeeds with deepagents 0.4.x API (no backend parameter)
- recursion_limit is correctly applied via with_config()
- Config validator thresholds are correct
- Sandbox platform tools are created when sandbox_config is provided
- recursion_limit value is preserved through LangGraph's merge_configs
- Custom recursion_limit flows through create_deep_agent to with_config
- budget_warning_pct validation in AgentConfig
"""

import warnings
from unittest.mock import MagicMock, patch

import pytest

from graphton.core.config import AgentConfig

# =============================================================================
# TestRecursionLimitValidator - Config validator behavior
# =============================================================================


class TestRecursionLimitValidator:
    """Tests for recursion_limit validation in AgentConfig."""

    def test_valid_recursion_limit(self):
        """Test that platform default (6000) is accepted without warning."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            config = AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                recursion_limit=6000,
            )
            recursion_warnings = [
                x for x in w if "recursion_limit" in str(x.message)
            ]
            assert config.recursion_limit == 6000
            assert len(recursion_warnings) == 0

    def test_low_recursion_limit(self):
        """Test that low positive values are accepted without warning."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            config = AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                recursion_limit=50,
            )
            recursion_warnings = [
                x for x in w if "recursion_limit" in str(x.message)
            ]
            assert config.recursion_limit == 50
            assert len(recursion_warnings) == 0

    def test_zero_recursion_limit_raises(self):
        """Test that zero recursion_limit raises ValueError."""
        with pytest.raises(ValueError, match="recursion_limit must be positive"):
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                recursion_limit=0,
            )

    def test_negative_recursion_limit_raises(self):
        """Test that negative recursion_limit raises ValueError."""
        with pytest.raises(ValueError, match="recursion_limit must be positive"):
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                recursion_limit=-10,
            )

    def test_very_high_recursion_limit_warns(self):
        """Test that recursion_limit > 30000 generates a warning."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            config = AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                recursion_limit=30001,
            )
            recursion_warnings = [
                x for x in w if "recursion_limit" in str(x.message)
            ]
            assert config.recursion_limit == 30001
            assert len(recursion_warnings) == 1
            assert "very high" in str(recursion_warnings[0].message)

    def test_boundary_30000_no_warning(self):
        """Test that recursion_limit=30000 does NOT generate a warning."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            config = AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                recursion_limit=30000,
            )
            recursion_warnings = [
                x for x in w if "recursion_limit" in str(x.message)
            ]
            assert config.recursion_limit == 30000
            assert len(recursion_warnings) == 0

    def test_boundary_30001_warns(self):
        """Test that recursion_limit=30001 generates a warning."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                recursion_limit=30001,
            )
            recursion_warnings = [
                x for x in w if "recursion_limit" in str(x.message)
            ]
            assert len(recursion_warnings) == 1


# =============================================================================
# TestAgentCreation - Agent creation with deepagents 0.4.x
# =============================================================================


class TestAgentCreation:
    """Tests for create_deep_agent compatibility with deepagents 0.4.x."""

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_backend_none_without_sandbox(self, mock_parse, mock_create):
        """Verify backend=None when no sandbox_config is provided.

        Without a sandbox, there is no backend to adapt, so graphton
        passes ``backend=None`` letting deepagents use its default
        StateBackend.  When sandbox_config IS provided, graphton wraps
        the backend in a DeepAgentsBackendAdapter so that deepagents'
        FilesystemMiddleware recognises the execute capability and does
        not strip the execute tool.
        """
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            recursion_limit=6000,
        )

        mock_create.assert_called_once()
        call_kwargs = mock_create.call_args.kwargs
        assert call_kwargs.get("backend") is None, (
            "backend must be None when no sandbox_config is provided "
            f"(found: {call_kwargs.get('backend')})"
        )

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_recursion_limit_applied_via_with_config(self, mock_parse, mock_create):
        """Verify recursion_limit is applied via with_config on the returned graph."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            recursion_limit=6000,
        )

        mock_agent.with_config.assert_called_once_with({"recursion_limit": 6000})

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_subagents_passed_directly(self, mock_parse, mock_create):
        """Verify subagents are passed directly without general_purpose_agent gating."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        test_subagents = [
            {"name": "researcher", "description": "Research agent", "system_prompt": "Research."}
        ]

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            subagents=test_subagents,
            general_purpose_agent=False,
        )

        call_kwargs = mock_create.call_args.kwargs
        assert call_kwargs["subagents"] == test_subagents, (
            "Subagents should be passed directly to deepagents regardless of "
            "general_purpose_agent setting"
        )

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_none_subagents_becomes_empty_list(self, mock_parse, mock_create):
        """Verify None subagents is converted to empty list for deepagents."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            subagents=None,
        )

        call_kwargs = mock_create.call_args.kwargs
        assert call_kwargs["subagents"] == [], (
            "None subagents should be converted to empty list"
        )


# =============================================================================
# TestSandboxToolCreation - Platform tool wrapper creation
# =============================================================================


class TestSandboxToolCreation:
    """Tests for sandbox platform tool creation in create_deep_agent."""

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    @patch("graphton.core.tool_wrappers.create_platform_tool_wrappers")
    def test_sandbox_tools_created_with_approval(
        self, mock_wrappers, mock_sandbox, mock_parse, mock_create
    ):
        """Verify platform tools are created when sandbox_config and approval_checker provided."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent
        mock_backend = MagicMock()
        mock_sandbox.return_value = mock_backend
        mock_tools = [MagicMock(), MagicMock()]
        mock_wrappers.return_value = mock_tools
        mock_checker = MagicMock()

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            sandbox_config={"type": "filesystem", "root_dir": "/tmp"},
            approval_checker=mock_checker,
        )

        mock_sandbox.assert_called_once_with(
            {"type": "filesystem", "root_dir": "/tmp"}
        )
        mock_wrappers.assert_called_once_with(
            backend=mock_backend,
            approval_checker=mock_checker,
        )

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    @patch("graphton.core.tool_wrappers.create_platform_tool_wrappers")
    def test_sandbox_tools_created_without_approval(
        self, mock_wrappers, mock_sandbox, mock_parse, mock_create
    ):
        """Verify platform tools are created even WITHOUT approval_checker."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent
        mock_backend = MagicMock()
        mock_sandbox.return_value = mock_backend
        mock_tools = [MagicMock()]
        mock_wrappers.return_value = mock_tools

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            sandbox_config={"type": "filesystem", "root_dir": "/tmp"},
            # No approval_checker
        )

        mock_wrappers.assert_called_once_with(
            backend=mock_backend,
            approval_checker=None,
        )


# =============================================================================
# TestRecursionLimitMergeConfigs - LangGraph config behavior
# =============================================================================


class TestRecursionLimitMergeConfigs:
    """Tests verifying LangGraph's merge_configs behavior with recursion_limit.

    These tests document the known behavior where LangGraph's merge_configs
    has special handling for recursion_limit. The exact behavior depends on
    the langgraph version (DEFAULT_RECURSION_LIMIT changed from 25 to 10,000
    in langgraph 1.0.8). Our platform default of 1000 is preserved in all
    versions because it is never equal to either default.
    """

    def test_platform_value_preserved(self):
        """Verify recursion_limit=6000 survives LangGraph's merge_configs.

        This is the most important test: the platform's default value of
        6000 must be preserved regardless of what DEFAULT_RECURSION_LIMIT is.
        """
        from langgraph._internal._config import merge_configs

        result = merge_configs({"configurable": {}}, {"recursion_limit": 6000})
        assert result.get("recursion_limit") == 6000, (
            "recursion_limit=6000 must be preserved by merge_configs "
            "(only DEFAULT_RECURSION_LIMIT is stripped)"
        )

    def test_default_recursion_limit_exists(self):
        """Verify DEFAULT_RECURSION_LIMIT is accessible and positive."""
        from langgraph._internal._config import DEFAULT_RECURSION_LIMIT

        assert isinstance(DEFAULT_RECURSION_LIMIT, int)
        assert DEFAULT_RECURSION_LIMIT > 0, (
            "DEFAULT_RECURSION_LIMIT should be a positive integer"
        )

    def test_default_value_is_stripped(self):
        """Document that the default value is stripped by merge_configs.

        LangGraph's merge_configs treats the default recursion_limit as
        'no override' and strips it from the merged config. This is
        intentional behavior to avoid storing redundant defaults.
        """
        from langgraph._internal._config import DEFAULT_RECURSION_LIMIT, merge_configs

        result = merge_configs(
            {"configurable": {}},
            {"recursion_limit": DEFAULT_RECURSION_LIMIT},
        )
        assert "recursion_limit" not in result, (
            f"recursion_limit={DEFAULT_RECURSION_LIMIT} (the default) should be "
            "stripped by merge_configs"
        )

    def test_non_default_values_preserved(self):
        """Verify that non-default recursion_limit values are preserved."""
        from langgraph._internal._config import DEFAULT_RECURSION_LIMIT, merge_configs

        # Test several values that are NOT the default
        for value in [50, 100, 500, 1000, 6000]:
            if value == DEFAULT_RECURSION_LIMIT:
                continue
            result = merge_configs(
                {"configurable": {}}, {"recursion_limit": value}
            )
            assert result.get("recursion_limit") == value, (
                f"recursion_limit={value} should be preserved "
                f"(DEFAULT_RECURSION_LIMIT={DEFAULT_RECURSION_LIMIT})"
            )


# =============================================================================
# TestCustomRecursionLimit - Custom recursion_limit via create_deep_agent
# =============================================================================


class TestCustomRecursionLimit:
    """Tests for passing custom recursion_limit through create_deep_agent.

    This verifies the D1 flow: ExecutionConfig.max_tool_rounds is converted
    to recursion_limit in the orchestrator and passed to create_deep_agent(),
    which applies it via with_config().
    """

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_custom_limit_applied_via_with_config(self, mock_parse, mock_create):
        """Custom recursion_limit is forwarded to with_config."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            recursion_limit=200,
        )

        mock_agent.with_config.assert_called_once_with({"recursion_limit": 200})

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_max_tool_rounds_mapping(self, mock_parse, mock_create):
        """Simulates the orchestrator's max_tool_rounds -> recursion_limit mapping.

        max_tool_rounds=75 -> recursion_limit=450 (75 * 6).
        """
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        recursion_limit = 75 * 6  # max_tool_rounds=75
        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            recursion_limit=recursion_limit,
        )

        mock_agent.with_config.assert_called_once_with({"recursion_limit": 450})

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_minimum_tool_rounds_mapping(self, mock_parse, mock_create):
        """Simulates minimum max_tool_rounds=10 -> recursion_limit=60."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            recursion_limit=60,
        )

        mock_agent.with_config.assert_called_once_with({"recursion_limit": 60})

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_maximum_tool_rounds_mapping(self, mock_parse, mock_create):
        """Simulates maximum max_tool_rounds=1000 -> recursion_limit=6000."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            recursion_limit=6000,
        )

        mock_agent.with_config.assert_called_once_with({"recursion_limit": 6000})


# =============================================================================
# TestBudgetWarningPctValidator - budget_warning_pct in AgentConfig
# =============================================================================


class TestBudgetWarningPctValidator:
    """Tests for budget_warning_pct validation in AgentConfig."""

    def test_default_budget_warning_pct(self):
        """Default budget_warning_pct is 80."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
        )
        assert config.budget_warning_pct == 80

    def test_valid_custom_pct(self):
        """Custom budget_warning_pct within range is accepted."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            budget_warning_pct=90,
        )
        assert config.budget_warning_pct == 90

    def test_pct_below_50_raises(self):
        """budget_warning_pct below 50 is rejected."""
        with pytest.raises(ValueError, match="budget_warning_pct must be between"):
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                budget_warning_pct=49,
            )

    def test_pct_above_95_raises(self):
        """budget_warning_pct above 95 is rejected."""
        with pytest.raises(ValueError, match="budget_warning_pct must be between"):
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                budget_warning_pct=96,
            )

    def test_pct_at_boundary_50(self):
        """budget_warning_pct=50 is accepted (lower boundary)."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            budget_warning_pct=50,
        )
        assert config.budget_warning_pct == 50

    def test_pct_at_boundary_95(self):
        """budget_warning_pct=95 is accepted (upper boundary)."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            budget_warning_pct=95,
        )
        assert config.budget_warning_pct == 95
