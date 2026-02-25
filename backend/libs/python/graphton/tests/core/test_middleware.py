"""Unit tests for MCP middleware module.

Tests cover:
- McpToolsLoader initialization (sync loading, deferred loading)
- Deferred loading via abefore_agent()
- Tool access via get_tool()
- Error handling (loading failures, missing tools)
"""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# =============================================================================
# TestMcpToolsLoaderInit - Tests for initialization
# =============================================================================


class TestMcpToolsLoaderInit:
    """Tests for McpToolsLoader initialization."""

    @pytest.fixture
    def mock_load_mcp_tools(self, mock_mcp_tools):
        """Mock load_mcp_tools function."""
        with patch('graphton.core.middleware.load_mcp_tools') as mock:
            mock.return_value = mock_mcp_tools
            yield mock

    @pytest.fixture
    def mock_asyncio_no_loop(self):
        """Mock asyncio to simulate no event loop in current thread."""
        with patch('graphton.core.middleware.asyncio') as mock_asyncio:
            mock_loop = MagicMock()
            mock_loop.is_running.return_value = False
            mock_loop.run_until_complete = MagicMock(
                side_effect=lambda coro: asyncio.get_event_loop().run_until_complete(coro)
            )
            
            # Raise RuntimeError to simulate no event loop
            mock_asyncio.get_event_loop.side_effect = RuntimeError("No event loop")
            mock_asyncio.new_event_loop.return_value = mock_loop
            mock_asyncio.set_event_loop = MagicMock()
            
            yield mock_asyncio, mock_loop

    def test_sync_loading_no_event_loop(
        self, sample_servers_config, sample_tool_filter, mock_mcp_tools
    ):
        """Test that tools load synchronously when no event loop exists."""
        with patch('graphton.core.middleware.load_mcp_tools', new_callable=AsyncMock) as mock_load:
            mock_load.return_value = mock_mcp_tools
            
            with patch('graphton.core.middleware.asyncio') as mock_asyncio:
                mock_loop = MagicMock()
                mock_loop.is_running.return_value = False
                
                # Define run_until_complete to actually run the coroutine
                async def run_coro(coro):
                    return await coro
                mock_loop.run_until_complete = lambda coro: asyncio.get_event_loop().run_until_complete(coro)
                
                mock_asyncio.get_event_loop.side_effect = RuntimeError("No event loop")
                mock_asyncio.new_event_loop.return_value = mock_loop
                mock_asyncio.set_event_loop = MagicMock()
                
                from graphton.core.middleware import McpToolsLoader
                
                middleware = McpToolsLoader(sample_servers_config, sample_tool_filter)
                
                # Assert tools were loaded
                assert middleware._tools_loaded is True
                assert middleware._deferred_loading is False
                assert len(middleware._tools_cache) == len(mock_mcp_tools)

    def test_deferred_loading_in_async_context(
        self, sample_servers_config, sample_tool_filter
    ):
        """Test that tool loading is deferred when event loop is running."""
        with patch('graphton.core.middleware.load_mcp_tools') as mock_load, \
             patch('graphton.core.middleware.asyncio') as mock_asyncio:
            
            mock_loop = MagicMock()
            mock_loop.is_running.return_value = True  # Event loop is running
            mock_asyncio.get_event_loop.return_value = mock_loop
            
            from graphton.core.middleware import McpToolsLoader
            
            middleware = McpToolsLoader(sample_servers_config, sample_tool_filter)
            
            # Assert loading was deferred
            assert middleware._deferred_loading is True
            assert middleware._tools_loaded is False
            
            # load_mcp_tools should NOT have been called yet
            mock_load.assert_not_called()

    def test_loading_failure_raises_runtime_error(
        self, sample_servers_config, sample_tool_filter
    ):
        """Test that loading failure raises RuntimeError."""
        with patch('graphton.core.middleware.load_mcp_tools', new_callable=AsyncMock), \
             patch('graphton.core.middleware.asyncio') as mock_asyncio:
            
            mock_loop = MagicMock()
            mock_loop.is_running.return_value = False
            mock_loop.run_until_complete = MagicMock(
                side_effect=ConnectionError("Failed to connect")
            )
            mock_asyncio.get_event_loop.side_effect = RuntimeError("No loop")
            mock_asyncio.new_event_loop.return_value = mock_loop
            mock_asyncio.set_event_loop = MagicMock()
            
            from graphton.core.middleware import McpToolsLoader
            
            with pytest.raises(RuntimeError) as exc_info:
                McpToolsLoader(sample_servers_config, sample_tool_filter)
            
            assert "mcp tool loading failed" in str(exc_info.value).lower()


