"""Unit tests for MCP resource tools module.

Tests cover:
- create_resource_tools() factory function
- list_mcp_resources tool behavior (JSON output, empty results, errors)
- read_mcp_resource tool behavior (text content, errors, invalid server)
"""

from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture
def sample_servers():
    """Sample MCP server configurations."""
    return {
        "planton": {
            "transport": "streamable_http",
            "url": "https://mcp.planton.ai/",
            "headers": {"Authorization": "Bearer test-token"},
        },
    }


class TestCreateResourceTools:
    """Tests for create_resource_tools() factory function."""

    def test_creates_two_tools(self, sample_servers):
        """Test that factory creates exactly two tools."""
        from graphton.core.resource_tools import create_resource_tools

        tools = create_resource_tools(sample_servers)

        assert len(tools) == 2
        tool_names = [t.name for t in tools]
        assert "list_mcp_resources" in tool_names
        assert "read_mcp_resource" in tool_names

    def test_tools_have_descriptions(self, sample_servers):
        """Test that both tools have non-empty descriptions."""
        from graphton.core.resource_tools import create_resource_tools

        tools = create_resource_tools(sample_servers)

        for tool in tools:
            assert tool.description, f"Tool '{tool.name}' has no description"
            assert len(tool.description) > 20

    @pytest.mark.asyncio
    async def test_list_tool_returns_json(self, sample_servers):
        """Test that list tool returns JSON with resource data."""
        mock_result = {
            "planton": {
                "resources": [
                    {
                        "uri": "planton://cloud-resource-kinds",
                        "name": "cloud-resource-kinds",
                        "description": "Available kinds",
                        "mime_type": "application/json",
                    }
                ],
                "resource_templates": [
                    {
                        "uri_template": "cloud-resource-schema://{kind}",
                        "name": "cloud-resource-schema",
                        "description": "Schema for a kind",
                        "mime_type": "application/json",
                    }
                ],
            }
        }

        with patch(
            "graphton.core.resource_tools._list_resources",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            from graphton.core.resource_tools import create_resource_tools

            tools = create_resource_tools(sample_servers)
            list_tool = next(t for t in tools if t.name == "list_mcp_resources")

            result = await list_tool.ainvoke({})

        assert "planton" in result
        assert "cloud-resource-schema://{kind}" in result
        assert "planton://cloud-resource-kinds" in result

    @pytest.mark.asyncio
    async def test_list_tool_no_resources(self, sample_servers):
        """Test that list tool handles empty result gracefully."""
        with patch(
            "graphton.core.resource_tools._list_resources",
            new_callable=AsyncMock,
            return_value={},
        ):
            from graphton.core.resource_tools import create_resource_tools

            tools = create_resource_tools(sample_servers)
            list_tool = next(t for t in tools if t.name == "list_mcp_resources")

            result = await list_tool.ainvoke({})

        assert "no mcp resources" in result.lower()

    @pytest.mark.asyncio
    async def test_list_tool_handles_error(self, sample_servers):
        """Test that list tool returns error message on failure."""
        with patch(
            "graphton.core.resource_tools._list_resources",
            new_callable=AsyncMock,
            side_effect=RuntimeError("connection failed"),
        ):
            from graphton.core.resource_tools import create_resource_tools

            tools = create_resource_tools(sample_servers)
            list_tool = next(t for t in tools if t.name == "list_mcp_resources")

            result = await list_tool.ainvoke({})

        assert "error" in result.lower()

    @pytest.mark.asyncio
    async def test_read_tool_returns_text_content(self, sample_servers):
        """Test that read tool returns text content directly."""
        mock_contents = [
            {
                "text": '{"kind": "AwsAlb", "fields": ["name", "subnets"]}',
                "uri": "cloud-resource-schema://AwsAlb",
                "mime_type": "application/json",
            }
        ]

        with patch(
            "graphton.core.resource_tools._read_resource",
            new_callable=AsyncMock,
            return_value=mock_contents,
        ):
            from graphton.core.resource_tools import create_resource_tools

            tools = create_resource_tools(sample_servers)
            read_tool = next(t for t in tools if t.name == "read_mcp_resource")

            result = await read_tool.ainvoke(
                {"server_name": "planton", "uri": "cloud-resource-schema://AwsAlb"}
            )

        assert result == '{"kind": "AwsAlb", "fields": ["name", "subnets"]}'

    @pytest.mark.asyncio
    async def test_read_tool_empty_content(self, sample_servers):
        """Test that read tool handles empty content."""
        with patch(
            "graphton.core.resource_tools._read_resource",
            new_callable=AsyncMock,
            return_value=[],
        ):
            from graphton.core.resource_tools import create_resource_tools

            tools = create_resource_tools(sample_servers)
            read_tool = next(t for t in tools if t.name == "read_mcp_resource")

            result = await read_tool.ainvoke(
                {"server_name": "planton", "uri": "test://empty"}
            )

        assert "no content" in result.lower()

    @pytest.mark.asyncio
    async def test_read_tool_invalid_server(self, sample_servers):
        """Test that read tool handles invalid server name."""
        with patch(
            "graphton.core.resource_tools._read_resource",
            new_callable=AsyncMock,
            side_effect=ValueError("Server 'bad-server' not found."),
        ):
            from graphton.core.resource_tools import create_resource_tools

            tools = create_resource_tools(sample_servers)
            read_tool = next(t for t in tools if t.name == "read_mcp_resource")

            result = await read_tool.ainvoke(
                {"server_name": "bad-server", "uri": "test://x"}
            )

        assert "error" in result.lower()
        assert "not found" in result.lower()

    @pytest.mark.asyncio
    async def test_read_tool_multiple_contents_returns_json(self, sample_servers):
        """Test that read tool returns JSON when resource has multiple contents."""
        mock_contents = [
            {"text": "part 1", "uri": "test://multi", "mime_type": "text/plain"},
            {"text": "part 2", "uri": "test://multi", "mime_type": "text/plain"},
        ]

        with patch(
            "graphton.core.resource_tools._read_resource",
            new_callable=AsyncMock,
            return_value=mock_contents,
        ):
            from graphton.core.resource_tools import create_resource_tools

            tools = create_resource_tools(sample_servers)
            read_tool = next(t for t in tools if t.name == "read_mcp_resource")

            result = await read_tool.ainvoke(
                {"server_name": "planton", "uri": "test://multi"}
            )

        assert "part 1" in result
        assert "part 2" in result

    @pytest.mark.asyncio
    async def test_read_tool_runtime_error(self, sample_servers):
        """Test that read tool handles RuntimeError from connection failure."""
        with patch(
            "graphton.core.resource_tools._read_resource",
            new_callable=AsyncMock,
            side_effect=RuntimeError("connection refused"),
        ):
            from graphton.core.resource_tools import create_resource_tools

            tools = create_resource_tools(sample_servers)
            read_tool = next(t for t in tools if t.name == "read_mcp_resource")

            result = await read_tool.ainvoke(
                {"server_name": "planton", "uri": "test://fail"}
            )

        assert "error" in result.lower()
        assert "connection refused" in result.lower()
