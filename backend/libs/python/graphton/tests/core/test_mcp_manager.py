"""Unit tests for MCP manager module.

Tests cover:
- load_mcp_tools() function
- Input validation (empty servers, empty filter)
- Tool filtering logic
- Error handling (connection failures, no matching tools)
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

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
