"""Shared pytest fixtures for Graphton tests."""

import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def mock_mcp_tool():
    """Create a mock LangChain BaseTool."""
    tool = MagicMock()
    tool.name = "mock_tool"
    tool.description = "A mock tool for testing"
    return tool


@pytest.fixture
def mock_mcp_tools():
    """Create a list of mock MCP tools."""
    tools = []
    tool_names = ["search_code", "create_pr", "list_files", "unused_tool"]
    for name in tool_names:
        tool = MagicMock()
        tool.name = name
        tool.description = f"Description for {name}"
        tools.append(tool)
    return tools


@pytest.fixture
def sample_servers_config():
    """Create sample MCP server configurations."""
    return {
        "github": {
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "env": {"GITHUB_TOKEN": "test-token"},
        },
        "custom-api": {
            "transport": "streamable_http",
            "url": "https://api.example.com/mcp",
            "headers": {"Authorization": "Bearer secret123"},
            "timeout": 30,
        },
    }


@pytest.fixture
def sample_tool_filter():
    """Create sample tool filter configuration."""
    return {
        "github": ["search_code", "create_pr"],
        "custom-api": ["list_resources"],
    }
