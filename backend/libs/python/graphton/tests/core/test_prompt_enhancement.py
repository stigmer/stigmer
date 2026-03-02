"""Unit tests for prompt enhancement module.

Tests cover:
- Resilience preamble inclusion
- Capability sections (conditional)
- Error recovery strategies (conditional)
- User instructions preservation
- Structure and ordering
"""

import pytest

from graphton.core.prompt_enhancement import (
    EXECUTE_CAPABILITY,
    EXECUTION_RECOVERY_STRATEGIES,
    FILE_RECOVERY_STRATEGIES,
    FILESYSTEM_CAPABILITY,
    MCP_RECOVERY_STRATEGIES,
    MCP_TOOLS_CAPABILITY,
    PLANNING_CAPABILITY,
    RESILIENCE_PREAMBLE,
    THINK_CAPABILITY,
    enhance_user_instructions,
)

# =============================================================================
# TestResiliencePreamble - Tests for resilience preamble content
# =============================================================================


class TestResiliencePreamble:
    """Tests for the resilience preamble content."""

    def test_preamble_includes_core_principles(self):
        """Test that resilience preamble includes all core principles."""
        # Core principles that should be in the preamble
        assert "never give up on first failure" in RESILIENCE_PREAMBLE.lower()
        assert "analyze before retrying" in RESILIENCE_PREAMBLE.lower()
        assert "try alternative strategies" in RESILIENCE_PREAMBLE.lower()
        assert "validate assumptions" in RESILIENCE_PREAMBLE.lower()
        assert "read before writing" in RESILIENCE_PREAMBLE.lower()

    def test_preamble_includes_error_handling_guidance(self):
        """Test that preamble includes error handling guidance."""
        assert "when a tool returns an error" in RESILIENCE_PREAMBLE.lower()
        assert "parse the error message" in RESILIENCE_PREAMBLE.lower()
        assert "root cause" in RESILIENCE_PREAMBLE.lower()

    def test_preamble_includes_never_do_section(self):
        """Test that preamble includes what NOT to do."""
        assert "never do this" in RESILIENCE_PREAMBLE.lower()
        assert "give up after a single failure" in RESILIENCE_PREAMBLE.lower()
        assert "retry the exact same action" in RESILIENCE_PREAMBLE.lower()


# =============================================================================
# TestCapabilitySections - Tests for capability awareness sections
# =============================================================================


class TestCapabilitySections:
    """Tests for capability sections content."""

    def test_planning_capability_content(self):
        """Test planning capability section content."""
        assert "planning system" in PLANNING_CAPABILITY.lower()
        assert "write_todos" in PLANNING_CAPABILITY.lower()
        assert "read_todos" in PLANNING_CAPABILITY.lower()
        assert "complex" in PLANNING_CAPABILITY.lower() or "multi-step" in PLANNING_CAPABILITY.lower()

    def test_filesystem_capability_content(self):
        """Test file system capability section content."""
        assert "file system" in FILESYSTEM_CAPABILITY.lower()
        assert "ls" in FILESYSTEM_CAPABILITY.lower()
        assert "`read`" in FILESYSTEM_CAPABILITY
        assert "`write`" in FILESYSTEM_CAPABILITY
        assert "`edit`" in FILESYSTEM_CAPABILITY
        assert "workspace-relative" in FILESYSTEM_CAPABILITY

    def test_filesystem_capability_includes_output_discipline(self):
        """Test that file system capability includes output discipline guidance."""
        assert "output discipline" in FILESYSTEM_CAPABILITY.lower()
        assert "never echo" in FILESYSTEM_CAPABILITY.lower()
        assert "proceed directly" in FILESYSTEM_CAPABILITY.lower()

    def test_filesystem_capability_includes_context_efficiency(self):
        """Test that file system capability includes context efficiency guidance."""
        lower = FILESYSTEM_CAPABILITY.lower()
        assert "context efficiency" in lower
        assert "grep" in lower
        assert "glob" in lower
        assert "offset" in lower
        assert "limit" in lower

    def test_mcp_tools_capability_content(self):
        """Test MCP tools capability section content."""
        assert "mcp" in MCP_TOOLS_CAPABILITY.lower()
        assert "model context protocol" in MCP_TOOLS_CAPABILITY.lower()
        assert "domain-specific" in MCP_TOOLS_CAPABILITY.lower()

    def test_think_capability_content(self):
        """Test think tool capability section content."""
        assert "think" in THINK_CAPABILITY.lower()
        assert "reasoning" in THINK_CAPABILITY.lower() or "reason" in THINK_CAPABILITY.lower()
        assert "debugging" in THINK_CAPABILITY.lower() or "debug" in THINK_CAPABILITY.lower()

    def test_execute_capability_content(self):
        """Test execute tool capability section content."""
        assert "execute" in EXECUTE_CAPABILITY.lower()
        assert "sandbox" in EXECUTE_CAPABILITY.lower()
        assert "shell" in EXECUTE_CAPABILITY.lower() or "command" in EXECUTE_CAPABILITY.lower()


