"""Unit tests for error message enrichment.

Tests cover:
- enrich_error_message() function
- Error pattern detection
- Recovery hint generation
- Tool-specific hints
"""

import pytest

from graphton.core.error_hints import enrich_error_message


# =============================================================================
# TestFileNotFoundErrors - Tests for file not found error patterns
# =============================================================================


class TestFileNotFoundErrors:
    """Tests for file not found error pattern detection."""

    def test_file_not_found_pattern(self):
        """Test that 'file not found' errors get appropriate hints."""
        enriched = enrich_error_message(
            "read_file",
            "File not found: /path/to/file.txt"
        )
        assert "error:" in enriched.lower()
        assert "recovery suggestions:" in enriched.lower()
        assert "ls" in enriched.lower() or "glob" in enriched.lower()

    def test_no_such_file_pattern(self):
        """Test that 'no such file' errors get appropriate hints."""
        enriched = enrich_error_message(
            "read_file",
            "No such file or directory: /missing/path"
        )
        assert "recovery suggestions:" in enriched.lower()
        assert "glob" in enriched.lower()

    def test_resource_not_found_pattern(self):
        """Test that 'resource not found' errors get appropriate hints."""
        enriched = enrich_error_message(
            "get_resource",
            "Resource not found: resource-id-123"
        )
        assert "recovery suggestions:" in enriched.lower()
        assert "list" in enriched.lower() or "search" in enriched.lower()


# =============================================================================
# TestPermissionErrors - Tests for permission error patterns
# =============================================================================


class TestPermissionErrors:
    """Tests for permission error pattern detection."""

    def test_permission_denied_pattern(self):
        """Test that 'permission denied' errors get appropriate hints."""
        enriched = enrich_error_message(
            "write_file",
            "Permission denied: /protected/file.txt"
        )
        assert "recovery suggestions:" in enriched.lower()
        assert "permission" in enriched.lower()

    def test_access_denied_pattern(self):
        """Test that 'access denied' errors get appropriate hints."""
        enriched = enrich_error_message(
            "edit_file",
            "Access denied: cannot write to file"
        )
        assert "recovery suggestions:" in enriched.lower()


# =============================================================================
# TestAuthenticationErrors - Tests for auth error patterns
# =============================================================================


class TestAuthenticationErrors:
    """Tests for authentication error pattern detection."""

    def test_unauthorized_pattern(self):
        """Test that 'unauthorized' errors get appropriate hints."""
        enriched = enrich_error_message(
            "api_call",
            "401 Unauthorized: Invalid credentials"
        )
        assert "recovery suggestions:" in enriched.lower()
        assert "auth" in enriched.lower() or "credentials" in enriched.lower()

    def test_403_forbidden_pattern(self):
        """Test that '403' errors get appropriate hints."""
        enriched = enrich_error_message(
            "create_resource",
            "403 Forbidden: Insufficient permissions"
        )
        assert "recovery suggestions:" in enriched.lower()
        assert "permission" in enriched.lower()


# =============================================================================
# TestConnectionErrors - Tests for connection/network error patterns
# =============================================================================


class TestConnectionErrors:
    """Tests for connection error pattern detection."""

    def test_connection_refused_pattern(self):
        """Test that 'connection refused' errors get appropriate hints."""
        enriched = enrich_error_message(
            "call_api",
            "Connection refused: server unavailable"
        )
        assert "recovery suggestions:" in enriched.lower()
        assert "retry" in enriched.lower() or "transient" in enriched.lower()

    def test_timeout_pattern(self):
        """Test that 'timeout' errors get appropriate hints."""
        enriched = enrich_error_message(
            "long_operation",
            "Request timeout after 30 seconds"
        )
        assert "recovery suggestions:" in enriched.lower()
        assert "retry" in enriched.lower() or "simpler" in enriched.lower()

    def test_service_unavailable_pattern(self):
        """Test that 'unavailable' errors get appropriate hints."""
        enriched = enrich_error_message(
            "external_call",
            "Service temporarily unavailable"
        )
        assert "recovery suggestions:" in enriched.lower()


# =============================================================================
# TestRateLimitErrors - Tests for rate limit error patterns
# =============================================================================


class TestRateLimitErrors:
    """Tests for rate limit error pattern detection."""

    def test_rate_limit_pattern(self):
        """Test that 'rate limit' errors get appropriate hints."""
        enriched = enrich_error_message(
            "api_call",
            "Rate limit exceeded: too many requests"
        )
        assert "recovery suggestions:" in enriched.lower()
        assert "wait" in enriched.lower() or "retry" in enriched.lower()

    def test_429_pattern(self):
        """Test that '429' errors get appropriate hints."""
        enriched = enrich_error_message(
            "fetch_data",
            "429 Too Many Requests"
        )
        assert "recovery suggestions:" in enriched.lower()
        assert "wait" in enriched.lower() or "rate" in enriched.lower()

    def test_quota_pattern(self):
        """Test that 'quota' errors get appropriate hints."""
        enriched = enrich_error_message(
            "create_resource",
            "Quota exceeded: maximum resources reached"
        )
        assert "recovery suggestions:" in enriched.lower()


