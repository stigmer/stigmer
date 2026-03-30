"""Tests for recursion limit behavior and agent creation compatibility.

Verifies:
- Agent creation succeeds with deepagents 0.4.x API (no backend parameter)
- recursion_limit=None (default) skips with_config override
- Explicit recursion_limit is applied via with_config()
- Config validator accepts None and positive integers
- Sandbox platform tools are created when sandbox_config is provided
- Explicit recursion_limit values are preserved through LangGraph's merge_configs
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

    def test_default_is_none(self):
        """Test that the default recursion_limit is None (unlimited)."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
        )
        assert config.recursion_limit is None

    def test_explicit_positive_value_accepted(self):
        """Test that explicit positive values are accepted."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            recursion_limit=6000,
        )
        assert config.recursion_limit == 6000

    def test_low_recursion_limit(self):
        """Test that low positive values are accepted."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            recursion_limit=50,
        )
        assert config.recursion_limit == 50

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

    def test_very_high_value_accepted(self):
        """Test that very high values are accepted without warning."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            config = AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                recursion_limit=100000,
            )
            recursion_warnings = [
                x for x in w if "recursion_limit" in str(x.message)
            ]
            assert config.recursion_limit == 100000
            assert len(recursion_warnings) == 0


# =============================================================================
# TestAgentCreation - Agent creation with deepagents 0.4.x
# =============================================================================


class TestAgentCreation:
    """Tests for create_deep_agent compatibility with deepagents 0.4.x."""

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_backend_none_without_sandbox(self, mock_parse, mock_create):
        """Verify backend=None when no sandbox_config is provided."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
        )

        mock_create.assert_called_once()
        call_kwargs = mock_create.call_args.kwargs
        assert call_kwargs.get("backend") is None, (
            "backend must be None when no sandbox_config is provided "
            f"(found: {call_kwargs.get('backend')})"
        )

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_default_none_uses_unlimited(self, mock_parse, mock_create):
        """Verify recursion_limit=None (default) sets 10M (effectively unlimited).

        We must always call with_config because deepagents internally sets
        its own recursion_limit which would otherwise impose a lower ceiling.
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
        )

        mock_agent.with_config.assert_called_once_with({"recursion_limit": 10_000_000})

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_explicit_limit_calls_with_config(self, mock_parse, mock_create):
        """Verify explicit recursion_limit IS applied via with_config."""
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
    def test_subagents_passed_directly_non_hitl(self, mock_parse, mock_create):
        """Verify subagents are passed through in non-HITL path (no checkpointer)."""
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
        )

        call_kwargs = mock_create.call_args.kwargs
        assert call_kwargs["subagents"] == test_subagents, (
            "Subagents should be passed directly to deepagents in non-HITL path"
        )

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_general_purpose_agent_not_forwarded_to_deepagents(self, mock_parse, mock_create):
        """Verify general_purpose_agent is never forwarded to deepagents."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            general_purpose_agent=False,
        )

        call_kwargs = mock_create.call_args.kwargs
        assert "general_purpose_agent" not in call_kwargs, (
            "general_purpose_agent must not be forwarded to deepagents — "
            "the parameter does not exist in deepagents' create_deep_agent"
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
    has special handling for recursion_limit. Explicit values (from
    max_tool_rounds) must survive merge_configs to take effect.
    """

    def test_explicit_value_preserved(self):
        """Verify explicit recursion_limit values survive merge_configs."""
        from langgraph._internal._config import merge_configs

        result = merge_configs({"configurable": {}}, {"recursion_limit": 6000})
        assert result.get("recursion_limit") == 6000

    def test_default_recursion_limit_exists(self):
        """Verify DEFAULT_RECURSION_LIMIT is accessible and positive."""
        from langgraph._internal._config import DEFAULT_RECURSION_LIMIT

        assert isinstance(DEFAULT_RECURSION_LIMIT, int)
        assert DEFAULT_RECURSION_LIMIT > 0

    def test_default_value_is_stripped(self):
        """Document that the default value is stripped by merge_configs.

        LangGraph's merge_configs treats the default recursion_limit as
        'no override' and strips it from the merged config. This is why
        we skip with_config entirely when unlimited (None) — rather than
        passing DEFAULT_RECURSION_LIMIT which would get stripped.
        """
        from langgraph._internal._config import DEFAULT_RECURSION_LIMIT, merge_configs

        result = merge_configs(
            {"configurable": {}},
            {"recursion_limit": DEFAULT_RECURSION_LIMIT},
        )
        assert "recursion_limit" not in result

    def test_non_default_values_preserved(self):
        """Verify that non-default recursion_limit values are preserved."""
        from langgraph._internal._config import DEFAULT_RECURSION_LIMIT, merge_configs

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


# =============================================================================
# TestGatedGeneralPurposeSubAgent - General-purpose sub-agent injection
# =============================================================================


class TestGatedGeneralPurposeSubAgent:
    """Tests for the gated general-purpose sub-agent injection in create_deep_agent.

    When a checkpointer AND approval_checker are both present (HITL path),
    graphton injects an explicit CompiledSubAgent named "general-purpose"
    compiled through compile_subagent and wrapped with
    SubAgentGate.  This overrides deepagents' automatic ungated clone.
    """

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.subagent.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    def test_hitl_no_explicit_subagents_injects_general_purpose(
        self, mock_parse, mock_compile, mock_create
    ):
        """HITL path with subagents=None injects a single 'general-purpose' CompiledSubAgent."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        mock_runnable = MagicMock()
        mock_compile.return_value = {
            "name": "general-purpose",
            "description": "GP",
            "runnable": mock_runnable,
        }

        mock_checkpointer = MagicMock()
        mock_checker = MagicMock()

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            subagents=None,
            checkpointer=mock_checkpointer,
            approval_checker=mock_checker,
        )

        mock_compile.assert_called_once()
        compile_kwargs = mock_compile.call_args.kwargs
        assert compile_kwargs["name"] == "general-purpose"

        call_kwargs = mock_create.call_args.kwargs
        subagents_passed = call_kwargs["subagents"]
        assert len(subagents_passed) == 1
        assert subagents_passed[0]["name"] == "general-purpose"
        # Runnable should be gate-wrapped (not the original mock_runnable)
        assert subagents_passed[0]["runnable"] is not mock_runnable

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.subagent.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    def test_hitl_with_explicit_subagents_appends_general_purpose(
        self, mock_parse, mock_compile, mock_create
    ):
        """HITL path with explicit sub-agents appends 'general-purpose' alongside them."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        call_count = [0]
        def compile_side_effect(**kwargs):
            call_count[0] += 1
            return {
                "name": kwargs["name"],
                "description": kwargs["description"],
                "runnable": MagicMock(),
            }
        mock_compile.side_effect = compile_side_effect

        mock_checkpointer = MagicMock()
        mock_checker = MagicMock()
        test_subagents = [
            {"name": "researcher", "description": "Research agent", "system_prompt": "Research."}
        ]

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            subagents=test_subagents,
            checkpointer=mock_checkpointer,
            approval_checker=mock_checker,
        )

        assert mock_compile.call_count == 2
        call_kwargs = mock_create.call_args.kwargs
        subagents_passed = call_kwargs["subagents"]
        assert len(subagents_passed) == 2
        names = [sa["name"] for sa in subagents_passed]
        assert "researcher" in names
        assert "general-purpose" in names

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.agent.parse_model_string")
    def test_non_hitl_path_no_injection(self, mock_parse, mock_create):
        """Non-HITL path (no checkpointer) does not inject general-purpose sub-agent."""
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
        )

        call_kwargs = mock_create.call_args.kwargs
        subagents_passed = call_kwargs["subagents"]
        names = [sa["name"] for sa in subagents_passed]
        assert "general-purpose" not in names
        assert subagents_passed == test_subagents

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.subagent.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    def test_general_purpose_agent_false_skips_injection(
        self, mock_parse, mock_compile, mock_create
    ):
        """general_purpose_agent=False in HITL path does not inject general-purpose sub-agent."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        mock_checkpointer = MagicMock()
        mock_checker = MagicMock()

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            subagents=None,
            checkpointer=mock_checkpointer,
            approval_checker=mock_checker,
            general_purpose_agent=False,
        )

        mock_compile.assert_not_called()
        call_kwargs = mock_create.call_args.kwargs
        subagents_passed = call_kwargs["subagents"]
        assert len(subagents_passed) == 0

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.subagent.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    def test_general_purpose_uses_main_agent_model_and_scoped_prompt(
        self, mock_parse, mock_compile, mock_create
    ):
        """General-purpose sub-agent uses the main agent's model and a scoped prompt.

        The GP sub-agent's system prompt is derived from the parent's prompt
        but stripped of skills metadata and sub-agent delegation rules, and
        prepended with a scope-boundary preamble to prevent scope violations.
        """
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent
        mock_compile.return_value = {
            "name": "general-purpose",
            "description": "GP",
            "runnable": MagicMock(),
        }

        mock_checkpointer = MagicMock()
        mock_checker = MagicMock()

        create_deep_agent(
            model="gpt-4",
            system_prompt="You are a helpful coding assistant.",
            subagents=None,
            checkpointer=mock_checkpointer,
            approval_checker=mock_checker,
        )

        compile_kwargs = mock_compile.call_args.kwargs
        assert compile_kwargs["model"] is mock_model
        gp_prompt = compile_kwargs["system_prompt"]
        assert "You are a delegated sub-agent" in gp_prompt
        assert "You are a helpful coding assistant." in gp_prompt
        assert compile_kwargs["name"] == "general-purpose"

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.subagent.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    def test_general_purpose_prompt_strips_skills_and_delegation_rules(
        self, mock_parse, mock_compile, mock_create
    ):
        """GP sub-agent prompt excludes skills metadata and delegation rules."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent
        mock_compile.return_value = {
            "name": "general-purpose",
            "description": "GP",
            "runnable": MagicMock(),
        }

        prompt_with_skills = (
            "You are a helpful assistant."
            "\n\n## Workspace\n\nworkspace info"
            "\n\n## Available Skills\n\n"
            "The following skills are pre-installed.\n\n"
            "### skill-creator\n"
            "**Description**: Creates skills\n"
            "**Location**: `.stigmer/skills/skill-creator/`\n"
            "**Activate**: `read .stigmer/skills/skill-creator/SKILL.md`\n"
            "\n\n## Response rules\n\n- Be concise"
            "\n\n## Sub-agent delegation rules\n\n"
            "### Concurrency limit\n\n"
            "Do NOT spawn more than 3 sub-agents."
        )

        create_deep_agent(
            model="gpt-4",
            system_prompt=prompt_with_skills,
            subagents=None,
            checkpointer=MagicMock(),
            approval_checker=MagicMock(),
        )

        gp_prompt = mock_compile.call_args.kwargs["system_prompt"]
        assert "## Available Skills" not in gp_prompt
        assert "skill-creator" not in gp_prompt
        assert "Activate" not in gp_prompt
        assert "## Sub-agent delegation rules" not in gp_prompt
        assert "Concurrency limit" not in gp_prompt
        assert "## Workspace" in gp_prompt
        assert "## Response rules" in gp_prompt
        assert "You are a delegated sub-agent" in gp_prompt

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.subagent.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    def test_general_purpose_shares_gate_with_explicit_subagents(
        self, mock_parse, mock_compile, mock_create
    ):
        """General-purpose sub-agent shares the same SubAgentGate as explicit sub-agents."""
        from graphton import create_deep_agent
        from graphton.core.subagent_limiter import _GatedRunnable

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        def compile_side_effect(**kwargs):
            return {
                "name": kwargs["name"],
                "description": kwargs["description"],
                "runnable": MagicMock(),
            }
        mock_compile.side_effect = compile_side_effect

        mock_checkpointer = MagicMock()
        mock_checker = MagicMock()
        test_subagents = [
            {"name": "researcher", "description": "Research agent", "system_prompt": "Research."}
        ]

        create_deep_agent(
            model="gpt-4",
            system_prompt="Test assistant.",
            subagents=test_subagents,
            checkpointer=mock_checkpointer,
            approval_checker=mock_checker,
        )

        call_kwargs = mock_create.call_args.kwargs
        subagents_passed = call_kwargs["subagents"]
        assert len(subagents_passed) == 2

        runnables = [sa["runnable"] for sa in subagents_passed]
        for r in runnables:
            assert isinstance(r, _GatedRunnable), (
                f"Expected _GatedRunnable, got {type(r).__name__}"
            )

        # Both runnables must share the same gate instance
        gates = [r._gate for r in runnables]
        assert gates[0] is gates[1], (
            "Explicit and general-purpose sub-agents must share the same SubAgentGate"
        )

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.subagent.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    @patch("graphton.core.tool_wrappers.create_platform_tool_wrappers")
    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    def test_gp_subagent_receives_platform_tools(
        self, mock_create_sandbox, mock_platform_tools,
        mock_parse, mock_compile, mock_create
    ):
        """GP sub-agent receives sandbox platform tools when sandbox_config is provided."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        mock_sandbox_backend = MagicMock()
        mock_create_sandbox.return_value = mock_sandbox_backend

        mock_read_tool = MagicMock()
        mock_write_tool = MagicMock()
        mock_platform_tools.return_value = [mock_read_tool, mock_write_tool]

        mock_compile.return_value = {
            "name": "general-purpose",
            "description": "GP",
            "runnable": MagicMock(),
        }

        with patch(
            "graphton.core.backends.deepagents_adapter.DeepAgentsBackendAdapter"
        ) as mock_adapter_cls:
            mock_adapter = MagicMock()
            mock_adapter_cls.return_value = mock_adapter
            with patch(
                "deepagents.backends.protocol.SandboxBackendProtocol",
                new=type(mock_adapter),
            ):
                create_deep_agent(
                    model="gpt-4",
                    system_prompt="Test assistant for sandbox tools.",
                    checkpointer=MagicMock(),
                    approval_checker=MagicMock(),
                    sandbox_config={"type": "filesystem", "root_dir": "/tmp"},
                )

        gp_compile_call = mock_compile.call_args
        gp_tools = gp_compile_call.kwargs["tools"]
        assert len(gp_tools) >= 2, (
            f"GP sub-agent should receive platform tools, got {len(gp_tools)}"
        )
        assert mock_read_tool in gp_tools
        assert mock_write_tool in gp_tools

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.subagent.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    @patch("graphton.core.tool_wrappers.create_platform_tool_wrappers")
    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    def test_gp_platform_tools_tagged_with_sub_agent_name(
        self, mock_create_sandbox, mock_platform_tools,
        mock_parse, mock_compile, mock_create
    ):
        """GP sub-agent's platform tools are created with sub_agent_name='general-purpose'."""
        from graphton import create_deep_agent

        mock_model = MagicMock()
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        mock_sandbox_backend = MagicMock()
        mock_create_sandbox.return_value = mock_sandbox_backend
        mock_platform_tools.return_value = [MagicMock()]

        mock_compile.return_value = {
            "name": "general-purpose",
            "description": "GP",
            "runnable": MagicMock(),
        }

        mock_checker = MagicMock()

        with patch(
            "graphton.core.backends.deepagents_adapter.DeepAgentsBackendAdapter"
        ) as mock_adapter_cls:
            mock_adapter = MagicMock()
            mock_adapter_cls.return_value = mock_adapter
            with patch(
                "deepagents.backends.protocol.SandboxBackendProtocol",
                new=type(mock_adapter),
            ):
                create_deep_agent(
                    model="gpt-4",
                    system_prompt="Test assistant for sub-agent tagging.",
                    checkpointer=MagicMock(),
                    approval_checker=mock_checker,
                    sandbox_config={"type": "filesystem", "root_dir": "/tmp"},
                )

        # create_platform_tool_wrappers is called twice:
        # 1. For the main agent (no sub_agent_name)
        # 2. For the GP sub-agent (sub_agent_name="general-purpose")
        assert mock_platform_tools.call_count == 2
        gp_call = mock_platform_tools.call_args_list[1]
        assert gp_call.kwargs.get("sub_agent_name") == "general-purpose"
        assert gp_call.kwargs.get("approval_checker") is mock_checker

    @patch("graphton.core.agent.deepagents_create_deep_agent")
    @patch("graphton.core.subagent.compile_subagent")
    @patch("graphton.core.agent.parse_model_string")
    def test_gp_subagent_skipped_when_no_tools_available(
        self, mock_parse, mock_compile, mock_create
    ):
        """GP sub-agent is skipped when no sandbox, MCP, or think tool is available."""
        from langchain_anthropic import ChatAnthropic

        from graphton import create_deep_agent

        mock_model = MagicMock(spec=ChatAnthropic)
        mock_model.thinking = {"type": "enabled", "budget_tokens": 10000}
        mock_parse.return_value = mock_model
        mock_agent = MagicMock()
        mock_agent.with_config.return_value = mock_agent
        mock_create.return_value = mock_agent

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            create_deep_agent(
                model="claude-opus-4.6",
                system_prompt="Test assistant for no-tool scenario.",
                checkpointer=MagicMock(),
                approval_checker=MagicMock(),
            )

        mock_compile.assert_not_called()
        call_kwargs = mock_create.call_args.kwargs
        subagents_passed = call_kwargs["subagents"]
        assert len(subagents_passed) == 0, (
            "GP sub-agent should not be injected without any tools"
        )