# =============================================================================
# TestMcpToolsLoaderDeferredLoading - Tests for deferred tool loading
# =============================================================================


class TestMcpToolsLoaderDeferredLoading:
    """Tests for deferred tool loading via abefore_agent()."""

    @pytest.fixture
    def middleware_with_deferred_loading(self, sample_servers_config, sample_tool_filter):
        """Create middleware instance with deferred loading state."""
        with patch('graphton.core.middleware.asyncio') as mock_asyncio:
            mock_loop = MagicMock()
            mock_loop.is_running.return_value = True
            mock_asyncio.get_event_loop.return_value = mock_loop
            
            from graphton.core.middleware import McpToolsLoader
            middleware = McpToolsLoader(sample_servers_config, sample_tool_filter)
            
            return middleware

    @pytest.mark.asyncio
    async def test_async_loading_on_first_invocation(
        self, middleware_with_deferred_loading, mock_mcp_tools
    ):
        """Test that deferred tools are loaded on first abefore_agent() call."""
        with patch('graphton.core.middleware.load_mcp_tools', new_callable=AsyncMock) as mock_load:
            mock_load.return_value = mock_mcp_tools
            
            # Verify deferred state
            assert middleware_with_deferred_loading._deferred_loading is True
            assert middleware_with_deferred_loading._tools_loaded is False
            
            # Call abefore_agent
            mock_state = MagicMock()
            mock_runtime = MagicMock()
            
            await middleware_with_deferred_loading.abefore_agent(mock_state, mock_runtime)
            
            # Assert tools were loaded
            mock_load.assert_called_once()
            assert middleware_with_deferred_loading._tools_loaded is True
            assert middleware_with_deferred_loading._deferred_loading is False

    @pytest.mark.asyncio
    async def test_tools_cached_after_loading(
        self, middleware_with_deferred_loading, mock_mcp_tools
    ):
        """Test that tools are properly cached after deferred loading."""
        with patch('graphton.core.middleware.load_mcp_tools', new_callable=AsyncMock) as mock_load:
            mock_load.return_value = mock_mcp_tools
            
            mock_state = MagicMock()
            mock_runtime = MagicMock()
            
            await middleware_with_deferred_loading.abefore_agent(mock_state, mock_runtime)
            
            # Verify cache
            assert len(middleware_with_deferred_loading._tools_cache) == len(mock_mcp_tools)
            for tool in mock_mcp_tools:
                assert tool.name in middleware_with_deferred_loading._tools_cache

    @pytest.mark.asyncio
    async def test_deferred_loading_failure(
        self, middleware_with_deferred_loading
    ):
        """Test that deferred loading failure raises RuntimeError."""
        with patch('graphton.core.middleware.load_mcp_tools', new_callable=AsyncMock) as mock_load:
            mock_load.side_effect = ConnectionError("Failed to connect")
            
            mock_state = MagicMock()
            mock_runtime = MagicMock()
            
            with pytest.raises(RuntimeError) as exc_info:
                await middleware_with_deferred_loading.abefore_agent(mock_state, mock_runtime)
            
            assert "deferred" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_abefore_agent_skips_if_already_loaded(
        self, sample_servers_config, sample_tool_filter, mock_mcp_tools, caplog
    ):
        """Test that abefore_agent() skips loading if tools are already loaded."""
        with patch('graphton.core.middleware.load_mcp_tools', new_callable=AsyncMock) as mock_load:
            mock_load.return_value = mock_mcp_tools
            
            with patch('graphton.core.middleware.asyncio') as mock_asyncio:
                mock_loop = MagicMock()
                mock_loop.is_running.return_value = False
                mock_loop.run_until_complete = lambda coro: asyncio.get_event_loop().run_until_complete(coro)
                mock_asyncio.get_event_loop.side_effect = RuntimeError("No loop")
                mock_asyncio.new_event_loop.return_value = mock_loop
                mock_asyncio.set_event_loop = MagicMock()
                
                from graphton.core.middleware import McpToolsLoader
                middleware = McpToolsLoader(sample_servers_config, sample_tool_filter)
                
                # Tools should already be loaded
                assert middleware._tools_loaded is True
                
                # Reset mock to track new calls
                mock_load.reset_mock()
                
                # Call abefore_agent
                mock_state = MagicMock()
                mock_runtime = MagicMock()
                
                with caplog.at_level(logging.DEBUG):
                    await middleware.abefore_agent(mock_state, mock_runtime)
                
                # load_mcp_tools should NOT have been called again
                mock_load.assert_not_called()


