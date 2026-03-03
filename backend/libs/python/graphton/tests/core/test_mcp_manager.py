"""Unit tests for MCP manager module.

Tests cover:
- connect_mcp_client() function (persistent per-server sessions)
- load_mcp_tools() function
- Input validation (empty servers, empty filter)
- Tool filtering logic
- Error handling (connection failures, no matching tools)
- list_mcp_resources() function
- read_mcp_resource() function
"""

import logging
from contextlib import AsyncExitStack
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from mcp.types import BlobResourceContents, TextResourceContents

# =============================================================================
# TestLoadMcpTools - Tests for load_mcp_tools() function
# =============================================================================


class TestLoadMcpTools:
    """Tests for load_mcp_tools() function."""

    @pytest.fixture
    def mock_mcp_client_class(self, mock_mcp_tools):
        """Mock MultiServerMCPClient class."""
        with patch('graphton.core.mcp_manager.MultiServerMCPClient') as mock_class:
            client_instance = MagicMock()
            mock_class.return_value = client_instance
            client_instance.get_tools = AsyncMock(return_value=mock_mcp_tools)
            yield mock_class, client_instance

    @pytest.mark.asyncio
    async def test_load_tools_success(self, mock_mcp_client_class, sample_servers_config):
        """Test successful tool loading and filtering."""
        mock_class, client_instance = mock_mcp_client_class
        
        # Filter to only get search_code and create_pr
        tool_filter = {"github": ["search_code", "create_pr"]}
        
        from graphton.core.mcp_manager import load_mcp_tools
        result = await load_mcp_tools(sample_servers_config, tool_filter)
        
        # Assert
        assert len(result) == 2
        tool_names = [t.name for t in result]
        assert "search_code" in tool_names
        assert "create_pr" in tool_names
        assert "unused_tool" not in tool_names
        
        # Verify client was initialized with correct config
        mock_class.assert_called_once_with(sample_servers_config)

    @pytest.mark.asyncio
    async def test_load_tools_empty_servers_raises(self):
        """Test that empty servers dict raises ValueError."""
        from graphton.core.mcp_manager import load_mcp_tools
        
        with pytest.raises(ValueError) as exc_info:
            await load_mcp_tools({}, {"github": ["search_code"]})
        
        assert "servers cannot be empty" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_load_tools_empty_filter_raises(self, sample_servers_config):
        """Test that empty tool_filter dict raises ValueError."""
        from graphton.core.mcp_manager import load_mcp_tools
        
        with pytest.raises(ValueError) as exc_info:
            await load_mcp_tools(sample_servers_config, {})
        
        assert "tool_filter cannot be empty" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_load_tools_no_matching_tools_raises(self, sample_servers_config):
        """Test that ValueError is raised when no tools match the filter."""
        with patch('graphton.core.mcp_manager.MultiServerMCPClient') as mock_class:
            client_instance = MagicMock()
            mock_class.return_value = client_instance
            
            # Return tools that don't match the filter
            tool1 = MagicMock()
            tool1.name = "other_tool"
            client_instance.get_tools = AsyncMock(return_value=[tool1])
            
            from graphton.core.mcp_manager import load_mcp_tools
            
            # Filter for tools that don't exist
            tool_filter = {"github": ["nonexistent_tool"]}
            
            with pytest.raises(ValueError) as exc_info:
                await load_mcp_tools(sample_servers_config, tool_filter)
            
            assert "no tools found matching filter" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_load_tools_partial_filter_match(
        self, mock_mcp_client_class, sample_servers_config, caplog
    ):
        """Test that partial filter match logs warning for missing tools."""
        mock_class, client_instance = mock_mcp_client_class
        
        # Filter includes a tool that exists and one that doesn't
        tool_filter = {"github": ["search_code", "nonexistent_tool"]}
        
        with caplog.at_level(logging.WARNING):
            from graphton.core.mcp_manager import load_mcp_tools
            result = await load_mcp_tools(sample_servers_config, tool_filter)
        
        # Assert we got the tool that exists
        assert len(result) == 1
        assert result[0].name == "search_code"
        
        # Assert warning was logged for missing tool
        assert any("nonexistent_tool" in record.message for record in caplog.records)

    @pytest.mark.asyncio
    async def test_load_tools_connection_failure(self, sample_servers_config):
        """Test that connection failure raises RuntimeError."""
        with patch('graphton.core.mcp_manager.MultiServerMCPClient') as mock_class:
            client_instance = MagicMock()
            mock_class.return_value = client_instance
            
            # Simulate connection failure
            client_instance.get_tools = AsyncMock(
                side_effect=ConnectionError("Failed to connect to MCP server")
            )
            
            from graphton.core.mcp_manager import load_mcp_tools
            
            tool_filter = {"github": ["search_code"]}
            
            with pytest.raises(RuntimeError) as exc_info:
                await load_mcp_tools(sample_servers_config, tool_filter)
            
            assert "mcp tool loading failed" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_load_tools_filters_correctly(self, sample_servers_config):
        """Test that only requested tools are returned, not all tools."""
        with patch('graphton.core.mcp_manager.MultiServerMCPClient') as mock_class:
            client_instance = MagicMock()
            mock_class.return_value = client_instance
            
            # Create 10 tools, only 2 should be returned
            all_tools = []
            for i in range(10):
                tool = MagicMock()
                tool.name = f"tool_{i}"
                all_tools.append(tool)
            
            # Add specific tools we want to filter for
            wanted_tool = MagicMock()
            wanted_tool.name = "wanted_tool"
            all_tools.append(wanted_tool)
            
            client_instance.get_tools = AsyncMock(return_value=all_tools)
            
            from graphton.core.mcp_manager import load_mcp_tools
            
            # Only request the wanted_tool
            tool_filter = {"github": ["wanted_tool"]}
            
            result = await load_mcp_tools(sample_servers_config, tool_filter)
            
            # Assert only the wanted tool is returned
            assert len(result) == 1
            assert result[0].name == "wanted_tool"

    @pytest.mark.asyncio
    async def test_load_tools_multiple_servers_filter(self, sample_servers_config):
        """Test filtering tools across multiple servers."""
        with patch('graphton.core.mcp_manager.MultiServerMCPClient') as mock_class:
            client_instance = MagicMock()
            mock_class.return_value = client_instance
            
            # Create tools from different servers
            tools = []
            for name in ["github_search", "github_pr", "api_list", "api_create"]:
                tool = MagicMock()
                tool.name = name
                tools.append(tool)
            
            client_instance.get_tools = AsyncMock(return_value=tools)
            
            from graphton.core.mcp_manager import load_mcp_tools
            
            # Filter tools from both servers
            tool_filter = {
                "github": ["github_search", "github_pr"],
                "custom-api": ["api_list"],
            }
            
            result = await load_mcp_tools(sample_servers_config, tool_filter)
            
            # Assert all 3 requested tools are returned
            assert len(result) == 3
            tool_names = [t.name for t in result]
            assert "github_search" in tool_names
            assert "github_pr" in tool_names
            assert "api_list" in tool_names
            assert "api_create" not in tool_names

    @pytest.mark.asyncio
    async def test_load_tools_logs_info_messages(
        self, mock_mcp_client_class, sample_servers_config, caplog
    ):
        """Test that info messages are logged during tool loading."""
        mock_class, client_instance = mock_mcp_client_class
        
        tool_filter = {"github": ["search_code"]}
        
        with caplog.at_level(logging.INFO):
            from graphton.core.mcp_manager import load_mcp_tools
            await load_mcp_tools(sample_servers_config, tool_filter)
        
        # Assert info messages were logged
        log_messages = [record.message for record in caplog.records]
        
        # Should log about connecting to servers
        assert any("connecting" in msg.lower() for msg in log_messages)
        # Should log about retrieved tools
        assert any("retrieved" in msg.lower() for msg in log_messages)
        # Should log about loaded tools
        assert any("loaded" in msg.lower() for msg in log_messages)