# =============================================================================
# TestRecoveryStrategies - Tests for error recovery strategy sections
# =============================================================================


class TestRecoveryStrategies:
    """Tests for error recovery strategy sections."""

    def test_file_recovery_includes_common_scenarios(self):
        """Test file recovery section covers common scenarios."""
        assert "cannot edit file" in FILE_RECOVERY_STRATEGIES.lower()
        assert "file not found" in FILE_RECOVERY_STRATEGIES.lower()
        assert "permission denied" in FILE_RECOVERY_STRATEGIES.lower()
        assert "read first" in FILE_RECOVERY_STRATEGIES.lower()
        assert "glob" in FILE_RECOVERY_STRATEGIES.lower()

    def test_mcp_recovery_includes_common_scenarios(self):
        """Test MCP recovery section covers common scenarios."""
        assert "authentication" in MCP_RECOVERY_STRATEGIES.lower()
        assert "invalid parameters" in MCP_RECOVERY_STRATEGIES.lower()
        assert "resource not found" in MCP_RECOVERY_STRATEGIES.lower()
        assert "rate limit" in MCP_RECOVERY_STRATEGIES.lower()
        assert "timeout" in MCP_RECOVERY_STRATEGIES.lower()

    def test_execution_recovery_includes_common_scenarios(self):
        """Test execution recovery section covers common scenarios."""
        assert "command not found" in EXECUTION_RECOVERY_STRATEGIES.lower()
        assert "permission denied" in EXECUTION_RECOVERY_STRATEGIES.lower()
        assert "exit code" in EXECUTION_RECOVERY_STRATEGIES.lower()
        assert "timeout" in EXECUTION_RECOVERY_STRATEGIES.lower()
        assert "dependencies" in EXECUTION_RECOVERY_STRATEGIES.lower()


# =============================================================================
# TestEnhanceUserInstructions - Tests for the main enhancement function
# =============================================================================


