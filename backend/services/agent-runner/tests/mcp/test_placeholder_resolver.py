"""Unit tests for the placeholder resolver service.

Tests cover:
- Basic placeholder resolution (${VAR_NAME} syntax)
- Strict vs lenient mode behavior
- Map and HTTP config resolution
- Placeholder discovery and validation
- Error handling for missing variables
- Edge cases and boundary conditions
"""

import logging

import pytest

from stigmer_runner.worker.mcp.placeholder_resolver import (
    PLACEHOLDER_PATTERN,
    PlaceholderResolutionError,
    PlaceholderResolver,
    resolve_placeholders,
    resolve_placeholders_strict,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def lenient_resolver():
    """Create a lenient (non-strict) placeholder resolver."""
    return PlaceholderResolver(strict=False)


@pytest.fixture
def strict_resolver():
    """Create a strict placeholder resolver."""
    return PlaceholderResolver(strict=True)


@pytest.fixture
def sample_env_vars():
    """Sample environment variables for testing."""
    return {
        "TOKEN": "abc123",
        "API_KEY": "sk-secret-key",
        "AWS_REGION": "us-west-2",
        "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx",
        "EMPTY_VAR": "",
        "VAR_WITH_UNDERSCORE": "underscore_value",
        "VAR123": "numeric_suffix",
    }


# =============================================================================
# Tests for PlaceholderResolver.resolve() - Basic Cases
# =============================================================================


class TestPlaceholderResolverBasic:
    """Tests for basic placeholder resolution."""

    def test_resolve_single_placeholder(self, lenient_resolver, sample_env_vars):
        """Test resolving a single ${VAR} placeholder."""
        result = lenient_resolver.resolve("Bearer ${TOKEN}", sample_env_vars)
        assert result == "Bearer abc123"

    def test_resolve_multiple_placeholders(self, lenient_resolver, sample_env_vars):
        """Test resolving multiple placeholders in one string."""
        result = lenient_resolver.resolve(
            "${AWS_REGION}-${TOKEN}",
            sample_env_vars,
        )
        assert result == "us-west-2-abc123"

    def test_resolve_placeholder_only(self, lenient_resolver, sample_env_vars):
        """Test resolving a string that is only a placeholder."""
        result = lenient_resolver.resolve("${TOKEN}", sample_env_vars)
        assert result == "abc123"

    def test_resolve_no_placeholders(self, lenient_resolver, sample_env_vars):
        """Test string without placeholders passes through unchanged."""
        result = lenient_resolver.resolve("plain text", sample_env_vars)
        assert result == "plain text"

    def test_resolve_empty_string(self, lenient_resolver, sample_env_vars):
        """Test empty string returns empty string."""
        result = lenient_resolver.resolve("", sample_env_vars)
        assert result == ""

    def test_resolve_none_like_empty(self, lenient_resolver):
        """Test that None-like values are handled."""
        # Empty env vars dict
        result = lenient_resolver.resolve("text", {})
        assert result == "text"

    def test_resolve_empty_value(self, lenient_resolver, sample_env_vars):
        """Test resolving to an empty value."""
        result = lenient_resolver.resolve("prefix-${EMPTY_VAR}-suffix", sample_env_vars)
        assert result == "prefix--suffix"

    def test_resolve_with_underscore_in_name(self, lenient_resolver, sample_env_vars):
        """Test placeholder with underscores in variable name."""
        result = lenient_resolver.resolve("${VAR_WITH_UNDERSCORE}", sample_env_vars)
        assert result == "underscore_value"

    def test_resolve_with_numbers_in_name(self, lenient_resolver, sample_env_vars):
        """Test placeholder with numbers in variable name."""
        result = lenient_resolver.resolve("${VAR123}", sample_env_vars)
        assert result == "numeric_suffix"


# =============================================================================
# Tests for PlaceholderResolver - Strict vs Lenient Mode
# =============================================================================


class TestPlaceholderResolverModes:
    """Tests for strict vs lenient mode behavior."""

    def test_lenient_unresolved_preserved(self, lenient_resolver):
        """Test that lenient mode preserves unresolved placeholders."""
        result = lenient_resolver.resolve("Bearer ${MISSING}", {})
        assert result == "Bearer ${MISSING}"

    def test_lenient_partial_resolution(self, lenient_resolver, sample_env_vars):
        """Test partial resolution in lenient mode."""
        result = lenient_resolver.resolve(
            "${TOKEN}-${MISSING}",
            sample_env_vars,
        )
        assert result == "abc123-${MISSING}"

    def test_lenient_logs_warning(self, lenient_resolver, caplog):
        """Test that lenient mode logs warning for unresolved."""
        caplog.set_level(logging.WARNING)
        lenient_resolver.resolve("${MISSING}", {})
        assert any("Unresolved placeholder" in record.message for record in caplog.records)
        assert any("MISSING" in record.message for record in caplog.records)

    def test_strict_raises_on_missing(self, strict_resolver):
        """Test that strict mode raises error for missing variable."""
        with pytest.raises(PlaceholderResolutionError) as exc_info:
            strict_resolver.resolve("Bearer ${MISSING}", {})
        
        assert exc_info.value.variable_name == "MISSING"
        assert "MISSING" in str(exc_info.value)

    def test_strict_success_when_all_present(self, strict_resolver, sample_env_vars):
        """Test that strict mode succeeds when all variables present."""
        result = strict_resolver.resolve("Bearer ${TOKEN}", sample_env_vars)
        assert result == "Bearer abc123"

    def test_strict_error_includes_context(self, strict_resolver):
        """Test that strict error includes context when provided."""
        with pytest.raises(PlaceholderResolutionError) as exc_info:
            strict_resolver.resolve(
                "Bearer ${MISSING}",
                {},
                context="header 'Authorization'",
            )
        
        assert "header 'Authorization'" in str(exc_info.value)

    def test_strict_fails_on_first_missing(self, strict_resolver, sample_env_vars):
        """Test that strict mode fails on the first missing variable."""
        with pytest.raises(PlaceholderResolutionError) as exc_info:
            strict_resolver.resolve(
                "${TOKEN}-${MISSING1}-${MISSING2}",
                sample_env_vars,
            )
        
        # Should fail on first missing (MISSING1)
        assert exc_info.value.variable_name == "MISSING1"


# =============================================================================
# Tests for PlaceholderResolver.resolve_with_metadata()
# =============================================================================


class TestPlaceholderResolverWithMetadata:
    """Tests for resolution with metadata tracking."""

    def test_metadata_tracks_resolved(self, lenient_resolver, sample_env_vars):
        """Test that resolved variables are tracked."""
        result = lenient_resolver.resolve_with_metadata(
            "${TOKEN}-${API_KEY}",
            sample_env_vars,
        )
        
        assert result.value == "abc123-sk-secret-key"
        assert result.resolved_variables == {"TOKEN", "API_KEY"}
        assert result.unresolved_variables == set()
        assert result.fully_resolved is True

    def test_metadata_tracks_unresolved(self, lenient_resolver, sample_env_vars):
        """Test that unresolved variables are tracked."""
        result = lenient_resolver.resolve_with_metadata(
            "${TOKEN}-${MISSING}",
            sample_env_vars,
        )
        
        assert "abc123" in result.value
        assert result.resolved_variables == {"TOKEN"}
        assert result.unresolved_variables == {"MISSING"}
        assert result.fully_resolved is False

    def test_metadata_empty_for_no_placeholders(self, lenient_resolver):
        """Test metadata for string without placeholders."""
        result = lenient_resolver.resolve_with_metadata("plain text", {})
        
        assert result.value == "plain text"
        assert result.resolved_variables == set()
        assert result.unresolved_variables == set()
        assert result.fully_resolved is True


# =============================================================================
# Tests for PlaceholderResolver.resolve_map()
# =============================================================================


class TestPlaceholderResolverMap:
    """Tests for dictionary/map resolution."""

    def test_resolve_map_basic(self, lenient_resolver, sample_env_vars):
        """Test resolving placeholders in a dictionary."""
        template_map = {
            "Authorization": "Bearer ${TOKEN}",
            "X-Region": "${AWS_REGION}",
            "Static": "no-placeholder",
        }
        
        result = lenient_resolver.resolve_map(template_map, sample_env_vars)
        
        assert result["Authorization"] == "Bearer abc123"
        assert result["X-Region"] == "us-west-2"
        assert result["Static"] == "no-placeholder"

    def test_resolve_map_empty(self, lenient_resolver, sample_env_vars):
        """Test resolving empty map."""
        result = lenient_resolver.resolve_map({}, sample_env_vars)
        assert result == {}

    def test_resolve_map_with_context(self, strict_resolver, sample_env_vars):
        """Test that context is included in errors."""
        template_map = {"Auth": "Bearer ${MISSING}"}
        
        with pytest.raises(PlaceholderResolutionError) as exc_info:
            strict_resolver.resolve_map(
                template_map,
                sample_env_vars,
                context_prefix="header",
            )
        
        assert "header 'Auth'" in str(exc_info.value)


# =============================================================================
# Tests for PlaceholderResolver.resolve_http_config()
# =============================================================================


class TestPlaceholderResolverHttpConfig:
    """Tests for HTTP config resolution."""

    def test_resolve_http_config_full(self, lenient_resolver, sample_env_vars):
        """Test resolving headers and query params together."""
        headers = {
            "Authorization": "Bearer ${TOKEN}",
            "X-API-Key": "${API_KEY}",
        }
        query_params = {
            "region": "${AWS_REGION}",
            "format": "json",
        }
        
        resolved_headers, resolved_params = lenient_resolver.resolve_http_config(
            headers, query_params, sample_env_vars
        )
        
        assert resolved_headers["Authorization"] == "Bearer abc123"
        assert resolved_headers["X-API-Key"] == "sk-secret-key"
        assert resolved_params["region"] == "us-west-2"
        assert resolved_params["format"] == "json"

    def test_resolve_http_config_headers_only(self, lenient_resolver, sample_env_vars):
        """Test resolving with only headers."""
        headers = {"Authorization": "Bearer ${TOKEN}"}
        
        resolved_headers, resolved_params = lenient_resolver.resolve_http_config(
            headers, None, sample_env_vars
        )
        
        assert resolved_headers["Authorization"] == "Bearer abc123"
        assert resolved_params == {}

    def test_resolve_http_config_params_only(self, lenient_resolver, sample_env_vars):
        """Test resolving with only query params."""
        query_params = {"region": "${AWS_REGION}"}
        
        resolved_headers, resolved_params = lenient_resolver.resolve_http_config(
            None, query_params, sample_env_vars
        )
        
        assert resolved_headers == {}
        assert resolved_params["region"] == "us-west-2"

    def test_resolve_http_config_empty(self, lenient_resolver, sample_env_vars):
        """Test resolving with empty headers and params."""
        resolved_headers, resolved_params = lenient_resolver.resolve_http_config(
            None, None, sample_env_vars
        )
        
        assert resolved_headers == {}
        assert resolved_params == {}


# =============================================================================
# Tests for PlaceholderResolver.find_placeholders()
# =============================================================================


class TestPlaceholderResolverFindPlaceholders:
    """Tests for placeholder discovery."""

    def test_find_single_placeholder(self, lenient_resolver):
        """Test finding a single placeholder."""
        result = lenient_resolver.find_placeholders("Bearer ${TOKEN}")
        assert result == {"TOKEN"}

    def test_find_multiple_placeholders(self, lenient_resolver):
        """Test finding multiple placeholders."""
        result = lenient_resolver.find_placeholders("${A} and ${B} and ${C}")
        assert result == {"A", "B", "C"}

    def test_find_no_placeholders(self, lenient_resolver):
        """Test finding no placeholders."""
        result = lenient_resolver.find_placeholders("plain text")
        assert result == set()

    def test_find_empty_string(self, lenient_resolver):
        """Test finding in empty string."""
        result = lenient_resolver.find_placeholders("")
        assert result == set()

    def test_find_duplicate_placeholder(self, lenient_resolver):
        """Test that duplicates are deduplicated."""
        result = lenient_resolver.find_placeholders("${A} and ${A}")
        assert result == {"A"}


# =============================================================================
# Tests for PlaceholderResolver.find_all_placeholders()
# =============================================================================


class TestPlaceholderResolverFindAllPlaceholders:
    """Tests for finding placeholders across a map."""

    def test_find_all_in_map(self, lenient_resolver):
        """Test finding all placeholders in a dictionary."""
        template_map = {
            "header1": "Bearer ${TOKEN}",
            "header2": "${API_KEY}",
            "header3": "static",
        }
        
        result = lenient_resolver.find_all_placeholders(template_map)
        assert result == {"TOKEN", "API_KEY"}

    def test_find_all_empty_map(self, lenient_resolver):
        """Test finding in empty map."""
        result = lenient_resolver.find_all_placeholders({})
        assert result == set()


# =============================================================================
# Tests for PlaceholderResolver.validate_all_resolved()
# =============================================================================


class TestPlaceholderResolverValidation:
    """Tests for validation functionality."""

    def test_validate_all_present(self, lenient_resolver, sample_env_vars):
        """Test validation when all variables are present."""
        template_map = {
            "auth": "Bearer ${TOKEN}",
            "key": "${API_KEY}",
        }
        
        missing = lenient_resolver.validate_all_resolved(template_map, sample_env_vars)
        assert missing == []

    def test_validate_some_missing(self, lenient_resolver, sample_env_vars):
        """Test validation when some variables are missing."""
        template_map = {
            "auth": "Bearer ${TOKEN}",
            "missing1": "${DOES_NOT_EXIST}",
            "missing2": "${ALSO_MISSING}",
        }
        
        missing = lenient_resolver.validate_all_resolved(template_map, sample_env_vars)
        assert sorted(missing) == ["ALSO_MISSING", "DOES_NOT_EXIST"]

    def test_validate_empty_map(self, lenient_resolver, sample_env_vars):
        """Test validation with empty map."""
        missing = lenient_resolver.validate_all_resolved({}, sample_env_vars)
        assert missing == []


# =============================================================================
# Tests for Module-Level Functions
# =============================================================================


class TestModuleLevelFunctions:
    """Tests for module-level convenience functions."""

    def test_resolve_placeholders_function(self, sample_env_vars):
        """Test the module-level resolve_placeholders function."""
        result = resolve_placeholders("Bearer ${TOKEN}", sample_env_vars)
        assert result == "Bearer abc123"

    def test_resolve_placeholders_missing(self):
        """Test resolve_placeholders with missing variable (lenient)."""
        result = resolve_placeholders("Bearer ${MISSING}", {})
        assert result == "Bearer ${MISSING}"

    def test_resolve_placeholders_strict_function(self, sample_env_vars):
        """Test the strict module-level function."""
        result = resolve_placeholders_strict("Bearer ${TOKEN}", sample_env_vars)
        assert result == "Bearer abc123"

    def test_resolve_placeholders_strict_raises(self):
        """Test that strict function raises on missing."""
        with pytest.raises(PlaceholderResolutionError):
            resolve_placeholders_strict("Bearer ${MISSING}", {})


# =============================================================================
# Tests for Edge Cases
# =============================================================================


class TestPlaceholderResolverEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_dollar_without_braces(self, lenient_resolver, sample_env_vars):
        """Test that $ without braces is not a placeholder."""
        result = lenient_resolver.resolve("$TOKEN vs ${TOKEN}", sample_env_vars)
        assert result == "$TOKEN vs abc123"

    def test_nested_braces(self, lenient_resolver, sample_env_vars):
        """Test behavior with nested braces."""
        # ${{TOKEN}} - pattern requires ${VAR} format, extra braces break it
        result = lenient_resolver.resolve("${{TOKEN}}", sample_env_vars)
        # Pattern doesn't match ${...} inside ${{ because {TOKEN starts with {
        assert result == "${{TOKEN}}"  # Unchanged - no valid placeholder

    def test_incomplete_placeholder(self, lenient_resolver, sample_env_vars):
        """Test incomplete placeholder syntax."""
        # ${TOKEN without closing brace
        result = lenient_resolver.resolve("${TOKEN", sample_env_vars)
        assert result == "${TOKEN"  # Not modified

    def test_placeholder_with_invalid_start(self, lenient_resolver):
        """Test placeholder starting with number (invalid)."""
        # ${123VAR} - invalid because starts with number
        result = lenient_resolver.resolve("${123VAR}", {"123VAR": "value"})
        assert result == "${123VAR}"  # Not matched by pattern

    def test_placeholder_with_hyphen(self, lenient_resolver):
        """Test placeholder with hyphen (invalid)."""
        # ${VAR-NAME} - invalid because hyphen not allowed
        result = lenient_resolver.resolve("${VAR-NAME}", {"VAR-NAME": "value"})
        # Only ${VAR is matched, -NAME} is literal
        assert "-NAME}" in result

    def test_special_characters_in_value(self, lenient_resolver):
        """Test that special characters in values are preserved."""
        env_vars = {"TOKEN": "abc$123{test}"}
        result = lenient_resolver.resolve("value: ${TOKEN}", env_vars)
        assert result == "value: abc$123{test}"

    def test_unicode_in_value(self, lenient_resolver):
        """Test that unicode in values is preserved."""
        env_vars = {"GREETING": "Hëllo Wörld 🌍"}
        result = lenient_resolver.resolve("${GREETING}", env_vars)
        assert result == "Hëllo Wörld 🌍"

    def test_newline_in_value(self, lenient_resolver):
        """Test that newlines in values are preserved."""
        env_vars = {"MULTILINE": "line1\nline2\nline3"}
        result = lenient_resolver.resolve("${MULTILINE}", env_vars)
        assert result == "line1\nline2\nline3"

    def test_very_long_variable_name(self, lenient_resolver):
        """Test with a very long variable name."""
        long_name = "A" * 1000
        env_vars = {long_name: "value"}
        result = lenient_resolver.resolve(f"${{{long_name}}}", env_vars)
        assert result == "value"


# =============================================================================
# Tests for PlaceholderResolutionError
# =============================================================================


class TestPlaceholderResolutionError:
    """Tests for the custom exception class."""

    def test_error_with_variable_name_only(self):
        """Test error with just variable name."""
        error = PlaceholderResolutionError("MISSING")
        assert error.variable_name == "MISSING"
        assert "MISSING" in str(error)
        assert error.context is None

    def test_error_with_context(self):
        """Test error with context."""
        error = PlaceholderResolutionError("TOKEN", context="header 'Auth'")
        assert error.variable_name == "TOKEN"
        assert error.context == "header 'Auth'"
        assert "header 'Auth'" in str(error)

    def test_error_with_custom_message(self):
        """Test error with custom message."""
        error = PlaceholderResolutionError(
            "VAR",
            message="Custom error message",
        )
        assert str(error) == "Custom error message"


# =============================================================================
# Tests for PLACEHOLDER_PATTERN Regex
# =============================================================================


class TestPlaceholderPattern:
    """Tests for the regex pattern itself."""

    def test_pattern_valid_simple(self):
        """Test pattern matches simple variable."""
        match = PLACEHOLDER_PATTERN.search("${VAR}")
        assert match is not None
        assert match.group(1) == "VAR"

    def test_pattern_valid_with_underscore(self):
        """Test pattern matches variable with underscore."""
        match = PLACEHOLDER_PATTERN.search("${VAR_NAME}")
        assert match is not None
        assert match.group(1) == "VAR_NAME"

    def test_pattern_valid_with_numbers(self):
        """Test pattern matches variable with numbers."""
        match = PLACEHOLDER_PATTERN.search("${VAR123}")
        assert match is not None
        assert match.group(1) == "VAR123"

    def test_pattern_valid_starting_underscore(self):
        """Test pattern matches variable starting with underscore."""
        match = PLACEHOLDER_PATTERN.search("${_PRIVATE}")
        assert match is not None
        assert match.group(1) == "_PRIVATE"

    def test_pattern_invalid_starting_number(self):
        """Test pattern doesn't match variable starting with number."""
        match = PLACEHOLDER_PATTERN.search("${123VAR}")
        assert match is None

    def test_pattern_invalid_with_hyphen(self):
        """Test pattern doesn't match variable with hyphen."""
        # Should match only up to the hyphen
        matches = list(PLACEHOLDER_PATTERN.finditer("${VAR-NAME}"))
        # No full match because hyphen breaks it
        assert len(matches) == 0 or matches[0].group(1) != "VAR-NAME"
