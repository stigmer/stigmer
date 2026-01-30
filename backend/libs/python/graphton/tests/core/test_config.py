"""Unit tests for agent configuration validation.

Tests cover:
- Loop detection parameter validation
- Loop threshold relationship validation
- Integration with existing validators
"""

import pytest
import warnings

from graphton.core.config import AgentConfig


# =============================================================================
# TestLoopHistorySizeValidation - Tests for loop_history_size validation
# =============================================================================


class TestLoopHistorySizeValidation:
    """Tests for loop_history_size parameter validation."""

    def test_valid_history_size(self):
        """Test that valid history sizes are accepted."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            loop_history_size=20,
        )
        assert config.loop_history_size == 20

    def test_minimum_history_size(self):
        """Test that minimum history size (5) is accepted."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            loop_history_size=5,
        )
        assert config.loop_history_size == 5

    def test_history_size_too_small_raises(self):
        """Test that history size < 5 raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                loop_history_size=4,
            )
        assert "loop_history_size" in str(exc_info.value)
        assert "at least 5" in str(exc_info.value)

    def test_history_size_zero_raises(self):
        """Test that history size of 0 raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                loop_history_size=0,
            )
        assert "loop_history_size" in str(exc_info.value)

    def test_history_size_negative_raises(self):
        """Test that negative history size raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                loop_history_size=-10,
            )
        assert "loop_history_size" in str(exc_info.value)

    def test_high_history_size_warns(self):
        """Test that high history size (>100) issues warning."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                loop_history_size=150,
            )
            # Check that a warning was issued
            assert len(w) >= 1
            assert any("loop_history_size" in str(warning.message).lower() for warning in w)


# =============================================================================
# TestLoopConsecutiveThresholdValidation - Tests for consecutive threshold
# =============================================================================


class TestLoopConsecutiveThresholdValidation:
    """Tests for loop_consecutive_threshold parameter validation."""

    def test_valid_consecutive_threshold(self):
        """Test that valid consecutive thresholds are accepted."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            loop_consecutive_threshold=7,
        )
        assert config.loop_consecutive_threshold == 7

    def test_minimum_consecutive_threshold(self):
        """Test that minimum consecutive threshold (2) is accepted."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            loop_consecutive_threshold=2,
        )
        assert config.loop_consecutive_threshold == 2

    def test_consecutive_threshold_too_small_raises(self):
        """Test that consecutive threshold < 2 raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                loop_consecutive_threshold=1,
            )
        assert "loop_consecutive_threshold" in str(exc_info.value)
        assert "at least 2" in str(exc_info.value)

    def test_consecutive_threshold_zero_raises(self):
        """Test that consecutive threshold of 0 raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                loop_consecutive_threshold=0,
            )
        assert "loop_consecutive_threshold" in str(exc_info.value)

    def test_high_consecutive_threshold_warns(self):
        """Test that high consecutive threshold (>20) issues warning."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                loop_consecutive_threshold=25,
                loop_total_threshold=30,  # Must be >= consecutive
            )
            # Check that a warning was issued
            assert len(w) >= 1
            assert any("loop_consecutive_threshold" in str(warning.message).lower() for warning in w)


# =============================================================================
# TestLoopTotalThresholdValidation - Tests for total threshold
# =============================================================================


class TestLoopTotalThresholdValidation:
    """Tests for loop_total_threshold parameter validation."""

    def test_valid_total_threshold(self):
        """Test that valid total thresholds are accepted."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            loop_total_threshold=20,
        )
        assert config.loop_total_threshold == 20

    def test_minimum_total_threshold(self):
        """Test that minimum total threshold (3) is accepted."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            loop_consecutive_threshold=2,  # Must be <= total
            loop_total_threshold=3,
        )
        assert config.loop_total_threshold == 3

    def test_total_threshold_too_small_raises(self):
        """Test that total threshold < 3 raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                loop_consecutive_threshold=2,
                loop_total_threshold=2,
            )
        assert "loop_total_threshold" in str(exc_info.value)
        assert "at least 3" in str(exc_info.value)

    def test_total_threshold_zero_raises(self):
        """Test that total threshold of 0 raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                loop_total_threshold=0,
            )
        assert "loop_total_threshold" in str(exc_info.value)

    def test_high_total_threshold_warns(self):
        """Test that high total threshold (>100) issues warning."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                loop_total_threshold=150,
            )
            # Check that a warning was issued
            assert len(w) >= 1
            assert any("loop_total_threshold" in str(warning.message).lower() for warning in w)