class TestEnhanceUserInstructions:
    """Tests for enhance_user_instructions() function."""

    def test_empty_instructions_raises_error(self):
        """Test that empty instructions raise ValueError."""
        with pytest.raises(ValueError) as exc_info:
            enhance_user_instructions("")
        assert "cannot be empty" in str(exc_info.value).lower()

    def test_whitespace_only_raises_error(self):
        """Test that whitespace-only instructions raise ValueError."""
        with pytest.raises(ValueError) as exc_info:
            enhance_user_instructions("   \n\t  ")
        assert "cannot be empty" in str(exc_info.value).lower()

    def test_resilience_preamble_always_included(self):
        """Test that resilience preamble is always included."""
        enhanced = enhance_user_instructions("You are a test assistant.")
        assert "error recovery philosophy" in enhanced.lower()
        assert "never give up" in enhanced.lower()

    def test_planning_capability_always_included(self):
        """Test that planning capability is always included."""
        enhanced = enhance_user_instructions("You are a test assistant.")
        assert "planning system" in enhanced.lower()

    def test_filesystem_capability_always_included(self):
        """Test that file system capability is always included."""
        enhanced = enhance_user_instructions("You are a test assistant.")
        assert "file system" in enhanced.lower()

    def test_think_capability_included_without_native_thinking(self):
        """Test that think tool capability is included when native thinking is off."""
        enhanced = enhance_user_instructions("You are a test assistant.")
        assert "think tool" in enhanced.lower()

    def test_think_capability_excluded_with_native_thinking(self):
        """Test that think tool capability is excluded when native thinking is on."""
        enhanced = enhance_user_instructions(
            "You are a test assistant.",
            has_native_thinking=True,
        )
        assert "think tool" not in enhanced.lower()

    def test_file_recovery_always_included(self):
        """Test that file recovery strategies are always included."""
        enhanced = enhance_user_instructions("You are a test assistant.")
        assert "file operation recovery" in enhanced.lower()

    def test_mcp_capability_only_when_enabled(self):
        """Test that MCP capability is only included when has_mcp_tools=True."""
        # Without MCP
        enhanced_no_mcp = enhance_user_instructions(
            "Test assistant.", has_mcp_tools=False
        )
        assert "mcp tools" not in enhanced_no_mcp.lower() or \
               "mcp (model context protocol) tools configured" not in enhanced_no_mcp.lower()

        # With MCP
        enhanced_with_mcp = enhance_user_instructions(
            "Test assistant.", has_mcp_tools=True
        )
        assert "mcp" in enhanced_with_mcp.lower()

    def test_mcp_recovery_only_when_enabled(self):
        """Test that MCP recovery strategies are only included when has_mcp_tools=True."""
        # Without MCP
        enhanced_no_mcp = enhance_user_instructions(
            "Test assistant.", has_mcp_tools=False
        )
        assert "mcp tool recovery" not in enhanced_no_mcp.lower()

        # With MCP
        enhanced_with_mcp = enhance_user_instructions(
            "Test assistant.", has_mcp_tools=True
        )
        assert "mcp tool recovery" in enhanced_with_mcp.lower()

    def test_execute_capability_only_when_sandbox_enabled(self):
        """Test that execute capability is only included when has_sandbox=True."""
        # Without sandbox
        enhanced_no_sandbox = enhance_user_instructions(
            "Test assistant.", has_sandbox=False
        )
        # Check that "execute tool" section is not present
        assert "execute tool" not in enhanced_no_sandbox.lower() or \
               "secure sandbox environment" not in enhanced_no_sandbox.lower()

        # With sandbox
        enhanced_with_sandbox = enhance_user_instructions(
            "Test assistant.", has_sandbox=True
        )
        assert "execute tool" in enhanced_with_sandbox.lower()
        assert "sandbox" in enhanced_with_sandbox.lower()

    def test_execution_recovery_only_when_sandbox_enabled(self):
        """Test that execution recovery strategies are only included when has_sandbox=True."""
        # Without sandbox
        enhanced_no_sandbox = enhance_user_instructions(
            "Test assistant.", has_sandbox=False
        )
        assert "command execution recovery" not in enhanced_no_sandbox.lower()

        # With sandbox
        enhanced_with_sandbox = enhance_user_instructions(
            "Test assistant.", has_sandbox=True
        )
        assert "command execution recovery" in enhanced_with_sandbox.lower()

    def test_user_instructions_preserved(self):
        """Test that user instructions are preserved in output."""
        original = "You are a specialized research assistant who helps with data analysis."
        enhanced = enhance_user_instructions(original)
        assert original in enhanced

    def test_user_instructions_at_end(self):
        """Test that user instructions appear at the end (highest LLM priority)."""
        original = "You are a specialized assistant."
        enhanced = enhance_user_instructions(original)
        
        # User instructions should be after the recovery strategies
        # They're wrapped in "## Your Task"
        assert "## your task" in enhanced.lower()
        # Find position of user task section
        task_pos = enhanced.lower().find("## your task")
        # Find position of resilience preamble
        resilience_pos = enhanced.lower().find("error recovery philosophy")
        # Task should come after resilience
        assert task_pos > resilience_pos

    def test_all_features_enabled(self):
        """Test enhancement with all features enabled."""
        enhanced = enhance_user_instructions(
            "Full-featured assistant.",
            has_mcp_tools=True,
            has_sandbox=True,
        )
        
        # All sections should be present
        assert "error recovery philosophy" in enhanced.lower()
        assert "your capabilities" in enhanced.lower()
        assert "planning system" in enhanced.lower()
        assert "file system" in enhanced.lower()
        assert "think tool" in enhanced.lower()
        assert "mcp tools" in enhanced.lower()
        assert "execute tool" in enhanced.lower()
        assert "file operation recovery" in enhanced.lower()
        assert "mcp tool recovery" in enhanced.lower()
        assert "command execution recovery" in enhanced.lower()
        assert "your task" in enhanced.lower()

    def test_prompt_size_reasonable(self):
        """Test that enhanced prompt size is reasonable (~800-1200 words)."""
        enhanced = enhance_user_instructions(
            "Test assistant.",
            has_mcp_tools=True,
            has_sandbox=True,
        )
        
        # Count words (rough estimate)
        word_count = len(enhanced.split())
        
        # Should be between 600 and 1500 words for full enhancement
        assert word_count >= 600, f"Prompt too short: {word_count} words"
        assert word_count <= 1500, f"Prompt too long: {word_count} words"


# =============================================================================
# TestPromptStructure - Tests for prompt structure and ordering
# =============================================================================


class TestPromptStructure:
    """Tests for prompt structure and section ordering."""

    def test_sections_separated_by_dividers(self):
        """Test that major sections are separated by dividers."""
        enhanced = enhance_user_instructions("Test.", has_mcp_tools=True, has_sandbox=True)
        # Check for section dividers
        assert "---" in enhanced

    def test_capabilities_section_header(self):
        """Test that capabilities section has proper header."""
        enhanced = enhance_user_instructions("Test.")
        assert "## your capabilities" in enhanced.lower()

    def test_recovery_sections_have_headers(self):
        """Test that recovery sections have proper headers."""
        enhanced = enhance_user_instructions("Test.", has_mcp_tools=True, has_sandbox=True)
        assert "## file operation recovery" in enhanced.lower()
        assert "## mcp tool recovery" in enhanced.lower()
        assert "## command execution recovery" in enhanced.lower()