# =============================================================================
# TestMcpToolsLoaderToolAccess - Tests for get_tool() method
# =============================================================================


class TestMcpToolsLoaderToolAccess:
    """Tests for get_tool() method."""

    @pytest.fixture
    def loaded_middleware(self, sample_servers_config, sample_tool_filter, mock_mcp_tools):
        """Create middleware with tools already loaded."""
        with patch('graphton.core.middleware.load_mcp_tools', new_callable=AsyncMock) as mock_load:
            mock_load.return_value = mock_mcp_tools
            
            with patch('graphton.core.middleware.asyncio') as mock_asyncio:
                mock_loop = MagicMock()
                mock_loop.is_running.return_value = False
                mock_loop.run_until_complete = lambda coro: asyncio.get_event_loop().run_until_complete(coro)
                mock_asyncio.get_event_loop.side_effect = RuntimeError("No loop")
                mock_asyncio.new_event_loop.return_value = mock_loop
                mock_asyncio.set_event_loop = MagicMock()
                
                from graphton.core.middleware import McpToolsLoader
                return McpToolsLoader(sample_servers_config, sample_tool_filter)

    def test_get_tool_success(self, loaded_middleware):
        """Test successful tool retrieval by name."""
        # Get a tool that exists
        tool = loaded_middleware.get_tool("search_code")
        
        assert tool is not None
        assert tool.name == "search_code"

    def test_get_tool_not_loaded_raises(self, sample_servers_config, sample_tool_filter):
        """Test that get_tool() raises RuntimeError if tools not loaded."""
        with patch('graphton.core.middleware.asyncio') as mock_asyncio:
            mock_loop = MagicMock()
            mock_loop.is_running.return_value = True  # Deferred loading
            mock_asyncio.get_event_loop.return_value = mock_loop
            
            from graphton.core.middleware import McpToolsLoader
            middleware = McpToolsLoader(sample_servers_config, sample_tool_filter)
            
            # Tools should be deferred
            assert middleware._tools_loaded is False
            
            with pytest.raises(RuntimeError) as exc_info:
                middleware.get_tool("any_tool")
            
            assert "not loaded yet" in str(exc_info.value).lower()

    def test_get_tool_not_found_raises(self, loaded_middleware):
        """Test that get_tool() raises ValueError for unknown tool name."""
        with pytest.raises(ValueError) as exc_info:
            loaded_middleware.get_tool("nonexistent_tool")
        
        assert "not found" in str(exc_info.value).lower()
        assert "nonexistent_tool" in str(exc_info.value)

    def test_tools_available_by_name(self, loaded_middleware, mock_mcp_tools):
        """Test that all cached tools are accessible by name."""
        for tool in mock_mcp_tools:
            retrieved = loaded_middleware.get_tool(tool.name)
            assert retrieved.name == tool.name


# =============================================================================
# TestMcpToolsLoaderLifecycle - Tests for full middleware lifecycle
# =============================================================================