# =============================================================================
# TestConnectMcpClient - Tests for connect_mcp_client() function
# =============================================================================


def _make_mock_tool_session():
    """Create a mock session context manager for connect_mcp_client tests.

    Returns:
        A tuple of (mock_session, async_context_manager) where the context
        manager yields the mock_session when entered.
    """
    session = AsyncMock()
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=session)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return session, ctx


class TestConnectMcpClient:
    """Tests for connect_mcp_client() with persistent per-server sessions."""

    @pytest.mark.asyncio
    async def test_connect_success_single_server(self, sample_servers_config):
        """Test successful connection and tool loading from a single server."""
        single_server = {"github": sample_servers_config["github"]}
        tool_filter = {"github": ["search_code", "create_pr"]}

        mock_tools = []
        for name in ["search_code", "create_pr", "unused_tool"]:
            t = MagicMock()
            t.name = name
            mock_tools.append(t)

        _, ctx = _make_mock_tool_session()

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class, \
             patch("graphton.core.mcp_manager._lc_load_mcp_tools", new_callable=AsyncMock) as mock_load:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)
            mock_load.return_value = mock_tools

            from graphton.core.mcp_manager import connect_mcp_client

            async with AsyncExitStack() as stack:
                result = await connect_mcp_client(single_server, tool_filter, stack)

            assert len(result) == 2
            tool_names = [t.name for t in result]
            assert "search_code" in tool_names
            assert "create_pr" in tool_names

            mock_class.assert_called_once_with(single_server)
            client.session.assert_called_once_with("github")

    @pytest.mark.asyncio
    async def test_connect_success_multiple_servers(self, sample_servers_config):
        """Test that sessions are opened for each server independently."""
        tool_filter = {
            "github": ["search_code"],
            "custom-api": ["list_resources"],
        }

        github_tools = [MagicMock(name="search_code")]
        github_tools[0].name = "search_code"
        api_tools = [MagicMock(name="list_resources")]
        api_tools[0].name = "list_resources"

        github_session, github_ctx = _make_mock_tool_session()
        api_session, api_ctx = _make_mock_tool_session()

        contexts = {"github": github_ctx, "custom-api": api_ctx}

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class, \
             patch("graphton.core.mcp_manager._lc_load_mcp_tools", new_callable=AsyncMock) as mock_load:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(side_effect=lambda name: contexts[name])
            mock_load.side_effect = [github_tools, api_tools]

            from graphton.core.mcp_manager import connect_mcp_client

            async with AsyncExitStack() as stack:
                result = await connect_mcp_client(sample_servers_config, tool_filter, stack)

            assert len(result) == 2
            tool_names = [t.name for t in result]
            assert "search_code" in tool_names
            assert "list_resources" in tool_names

            assert client.session.call_count == 2
            assert mock_load.call_count == 2

    @pytest.mark.asyncio
    async def test_connect_empty_servers_raises(self):
        """Test that empty servers dict raises ValueError."""
        from graphton.core.mcp_manager import connect_mcp_client

        with pytest.raises(ValueError, match="servers cannot be empty"):
            async with AsyncExitStack() as stack:
                await connect_mcp_client({}, {"github": ["search"]}, stack)

    @pytest.mark.asyncio
    async def test_connect_empty_filter_raises(self, sample_servers_config):
        """Test that empty tool_filter dict raises ValueError."""
        from graphton.core.mcp_manager import connect_mcp_client

        with pytest.raises(ValueError, match="tool_filter cannot be empty"):
            async with AsyncExitStack() as stack:
                await connect_mcp_client(sample_servers_config, {}, stack)

    @pytest.mark.asyncio
    async def test_connect_no_matching_tools_raises(self, sample_servers_config):
        """Test that ValueError is raised when no tools match the filter."""
        tool_filter = {"github": ["nonexistent_tool"]}

        other_tool = MagicMock()
        other_tool.name = "other_tool"
        _, ctx = _make_mock_tool_session()

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class, \
             patch("graphton.core.mcp_manager._lc_load_mcp_tools", new_callable=AsyncMock) as mock_load:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)
            mock_load.return_value = [other_tool]

            from graphton.core.mcp_manager import connect_mcp_client

            with pytest.raises(ValueError, match="No tools found matching filter"):
                async with AsyncExitStack() as stack:
                    await connect_mcp_client(
                        {"github": sample_servers_config["github"]},
                        tool_filter,
                        stack,
                    )

    @pytest.mark.asyncio
    async def test_connect_session_failure_raises_runtime_error(self, sample_servers_config):
        """Test that a session connection failure raises RuntimeError."""
        tool_filter = {"github": ["search_code"]}

        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(side_effect=ConnectionError("refused"))
        ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)

            from graphton.core.mcp_manager import connect_mcp_client

            with pytest.raises(RuntimeError, match="MCP persistent connection failed"):
                async with AsyncExitStack() as stack:
                    await connect_mcp_client(
                        {"github": sample_servers_config["github"]},
                        tool_filter,
                        stack,
                    )

    @pytest.mark.asyncio
    async def test_connect_partial_filter_match_warns(
        self, sample_servers_config, caplog
    ):
        """Test that a partial filter match logs a warning for missing tools."""
        tool_filter = {"github": ["search_code", "nonexistent_tool"]}

        search_tool = MagicMock()
        search_tool.name = "search_code"
        _, ctx = _make_mock_tool_session()

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class, \
             patch("graphton.core.mcp_manager._lc_load_mcp_tools", new_callable=AsyncMock) as mock_load:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)
            mock_load.return_value = [search_tool]

            from graphton.core.mcp_manager import connect_mcp_client

            with caplog.at_level(logging.WARNING):
                async with AsyncExitStack() as stack:
                    result = await connect_mcp_client(
                        {"github": sample_servers_config["github"]},
                        tool_filter,
                        stack,
                    )

            assert len(result) == 1
            assert result[0].name == "search_code"
            assert any("nonexistent_tool" in r.message for r in caplog.records)

    @pytest.mark.asyncio
    async def test_connect_logs_info_messages(
        self, sample_servers_config, caplog
    ):
        """Test that info messages are logged during connection and tool loading."""
        tool_filter = {"github": ["search_code"]}

        search_tool = MagicMock()
        search_tool.name = "search_code"
        _, ctx = _make_mock_tool_session()

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class, \
             patch("graphton.core.mcp_manager._lc_load_mcp_tools", new_callable=AsyncMock) as mock_load:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)
            mock_load.return_value = [search_tool]

            from graphton.core.mcp_manager import connect_mcp_client

            with caplog.at_level(logging.INFO):
                async with AsyncExitStack() as stack:
                    await connect_mcp_client(
                        {"github": sample_servers_config["github"]},
                        tool_filter,
                        stack,
                    )

            log_messages = [r.message for r in caplog.records]
            assert any("persistent" in msg.lower() for msg in log_messages)
            assert any("retrieved" in msg.lower() for msg in log_messages)
            assert any("loaded" in msg.lower() for msg in log_messages)


