"""Built-in tools for agent execution.

This module provides tools that are injected directly into the agent,
independent of MCP servers. These tools enable core agent capabilities
like publishing downloadable outputs.

Usage:
    from worker.tools import create_publish_output_tool
    
    # Create tool with dependencies injected
    tool = create_publish_output_tool(
        sandbox=sandbox,
        storage=artifact_storage,
        execution_id=execution_id,
        status_builder=status_builder,
    )
    
    # Tool is a LangChain StructuredTool that can be passed to create_deep_agent
    agent = create_deep_agent(
        model="claude-sonnet-4.5",
        system_prompt="...",
        tools=[tool],  # Pass the publish_output tool
    )
"""

from worker.tools.publish_output import (
    publish_output,
    create_publish_output_tool,
)

__all__ = [
    "publish_output",
    "create_publish_output_tool",
]
