"""Unit tests for MCP config transformer module.

Tests cover:
- Placeholder resolution (${VAR_NAME} syntax)
- Stdio config transformation
- HTTP config transformation
- Tool filtering
- Error handling
- Multi-server transformation
"""

from unittest.mock import MagicMock

import pytest

from stigmer_runner.worker.mcp.config_transformer import (
    McpConfigResult,
    _get_discovered_tool_names,
    _resolve_stdio_args,
    transform_all_mcp_configs,
    transform_mcp_config,
)
from stigmer_runner.worker.mcp.placeholder_resolver import (
    PlaceholderResolutionError,
    resolve_placeholders,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mock_stdio_spec():
    """Create a mock McpServerSpec with stdio config."""
    spec = MagicMock()
    spec.HasField.side_effect = lambda x: x == "stdio"
    spec.stdio.command = "npx"
    spec.stdio.args = ["-y", "@modelcontextprotocol/server-github"]
    spec.stdio.working_dir = "/app"
    spec.default_enabled_tools = ["search_code", "create_pr"]
    return spec


@pytest.fixture
def mock_http_spec():
    """Create a mock McpServerSpec with HTTP config."""
    spec = MagicMock()
    spec.HasField.side_effect = lambda x: x == "http"
    spec.http.url = "https://mcp.example.com/v1"
    spec.http.headers = {
        "Authorization": "Bearer ${API_TOKEN}",
        "X-Custom-Header": "static-value",
    }
    spec.http.query_params = {
        "region": "${AWS_REGION}",
        "version": "v1",
    }
    spec.http.timeout_seconds = 60
    spec.default_enabled_tools = []
    return spec


@pytest.fixture
def mock_mcp_server():
    """Create a mock McpServer proto message."""
    server = MagicMock()
    server.metadata.id = "mcp-server-123"
    server.metadata.name = "github-mcp"
    server.metadata.slug = "github"
    server.spec.HasField.side_effect = lambda x: x == "stdio"
    server.spec.stdio.command = "npx"
    server.spec.stdio.args = ["-y", "@modelcontextprotocol/server-github"]
    server.spec.stdio.working_dir = ""
    server.spec.default_enabled_tools = ["search_code", "create_pr"]
    server.spec.env = {"GITHUB_TOKEN": MagicMock()}
    return server


@pytest.fixture
def mock_mcp_server_http():
    """Create a mock McpServer with HTTP config and discovered tools."""
    server = MagicMock()
    server.metadata.id = "mcp-server-456"
    server.metadata.name = "custom-mcp"
    server.metadata.slug = "custom-api"
    server.spec.HasField.side_effect = lambda x: x == "http"
    server.spec.http.url = "https://api.custom.com/mcp"
    server.spec.http.headers = {"Authorization": "Bearer ${SECRET}"}
    server.spec.http.query_params = {}
    server.spec.http.timeout_seconds = 30
    server.spec.default_enabled_tools = []
    server.spec.env = {"SECRET": MagicMock()}
    # Discovered tools (populated by backfill/connect)
    tool_a = MagicMock()
    tool_a.name = "tool_alpha"
    tool_b = MagicMock()
    tool_b.name = "tool_beta"
    server.status.discovered_capabilities.tools = [tool_a, tool_b]
    return server


@pytest.fixture
def mock_mcp_server_usage():
    """Create a mock McpServerUsage."""
    usage = MagicMock()
    usage.mcp_server_ref.slug = "github"
    usage.enabled_tools = ["search_code"]  # Restricted tools
    return usage


@pytest.fixture
def mock_mcp_server_usage_all_tools():
    """Create a mock McpServerUsage with all tools enabled."""
    usage = MagicMock()
    usage.mcp_server_ref.slug = "github"
    usage.enabled_tools = []  # Empty = all tools
    return usage


# =============================================================================
# Tests for resolve_placeholders()
# =============================================================================


class TestResolvePlaceholders:
    """Tests for placeholder resolution function."""

    def test_resolve_single_placeholder(self):
        """Test resolving a single ${VAR} placeholder."""
        result = resolve_placeholders(
            "Bearer ${TOKEN}",
            {"TOKEN": "abc123"}
        )
        assert result == "Bearer abc123"

    def test_resolve_multiple_placeholders(self):
        """Test resolving multiple placeholders in one string."""
        result = resolve_placeholders(
            "${PREFIX}-${SUFFIX}",
            {"PREFIX": "hello", "SUFFIX": "world"}
        )
        assert result == "hello-world"

    def test_unresolved_placeholder_preserved(self):
        """Test that unresolved placeholders are preserved."""
        result = resolve_placeholders(
            "Bearer ${MISSING}",
            {}
        )
        assert result == "Bearer ${MISSING}"

    def test_partial_resolution(self):
        """Test partial resolution when some vars are missing."""
        result = resolve_placeholders(
            "${EXISTS}-${MISSING}",
            {"EXISTS": "found"}
        )
        assert result == "found-${MISSING}"

    def test_empty_string(self):
        """Test empty string returns empty string."""
        result = resolve_placeholders("", {"VAR": "value"})
        assert result == ""

    def test_no_placeholders(self):
        """Test string without placeholders passes through."""
        result = resolve_placeholders(
            "plain text",
            {"VAR": "unused"}
        )
        assert result == "plain text"

    def test_placeholder_with_underscores(self):
        """Test placeholder with underscores in name."""
        result = resolve_placeholders(
            "${MY_API_KEY}",
            {"MY_API_KEY": "secret123"}
        )
        assert result == "secret123"

    def test_placeholder_with_numbers(self):
        """Test placeholder with numbers in name."""
        result = resolve_placeholders(
            "${VAR123}",
            {"VAR123": "value"}
        )
        assert result == "value"

    def test_nested_braces_ignored(self):
        """Test that nested/extra braces don't cause issues."""
        # ${{DOUBLE}} - pattern requires ${VAR} format, extra braces break it
        result = resolve_placeholders(
            "${{DOUBLE}}",
            {"DOUBLE": "value"}
        )
        # Pattern doesn't match ${...} inside ${{ because {DOUBLE starts with {
        assert result == "${{DOUBLE}}"  # Unchanged - no valid placeholder

    def test_dollar_without_braces(self):
        """Test that $ without braces is not a placeholder."""
        result = resolve_placeholders(
            "$VAR and ${VAR}",
            {"VAR": "value"}
        )
        assert result == "$VAR and value"


# =============================================================================
# Tests for transform_mcp_config() - Stdio
# =============================================================================


class TestTransformMcpConfigStdio:
    """Tests for stdio transport transformation."""

    def test_basic_stdio_config(self, mock_stdio_spec):
        """Test basic stdio config transformation."""
        config, tools = transform_mcp_config(
            server_slug="github",
            spec=mock_stdio_spec,
            env_vars={"GITHUB_TOKEN": "token123"},
        )

        assert config["transport"] == "stdio"
        assert config["command"] == "npx"
        assert config["args"] == ["-y", "@modelcontextprotocol/server-github"]
        assert config["cwd"] == "/app"
        assert config["env"] == {"GITHUB_TOKEN": "token123"}

    def test_stdio_uses_default_enabled_tools(self, mock_stdio_spec):
        """Test that default_enabled_tools from spec are used."""
        config, tools = transform_mcp_config(
            server_slug="github",
            spec=mock_stdio_spec,
            env_vars={},
        )

        assert tools == ["search_code", "create_pr"]

    def test_stdio_explicit_tools_override_default(self, mock_stdio_spec):
        """Test that explicit enabled_tools override defaults."""
        config, tools = transform_mcp_config(
            server_slug="github",
            spec=mock_stdio_spec,
            env_vars={},
            enabled_tools=["search_code"],  # Restricted
        )

        assert tools == ["search_code"]

    def test_stdio_no_working_dir(self):
        """Test stdio config without working directory."""
        spec = MagicMock()
        spec.HasField.side_effect = lambda x: x == "stdio"
        spec.stdio.command = "python"
        spec.stdio.args = ["-m", "mcp_server"]
        spec.stdio.working_dir = ""  # Empty
        spec.default_enabled_tools = []

        config, tools = transform_mcp_config(
            server_slug="python-mcp",
            spec=spec,
            env_vars={},
        )

        assert "cwd" not in config

    def test_stdio_empty_env_not_included(self):
        """Test that empty env dict is still included (for subprocess)."""
        spec = MagicMock()
        spec.HasField.side_effect = lambda x: x == "stdio"
        spec.stdio.command = "npx"
        spec.stdio.args = []
        spec.stdio.working_dir = ""
        spec.default_enabled_tools = []

        config, tools = transform_mcp_config(
            server_slug="test",
            spec=spec,
            env_vars={},
        )

        # Empty env should not be included (falsy check)
        assert "env" not in config or config["env"] == {}


# =============================================================================
# Tests for _resolve_stdio_args() — ${VAR} interpolation in stdio arguments
# =============================================================================


class TestResolveStdioArgs:
    """Tests for ${VAR_NAME} placeholder resolution in stdio args."""

    def test_no_placeholders_passthrough(self):
        """Literal args without placeholders pass through unchanged."""
        args = ["-y", "@modelcontextprotocol/server-github"]
        result = _resolve_stdio_args(args, {"UNUSED": "val"})
        assert result == ["-y", "@modelcontextprotocol/server-github"]

    def test_single_placeholder_resolved(self):
        """A single ${VAR} arg resolves to its env value."""
        args = ["-y", "@modelcontextprotocol/server-postgres", "${POSTGRES_URL}"]
        result = _resolve_stdio_args(
            args, {"POSTGRES_URL": "postgres://user:pass@host:5432/db"}
        )
        assert result == [
            "-y",
            "@modelcontextprotocol/server-postgres",
            "postgres://user:pass@host:5432/db",
        ]

    def test_mixed_literal_and_placeholder_args(self):
        """Mix of literal args and placeholder args resolves correctly."""
        args = ["-m", "mcp_server", "--host", "${HOST}", "--port", "5432"]
        result = _resolve_stdio_args(args, {"HOST": "db.example.com"})
        assert result == ["-m", "mcp_server", "--host", "db.example.com", "--port", "5432"]

    def test_partial_interpolation_within_arg(self):
        """${VAR} embedded within a larger string resolves correctly."""
        args = ["--db-path=${DB_PATH}/data.sqlite"]
        result = _resolve_stdio_args(args, {"DB_PATH": "/mnt/storage"})
        assert result == ["--db-path=/mnt/storage/data.sqlite"]

    def test_multiple_placeholders_in_one_arg(self):
        """Multiple ${VAR} references within a single arg all resolve."""
        args = ["${SCHEME}://${HOST}:${PORT}"]
        result = _resolve_stdio_args(
            args, {"SCHEME": "postgres", "HOST": "db.local", "PORT": "5432"}
        )
        assert result == ["postgres://db.local:5432"]

    def test_missing_variable_raises_strict_error(self):
        """Missing variable raises PlaceholderResolutionError (strict mode)."""
        args = ["${MISSING_VAR}"]
        with pytest.raises(PlaceholderResolutionError) as exc_info:
            _resolve_stdio_args(args, {})
        assert "MISSING_VAR" in str(exc_info.value)
        assert "stdio arg" in str(exc_info.value)

    def test_empty_args_returns_empty(self):
        """Empty args list returns empty list."""
        assert _resolve_stdio_args([], {"VAR": "val"}) == []

    def test_original_args_not_mutated(self):
        """Input args list is not modified."""
        args = ["${VAR}"]
        _ = _resolve_stdio_args(args, {"VAR": "resolved"})
        assert args == ["${VAR}"]


class TestStdioConfigWithPlaceholders:
    """Integration tests: transform_mcp_config with placeholder args."""

    def test_stdio_args_interpolated_in_full_transform(self):
        """Placeholders in stdio args resolve through transform_mcp_config."""
        spec = MagicMock()
        spec.HasField.side_effect = lambda x: x == "stdio"
        spec.stdio.command = "npx"
        spec.stdio.args = ["-y", "@modelcontextprotocol/server-postgres", "${PG_URL}"]
        spec.stdio.working_dir = ""
        spec.default_enabled_tools = []

        config, _ = transform_mcp_config(
            server_slug="postgres",
            spec=spec,
            env_vars={"PG_URL": "postgres://localhost/mydb"},
        )

        assert config["args"] == [
            "-y",
            "@modelcontextprotocol/server-postgres",
            "postgres://localhost/mydb",
        ]
        assert config["env"] == {"PG_URL": "postgres://localhost/mydb"}

    def test_stdio_missing_placeholder_raises_through_transform(self):
        """PlaceholderResolutionError propagates from transform_mcp_config."""
        spec = MagicMock()
        spec.HasField.side_effect = lambda x: x == "stdio"
        spec.stdio.command = "npx"
        spec.stdio.args = ["${REQUIRED_BUT_MISSING}"]
        spec.stdio.working_dir = ""
        spec.default_enabled_tools = []

        with pytest.raises(PlaceholderResolutionError):
            transform_mcp_config(
                server_slug="broken",
                spec=spec,
                env_vars={},
            )


# =============================================================================
# Tests for transform_mcp_config() - HTTP
# =============================================================================


class TestTransformMcpConfigHttp:
    """Tests for HTTP transport transformation."""

    def test_basic_http_config(self, mock_http_spec):
        """Test basic HTTP config transformation."""
        env_vars = {
            "API_TOKEN": "secret123",
            "AWS_REGION": "us-west-2",
        }

        config, tools = transform_mcp_config(
            server_slug="custom-api",
            spec=mock_http_spec,
            env_vars=env_vars,
        )

        assert config["transport"] == "streamable_http"
        # URL should include resolved query params
        assert "https://mcp.example.com/v1?" in config["url"]
        assert "region=us-west-2" in config["url"]
        assert "version=v1" in config["url"]
        assert config["headers"]["Authorization"] == "Bearer secret123"
        assert config["headers"]["X-Custom-Header"] == "static-value"
        assert config["timeout"] == 60

    def test_http_placeholder_resolution_in_headers(self, mock_http_spec):
        """Test that placeholders in headers are resolved."""
        config, tools = transform_mcp_config(
            server_slug="api",
            spec=mock_http_spec,
            env_vars={"API_TOKEN": "resolved_token", "AWS_REGION": "eu-west-1"},
        )

        assert config["headers"]["Authorization"] == "Bearer resolved_token"

    def test_http_missing_header_placeholder_raises(self, mock_http_spec):
        """Missing header placeholder raises PlaceholderResolutionError (strict mode)."""
        with pytest.raises(PlaceholderResolutionError) as exc_info:
            transform_mcp_config(
                server_slug="api",
                spec=mock_http_spec,
                env_vars={},  # No vars — placeholders can't resolve
            )

        assert "API_TOKEN" in str(exc_info.value) or "AWS_REGION" in str(exc_info.value)

    def test_http_partial_header_vars_raises(self, mock_http_spec):
        """Providing some but not all header vars still raises for the missing ones."""
        with pytest.raises(PlaceholderResolutionError) as exc_info:
            transform_mcp_config(
                server_slug="api",
                spec=mock_http_spec,
                env_vars={"API_TOKEN": "tok"},  # AWS_REGION missing from query params
            )

        assert "AWS_REGION" in str(exc_info.value)

    def test_http_no_query_params(self):
        """Test HTTP config without query params."""
        spec = MagicMock()
        spec.HasField.side_effect = lambda x: x == "http"
        spec.http.url = "https://api.example.com/mcp"
        spec.http.headers = {}
        spec.http.query_params = {}
        spec.http.timeout_seconds = 0
        spec.default_enabled_tools = []

        config, tools = transform_mcp_config(
            server_slug="simple-api",
            spec=spec,
            env_vars={},
        )

        assert config["url"] == "https://api.example.com/mcp"
        assert "timeout" not in config  # 0 timeout not included

    def test_http_no_headers(self):
        """Test HTTP config without headers."""
        spec = MagicMock()
        spec.HasField.side_effect = lambda x: x == "http"
        spec.http.url = "https://api.example.com/mcp"
        spec.http.headers = {}
        spec.http.query_params = {}
        spec.http.timeout_seconds = 30
        spec.default_enabled_tools = []

        config, tools = transform_mcp_config(
            server_slug="no-headers",
            spec=spec,
            env_vars={},
        )

        assert "headers" not in config

    def test_http_url_encoding(self):
        """Test that query params are properly URL-encoded."""
        spec = MagicMock()
        spec.HasField.side_effect = lambda x: x == "http"
        spec.http.url = "https://api.example.com/mcp"
        spec.http.headers = {}
        spec.http.query_params = {"key": "value with spaces"}
        spec.http.timeout_seconds = 0
        spec.default_enabled_tools = []

        config, tools = transform_mcp_config(
            server_slug="encoded",
            spec=spec,
            env_vars={},
        )

        # urllib.parse.urlencode should encode spaces
        assert "value+with+spaces" in config["url"] or "value%20with%20spaces" in config["url"]


# =============================================================================
# Tests for transform_mcp_config() - Error Cases
# =============================================================================


class TestTransformMcpConfigErrors:
    """Tests for error handling in config transformation."""

    def test_no_server_type_raises_error(self):
        """Test that missing server type raises ValueError."""
        spec = MagicMock()
        spec.HasField.return_value = False  # Neither stdio nor http

        with pytest.raises(ValueError) as exc_info:
            transform_mcp_config(
                server_slug="invalid",
                spec=spec,
                env_vars={},
            )

        assert "no valid server type" in str(exc_info.value).lower()


# =============================================================================
# Tests for transform_all_mcp_configs()
# =============================================================================


class TestTransformAllMcpConfigs:
    """Tests for multi-server transformation."""

    def test_transform_single_server(
        self, mock_mcp_server, mock_mcp_server_usage
    ):
        """Test transforming a single server."""
        result = transform_all_mcp_configs(
            mcp_servers=[mock_mcp_server],
            mcp_server_usages=[mock_mcp_server_usage],
            env_vars={"GITHUB_TOKEN": "token123"},
        )

        assert isinstance(result, McpConfigResult)
        assert "github" in result.servers
        assert "github" in result.tools
        assert result.servers["github"]["transport"] == "stdio"
        assert result.tools["github"] == ["search_code"]

    def test_transform_multiple_servers(
        self,
        mock_mcp_server,
        mock_mcp_server_http,
        mock_mcp_server_usage,
    ):
        """Test transforming multiple servers."""
        usage_http = MagicMock()
        usage_http.mcp_server_ref.slug = "custom-api"
        usage_http.enabled_tools = []

        result = transform_all_mcp_configs(
            mcp_servers=[mock_mcp_server, mock_mcp_server_http],
            mcp_server_usages=[mock_mcp_server_usage, usage_http],
            env_vars={"GITHUB_TOKEN": "token", "SECRET": "mysecret"},
        )

        assert len(result.servers) == 2
        assert "github" in result.servers
        assert "custom-api" in result.servers
        # HTTP server with no enabled_tools and no default_enabled_tools
        # should expand from discovered capabilities
        assert result.tools["custom-api"] == ["tool_alpha", "tool_beta"]

    def test_transform_empty_list(self):
        """Test transforming empty server list."""
        result = transform_all_mcp_configs(
            mcp_servers=[],
            mcp_server_usages=[],
            env_vars={},
        )

        assert result.servers == {}
        assert result.tools == {}

    def test_missing_server_skipped(self, mock_mcp_server_usage):
        """Test that missing servers are skipped with error log."""
        result = transform_all_mcp_configs(
            mcp_servers=[],  # No servers
            mcp_server_usages=[mock_mcp_server_usage],  # But usage references github
            env_vars={},
        )

        # github usage should be skipped since server wasn't fetched
        assert "github" not in result.servers

    def test_server_without_slug_skipped(self, mock_mcp_server_usage):
        """Test that servers without slug are skipped."""
        server = MagicMock()
        server.metadata.id = "some-id"
        server.metadata.slug = ""  # Empty slug

        result = transform_all_mcp_configs(
            mcp_servers=[server],
            mcp_server_usages=[mock_mcp_server_usage],
            env_vars={},
        )

        assert len(result.servers) == 0

    def test_usage_without_slug_skipped(self, mock_mcp_server):
        """Test that usages without slug are skipped."""
        usage = MagicMock()
        usage.mcp_server_ref.slug = ""  # Empty

        result = transform_all_mcp_configs(
            mcp_servers=[mock_mcp_server],
            mcp_server_usages=[usage],
            env_vars={},
        )

        # Server exists but usage doesn't reference it properly
        assert len(result.servers) == 0

    def test_tools_from_usage_override_default(
        self, mock_mcp_server, mock_mcp_server_usage
    ):
        """Test that tools from usage override server defaults."""
        # mock_mcp_server has default_enabled_tools = ["search_code", "create_pr"]
        # mock_mcp_server_usage has enabled_tools = ["search_code"]

        result = transform_all_mcp_configs(
            mcp_servers=[mock_mcp_server],
            mcp_server_usages=[mock_mcp_server_usage],
            env_vars={},
        )

        # Should use the restricted list from usage
        assert result.tools["github"] == ["search_code"]

    def test_empty_usage_tools_uses_default(
        self, mock_mcp_server, mock_mcp_server_usage_all_tools
    ):
        """Test that empty usage tools means use server defaults."""
        result = transform_all_mcp_configs(
            mcp_servers=[mock_mcp_server],
            mcp_server_usages=[mock_mcp_server_usage_all_tools],
            env_vars={},
        )

        # Should use default_enabled_tools from server spec
        assert result.tools["github"] == ["search_code", "create_pr"]


# =============================================================================
# Tests for _get_discovered_tool_names() and "all tools" expansion
# =============================================================================


class TestGetDiscoveredToolNames:
    """Tests for extracting discovered tool names from server status."""

    def test_returns_tool_names(self):
        """Test extracting names from discovered capabilities."""
        server = MagicMock()
        t1 = MagicMock()
        t1.name = "get_issues"
        t2 = MagicMock()
        t2.name = "create_issue"
        server.status.discovered_capabilities.tools = [t1, t2]

        result = _get_discovered_tool_names(server)
        assert result == ["get_issues", "create_issue"]

    def test_returns_empty_when_no_status(self):
        """Test returns empty list when server has no status."""
        server = MagicMock()
        del server.status
        server.status = MagicMock(spec=[])

        result = _get_discovered_tool_names(server)
        assert result == []

    def test_returns_empty_when_no_discovered_capabilities(self):
        """Test returns empty list when discovered_capabilities is absent."""
        server = MagicMock()
        server.status = MagicMock(spec=[])

        result = _get_discovered_tool_names(server)
        assert result == []

    def test_skips_empty_tool_names(self):
        """Test that tools with empty names are filtered out."""
        server = MagicMock()
        t1 = MagicMock()
        t1.name = "valid_tool"
        t2 = MagicMock()
        t2.name = ""
        server.status.discovered_capabilities.tools = [t1, t2]

        result = _get_discovered_tool_names(server)
        assert result == ["valid_tool"]


class TestAllToolsExpansion:
    """Tests for expanding empty tool lists from discovered capabilities."""

    def test_all_tools_expanded_from_discovered(self):
        """When no enabled/default tools, expand from discovered capabilities."""
        server = MagicMock()
        server.metadata.id = "mcp-linear"
        server.metadata.slug = "linear"
        server.spec.HasField.side_effect = lambda x: x == "http"
        server.spec.http.url = "https://mcp.linear.app/mcp"
        server.spec.http.headers = {}
        server.spec.http.query_params = {}
        server.spec.http.timeout_seconds = 0
        server.spec.default_enabled_tools = []
        server.spec.env = {}

        t1 = MagicMock()
        t1.name = "get_issue"
        t2 = MagicMock()
        t2.name = "list_issues"
        server.status.discovered_capabilities.tools = [t1, t2]

        usage = MagicMock()
        usage.mcp_server_ref.slug = "linear"
        usage.enabled_tools = []

        result = transform_all_mcp_configs(
            mcp_servers=[server],
            mcp_server_usages=[usage],
            env_vars={},
        )

        assert "linear" in result.servers
        assert result.tools["linear"] == ["get_issue", "list_issues"]

    def test_server_skipped_when_no_discovered_tools(self):
        """Server with no enabled, default, or discovered tools is skipped."""
        server = MagicMock()
        server.metadata.id = "mcp-broken"
        server.metadata.slug = "broken"
        server.spec.HasField.side_effect = lambda x: x == "http"
        server.spec.http.url = "https://broken.example.com/mcp"
        server.spec.http.headers = {}
        server.spec.http.query_params = {}
        server.spec.http.timeout_seconds = 0
        server.spec.default_enabled_tools = []
        server.spec.env = {}
        server.status = MagicMock(spec=[])

        usage = MagicMock()
        usage.mcp_server_ref.slug = "broken"
        usage.enabled_tools = []

        result = transform_all_mcp_configs(
            mcp_servers=[server],
            mcp_server_usages=[usage],
            env_vars={},
        )

        assert "broken" not in result.servers
        assert "broken" not in result.tools

    def test_explicit_tools_not_overridden_by_discovered(self):
        """When enabled_tools is explicit, discovered tools are not used."""
        server = MagicMock()
        server.metadata.id = "mcp-123"
        server.metadata.slug = "github"
        server.spec.HasField.side_effect = lambda x: x == "stdio"
        server.spec.stdio.command = "npx"
        server.spec.stdio.args = []
        server.spec.stdio.working_dir = ""
        server.spec.default_enabled_tools = []
        server.spec.env = {}

        t1 = MagicMock()
        t1.name = "search_code"
        t2 = MagicMock()
        t2.name = "create_pr"
        server.status.discovered_capabilities.tools = [t1, t2]

        usage = MagicMock()
        usage.mcp_server_ref.slug = "github"
        usage.enabled_tools = ["search_code"]

        result = transform_all_mcp_configs(
            mcp_servers=[server],
            mcp_server_usages=[usage],
            env_vars={},
        )

        assert result.tools["github"] == ["search_code"]


# =============================================================================
# Tests for McpConfigResult dataclass
# =============================================================================


class TestMcpConfigResult:
    """Tests for McpConfigResult dataclass."""

    def test_create_empty_result(self):
        """Test creating empty result."""
        result = McpConfigResult(servers={}, tools={})
        assert result.servers == {}
        assert result.tools == {}

    def test_create_with_data(self):
        """Test creating result with data."""
        result = McpConfigResult(
            servers={"github": {"transport": "stdio", "command": "npx"}},
            tools={"github": ["search_code"]},
        )
        assert "github" in result.servers
        assert result.servers["github"]["transport"] == "stdio"
        assert result.tools["github"] == ["search_code"]