# =============================================================================
# TestListMcpResources - Tests for list_mcp_resources() function
# =============================================================================


def _make_mock_session(resources=None, templates=None):
    """Create a mock MCP ClientSession with resource listing support.

    Args:
        resources: List of mock Resource objects for list_resources().
        templates: List of mock ResourceTemplate objects for list_resource_templates().

    Returns:
        A mock session and an async context manager that yields it.
    """
    session = AsyncMock()

    resources_result = MagicMock()
    resources_result.resources = resources or []
    session.list_resources = AsyncMock(return_value=resources_result)

    templates_result = MagicMock()
    templates_result.resourceTemplates = templates or []
    session.list_resource_templates = AsyncMock(return_value=templates_result)

    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=session)
    ctx.__aexit__ = AsyncMock(return_value=False)

    return session, ctx


def _make_mock_resource(uri, name, description="", mime_type=""):
    """Create a mock MCP Resource object."""
    r = MagicMock()
    r.uri = uri
    r.name = name
    r.description = description
    r.mimeType = mime_type
    return r


def _make_mock_template(uri_template, name, description="", mime_type=""):
    """Create a mock MCP ResourceTemplate object."""
    t = MagicMock()
    t.uriTemplate = uri_template
    t.name = name
    t.description = description
    t.mimeType = mime_type
    return t