class TestMcpToolsLoaderLifecycle:
    """Tests for complete middleware lifecycle."""

    @pytest.mark.asyncio
    async def test_aafter_agent_keeps_tools_cached(
        self, sample_servers_config, sample_tool_filter, mock_mcp_tools
    ):
        """Test that aafter_agent() keeps tools cached."""
        with patch('graphton.core.middleware.load_mcp_tools', new_callable=AsyncMock) as mock_load:
            mock_load.return_value = mock_mcp_tools
            
            with patch('graphton.core.middleware.asyncio') as mock_asyncio:
                mock_loop = MagicMock()
                mock_loop.is_running.return_value = False
                mock_loop.run_until_complete = lambda coro: asyncio.get_event_loop().run_until_complete(coro)
                mock_asyncio.get_event_loop.side_effect = RuntimeError("No loop")
                mock_asyncio.new_event_loop.return_value = mock_loop
                mock_asyncio.set_event_loop = MagicMock()
                
                from graphton.core.middleware import McpToolsLoader
                middleware = McpToolsLoader(sample_servers_config, sample_tool_filter)
                
                # Call aafter_agent
                mock_state = MagicMock()
                mock_runtime = MagicMock()
                
                result = await middleware.aafter_agent(mock_state, mock_runtime)
                
                # Should return None
                assert result is None
                
                # Tools should still be cached
                assert middleware._tools_loaded is True
                assert len(middleware._tools_cache) == len(mock_mcp_tools)

    @pytest.mark.asyncio
    async def test_full_lifecycle_sync_context(
        self, sample_servers_config, sample_tool_filter, mock_mcp_tools
    ):
        """Test complete lifecycle in sync context (tools loaded at init)."""
        with patch('graphton.core.middleware.load_mcp_tools', new_callable=AsyncMock) as mock_load:
            mock_load.return_value = mock_mcp_tools
            
            with patch('graphton.core.middleware.asyncio') as mock_asyncio:
                mock_loop = MagicMock()
                mock_loop.is_running.return_value = False
                mock_loop.run_until_complete = lambda coro: asyncio.get_event_loop().run_until_complete(coro)
                mock_asyncio.get_event_loop.side_effect = RuntimeError("No loop")
                mock_asyncio.new_event_loop.return_value = mock_loop
                mock_asyncio.set_event_loop = MagicMock()
                
                from graphton.core.middleware import McpToolsLoader
                
                # 1. Create middleware - tools load immediately
                middleware = McpToolsLoader(sample_servers_config, sample_tool_filter)
                assert middleware._tools_loaded is True
                
                # 2. Call abefore_agent - should skip loading
                mock_state = MagicMock()
                mock_runtime = MagicMock()
                mock_load.reset_mock()
                
                await middleware.abefore_agent(mock_state, mock_runtime)
                mock_load.assert_not_called()  # Already loaded
                
                # 3. Access tools
                tool = middleware.get_tool("search_code")
                assert tool.name == "search_code"
                
                # 4. Call aafter_agent - tools remain
                await middleware.aafter_agent(mock_state, mock_runtime)
                assert middleware._tools_loaded is True

    @pytest.mark.asyncio
    async def test_full_lifecycle_async_context(
        self, sample_servers_config, sample_tool_filter, mock_mcp_tools
    ):
        """Test complete lifecycle in async context (deferred loading)."""
        with patch('graphton.core.middleware.load_mcp_tools', new_callable=AsyncMock) as mock_load:
            mock_load.return_value = mock_mcp_tools
            
            with patch('graphton.core.middleware.asyncio') as mock_asyncio:
                mock_loop = MagicMock()
                mock_loop.is_running.return_value = True  # Async context
                mock_asyncio.get_event_loop.return_value = mock_loop
                
                from graphton.core.middleware import McpToolsLoader
                
                # 1. Create middleware - loading is deferred
                middleware = McpToolsLoader(sample_servers_config, sample_tool_filter)
                assert middleware._deferred_loading is True
                assert middleware._tools_loaded is False
                mock_load.assert_not_called()
                
                # 2. Call abefore_agent - tools load now
                mock_state = MagicMock()
                mock_runtime = MagicMock()
                
                await middleware.abefore_agent(mock_state, mock_runtime)
                mock_load.assert_called_once()
                assert middleware._tools_loaded is True
                
                # 3. Access tools
                tool = middleware.get_tool("search_code")
                assert tool.name == "search_code"
                
                # 4. Call aafter_agent - tools remain
                await middleware.aafter_agent(mock_state, mock_runtime)
                assert middleware._tools_loaded is True