# =============================================================================
# TestInvalidInputErrors - Tests for invalid input error patterns
# =============================================================================


class TestInvalidInputErrors:
    """Tests for invalid input error pattern detection."""

    def test_invalid_argument_pattern(self):
        """Test that 'invalid' errors get appropriate hints."""
        enriched = enrich_error_message(
            "process_data",
            "Invalid argument: expected string, got int"
        )
        assert "recovery suggestions:" in enriched.lower()
        assert "parameter" in enriched.lower() or "format" in enriched.lower()

    def test_malformed_input_pattern(self):
        """Test that 'malformed' errors get appropriate hints."""
        enriched = enrich_error_message(
            "parse_json",
            "Malformed JSON input"
        )
        assert "recovery suggestions:" in enriched.lower()

    def test_format_error_pattern(self):
        """Test that 'format' errors get appropriate hints."""
        enriched = enrich_error_message(
            "write_config",
            "Invalid format: expected YAML"
        )
        assert "recovery suggestions:" in enriched.lower()


# =============================================================================
# TestToolSpecificHints - Tests for tool-specific hint generation
# =============================================================================


class TestToolSpecificHints:
    """Tests for tool-specific hint generation."""

    def test_edit_tool_gets_read_first_hint(self):
        """Test that edit tools get 'read first' hints."""
        enriched = enrich_error_message(
            "edit_file",
            "Failed to edit file"
        )
        assert "read" in enriched.lower()
        assert "first" in enriched.lower() or "current state" in enriched.lower()

    def test_write_tool_gets_read_first_hint(self):
        """Test that write tools get 'read first' hints."""
        enriched = enrich_error_message(
            "write_file",
            "Failed to write file"
        )
        assert "read" in enriched.lower()


# =============================================================================
# TestFallbackHints - Tests for fallback hint generation
# =============================================================================


class TestFallbackHints:
    """Tests for fallback hint generation when no pattern matches."""

    def test_unknown_error_gets_generic_hints(self):
        """Test that unknown errors get generic recovery hints."""
        enriched = enrich_error_message(
            "unknown_tool",
            "Some completely unexpected error xyz123"
        )
        assert "error:" in enriched.lower()
        assert "recovery suggestions:" in enriched.lower()
        # Should have generic hints
        assert "analyze" in enriched.lower() or "different approach" in enriched.lower()


# =============================================================================
# TestMessageStructure - Tests for enriched message structure
# =============================================================================


class TestMessageStructure:
    """Tests for enriched message structure."""

    def test_original_error_preserved(self):
        """Test that original error message is preserved."""
        original_error = "Specific error message XYZ"
        enriched = enrich_error_message("tool", original_error)
        assert original_error in enriched

    def test_error_prefix_present(self):
        """Test that 'Error:' prefix is present."""
        enriched = enrich_error_message("tool", "some error")
        assert enriched.startswith("Error:")

    def test_recovery_section_present(self):
        """Test that recovery suggestions section is present."""
        enriched = enrich_error_message("tool", "some error")
        assert "Recovery suggestions:" in enriched

    def test_hints_are_bulleted(self):
        """Test that hints are formatted as bullet points."""
        enriched = enrich_error_message(
            "read_file",
            "File not found"
        )
        assert "- " in enriched  # Bullet point format

    def test_multiple_hints_generated(self):
        """Test that multiple hints are generated for known patterns."""
        enriched = enrich_error_message(
            "read_file",
            "File not found: /path/to/file.txt"
        )
        # Count bullet points (should be multiple)
        hint_count = enriched.count("\n- ")
        assert hint_count >= 2, f"Expected multiple hints, got {hint_count}"


# =============================================================================
# TestEdgeCases - Tests for edge cases
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases in error enrichment."""

    def test_empty_error_message(self):
        """Test handling of empty error message."""
        enriched = enrich_error_message("tool", "")
        assert "Error:" in enriched
        assert "Recovery suggestions:" in enriched

    def test_very_long_error_message(self):
        """Test handling of very long error message."""
        long_error = "Error " * 1000
        enriched = enrich_error_message("tool", long_error)
        assert long_error in enriched
        assert "Recovery suggestions:" in enriched

    def test_error_with_special_characters(self):
        """Test handling of error with special characters."""
        special_error = "Error: <tag> 'quotes' \"double\" & ampersand"
        enriched = enrich_error_message("tool", special_error)
        assert special_error in enriched

    def test_case_insensitive_pattern_matching(self):
        """Test that pattern matching is case insensitive."""
        enriched = enrich_error_message("tool", "FILE NOT FOUND")
        assert "glob" in enriched.lower() or "ls" in enriched.lower()