class TestListMcpResources:
    """Tests for list_mcp_resources() function."""

    @pytest.mark.asyncio
    async def test_list_resources_with_resources_and_templates(self, sample_servers_config):
        """Test listing servers that have both resources and templates."""
        resource = _make_mock_resource(
            uri="planton://cloud-resource-kinds",
            name="cloud-resource-kinds",
            description="Available cloud resource kinds",
            mime_type="application/json",
        )
        template = _make_mock_template(
            uri_template="cloud-resource-schema://{kind}",
            name="cloud-resource-schema",
            description="JSON schema for a cloud resource kind",
            mime_type="application/json",
        )
        _, ctx = _make_mock_session(resources=[resource], templates=[template])

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)

            from graphton.core.mcp_manager import list_mcp_resources

            result = await list_mcp_resources(sample_servers_config)

        assert len(result) > 0
        server_data = next(iter(result.values()))

        assert len(server_data["resources"]) == 1
        assert server_data["resources"][0]["uri"] == "planton://cloud-resource-kinds"
        assert server_data["resources"][0]["name"] == "cloud-resource-kinds"

        assert len(server_data["resource_templates"]) == 1
        assert server_data["resource_templates"][0]["uri_template"] == "cloud-resource-schema://{kind}"
        assert server_data["resource_templates"][0]["name"] == "cloud-resource-schema"

    @pytest.mark.asyncio
    async def test_list_resources_empty_servers_raises(self):
        """Test that empty servers dict raises ValueError."""
        from graphton.core.mcp_manager import list_mcp_resources

        with pytest.raises(ValueError, match="servers cannot be empty"):
            await list_mcp_resources({})

    @pytest.mark.asyncio
    async def test_list_resources_no_resources_returns_empty(self, sample_servers_config):
        """Test that servers without resources produce an empty result."""
        _, ctx = _make_mock_session(resources=[], templates=[])

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)

            from graphton.core.mcp_manager import list_mcp_resources

            result = await list_mcp_resources(sample_servers_config)

        assert result == {}

    @pytest.mark.asyncio
    async def test_list_resources_connection_failure_skips_server(self, sample_servers_config):
        """Test that connection failure is handled gracefully."""
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(side_effect=ConnectionError("refused"))
        ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)

            from graphton.core.mcp_manager import list_mcp_resources

            result = await list_mcp_resources(sample_servers_config)

        assert result == {}

    @pytest.mark.asyncio
    async def test_list_resources_partial_failure_continues(self, sample_servers_config):
        """Test that failure listing templates doesn't prevent listing resources."""
        resource = _make_mock_resource("test://data", "test-data", "Test resource")

        session = AsyncMock()

        resources_result = MagicMock()
        resources_result.resources = [resource]
        session.list_resources = AsyncMock(return_value=resources_result)

        session.list_resource_templates = AsyncMock(
            side_effect=Exception("not supported")
        )

        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)

            from graphton.core.mcp_manager import list_mcp_resources

            result = await list_mcp_resources(sample_servers_config)

        assert len(result) > 0
        server_data = next(iter(result.values()))
        assert len(server_data["resources"]) == 1
        assert server_data["resource_templates"] == []

    @pytest.mark.asyncio
    async def test_list_resources_templates_only(self, sample_servers_config):
        """Test server that only has resource templates (no static resources)."""
        template = _make_mock_template(
            "schema://{id}", "schema", "A schema template", "application/json",
        )
        _, ctx = _make_mock_session(resources=[], templates=[template])

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)

            from graphton.core.mcp_manager import list_mcp_resources

            result = await list_mcp_resources(sample_servers_config)

        assert len(result) > 0
        server_data = next(iter(result.values()))
        assert server_data["resources"] == []
        assert len(server_data["resource_templates"]) == 1