# =============================================================================
# TestLoopThresholdRelationship - Tests for threshold relationship validation
# =============================================================================


class TestLoopThresholdRelationship:
    """Tests for loop threshold relationship validation."""

    def test_total_greater_than_consecutive_valid(self):
        """Test that total > consecutive is valid."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            loop_consecutive_threshold=5,
            loop_total_threshold=10,
        )
        assert config.loop_total_threshold > config.loop_consecutive_threshold

    def test_total_equals_consecutive_valid(self):
        """Test that total == consecutive is valid."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            loop_consecutive_threshold=5,
            loop_total_threshold=5,
        )
        assert config.loop_total_threshold == config.loop_consecutive_threshold

    def test_total_less_than_consecutive_raises(self):
        """Test that total < consecutive raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            AgentConfig(
                model="gpt-4",
                system_prompt="Test assistant.",
                loop_consecutive_threshold=10,
                loop_total_threshold=5,
            )
        assert "loop_total_threshold" in str(exc_info.value)
        assert "loop_consecutive_threshold" in str(exc_info.value)
        assert ">=" in str(exc_info.value)


# =============================================================================
# TestDefaultValues - Tests for default loop detection values
# =============================================================================


class TestDefaultValues:
    """Tests for default loop detection parameter values."""

    def test_default_history_size(self):
        """Test that default history size is 20."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
        )
        assert config.loop_history_size == 20

    def test_default_consecutive_threshold(self):
        """Test that default consecutive threshold is 7."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
        )
        assert config.loop_consecutive_threshold == 7

    def test_default_total_threshold(self):
        """Test that default total threshold is 20."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
        )
        assert config.loop_total_threshold == 20

    def test_defaults_satisfy_relationship(self):
        """Test that default values satisfy the threshold relationship."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
        )
        assert config.loop_total_threshold >= config.loop_consecutive_threshold


# =============================================================================
# TestIntegrationWithExistingValidation - Tests for integration
# =============================================================================


class TestIntegrationWithExistingValidation:
    """Tests for integration with existing validators."""

    def test_loop_params_with_mcp_config(self):
        """Test loop parameters work with MCP configuration."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            mcp_servers={"test": {"url": "http://localhost"}},
            mcp_tools={"test": ["tool1"]},
            loop_history_size=15,
            loop_consecutive_threshold=5,
            loop_total_threshold=15,
        )
        assert config.loop_history_size == 15
        assert config.loop_consecutive_threshold == 5
        assert config.loop_total_threshold == 15

    def test_loop_params_with_sandbox_config(self):
        """Test loop parameters work with sandbox configuration."""
        config = AgentConfig(
            model="gpt-4",
            system_prompt="Test assistant.",
            sandbox_config={"type": "filesystem", "root_dir": "/tmp"},
            loop_history_size=25,
            loop_consecutive_threshold=8,
            loop_total_threshold=25,
        )
        assert config.loop_history_size == 25
        assert config.sandbox_config["type"] == "filesystem"

    def test_all_validators_run(self):
        """Test that all validators run together."""
        # This should validate system_prompt, recursion_limit, AND loop params
        with pytest.raises(ValueError) as exc_info:
            AgentConfig(
                model="gpt-4",
                system_prompt="",  # Invalid
            )
        assert "system_prompt" in str(exc_info.value)