# =============================================================================
# TestReadMcpResource - Tests for read_mcp_resource() function
# =============================================================================


class TestReadMcpResource:
    """Tests for read_mcp_resource() function."""

    @pytest.mark.asyncio
    async def test_read_text_resource(self, sample_servers_config):
        """Test reading a text resource."""
        text_content = MagicMock(spec=TextResourceContents)
        text_content.uri = "test://data"
        text_content.mimeType = "application/json"
        text_content.text = '{"kind": "AwsAlb"}'

        read_result = MagicMock()
        read_result.contents = [text_content]

        session = AsyncMock()
        session.read_resource = AsyncMock(return_value=read_result)

        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)

            from graphton.core.mcp_manager import read_mcp_resource

            result = await read_mcp_resource(sample_servers_config, "github", "test://data")

        assert len(result) == 1
        assert result[0]["text"] == '{"kind": "AwsAlb"}'
        assert result[0]["mime_type"] == "application/json"
        assert "blob" not in result[0]

    @pytest.mark.asyncio
    async def test_read_binary_resource(self, sample_servers_config):
        """Test reading a binary resource."""
        blob_content = MagicMock(spec=BlobResourceContents)
        blob_content.uri = "test://binary"
        blob_content.mimeType = "application/octet-stream"
        blob_content.blob = "SGVsbG8="

        read_result = MagicMock()
        read_result.contents = [blob_content]

        session = AsyncMock()
        session.read_resource = AsyncMock(return_value=read_result)

        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)

            from graphton.core.mcp_manager import read_mcp_resource

            result = await read_mcp_resource(sample_servers_config, "github", "test://binary")

        assert len(result) == 1
        assert result[0]["blob"] == "SGVsbG8="
        assert result[0]["mime_type"] == "application/octet-stream"
        assert "text" not in result[0]

    @pytest.mark.asyncio
    async def test_read_resource_invalid_server_raises(self, sample_servers_config):
        """Test that reading from an unknown server raises ValueError."""
        from graphton.core.mcp_manager import read_mcp_resource

        with pytest.raises(ValueError, match="not found"):
            await read_mcp_resource(
                sample_servers_config, "nonexistent-server", "test://data"
            )

    @pytest.mark.asyncio
    async def test_read_resource_connection_failure_raises(self, sample_servers_config):
        """Test that connection failure raises RuntimeError."""
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(side_effect=ConnectionError("refused"))
        ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)

            from graphton.core.mcp_manager import read_mcp_resource

            with pytest.raises(RuntimeError, match="Failed to read"):
                await read_mcp_resource(
                    sample_servers_config, "github", "test://data"
                )

    @pytest.mark.asyncio
    async def test_read_resource_multiple_contents(self, sample_servers_config):
        """Test reading a resource that returns multiple content items."""
        text1 = MagicMock(spec=TextResourceContents)
        text1.uri = "test://multi"
        text1.mimeType = "text/plain"
        text1.text = "part 1"

        text2 = MagicMock(spec=TextResourceContents)
        text2.uri = "test://multi"
        text2.mimeType = "text/plain"
        text2.text = "part 2"

        read_result = MagicMock()
        read_result.contents = [text1, text2]

        session = AsyncMock()
        session.read_resource = AsyncMock(return_value=read_result)

        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("graphton.core.mcp_manager.MultiServerMCPClient") as mock_class:
            client = MagicMock()
            mock_class.return_value = client
            client.session = MagicMock(return_value=ctx)

            from graphton.core.mcp_manager import read_mcp_resource

            result = await read_mcp_resource(
                sample_servers_config, "github", "test://multi"
            )

        assert len(result) == 2
        assert result[0]["text"] == "part 1"
        assert result[1]["text"] == "part 2"
