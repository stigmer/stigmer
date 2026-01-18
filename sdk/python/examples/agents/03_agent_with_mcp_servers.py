"""Agent with MCP Servers - External tool integration.

This example shows how to define an agent with MCP (Model Context Protocol) servers.
MCP servers provide external tool capabilities like filesystem access, APIs, databases, etc.

Deploy with:
    $ stigmer deploy 03_agent_with_mcp_servers.py --org my-org
"""

from stigmer.agent import Agent, McpServer, Skill

# Define an agent with multiple MCP server types
agent = Agent(
    name="github-agent",
    description="GitHub integration agent",
    instructions="""
    You are a GitHub assistant that can interact with repositories.
    
    You can:
    - Read and search code
    - Create issues and pull requests
    - Review code changes
    - Manage labels and milestones
    
    Use the GitHub MCP server to interact with repositories.
    Always verify permissions before making changes.
    """,
    llm_model="claude-sonnet-4",
    skills=[
        Skill.ref("coding"),
        Skill.ref("git-operations"),
    ],
    # Add MCP servers
    mcp_servers=[
        # Stdio MCP server - runs a local command
        McpServer.stdio(
            name="github",
            command="npx",
            args=["-y", "@mcp/server-github"],
            # Environment variable placeholders (resolved at instance level)
            env_placeholders={
                "GITHUB_TOKEN": "${GITHUB_TOKEN}",
            }
        ),
        # Filesystem MCP server for reading code
        McpServer.stdio(
            name="filesystem",
            command="npx",
            args=["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
        ),
    ],
    icon="🐙",
)

# Print agent information
print("=" * 60)
print("GitHub Agent Definition:")
print("=" * 60)
print(f"Name: {agent.name}")
print(f"Description: {agent.description}")
print(f"MCP Servers: {len(agent.mcp_servers)}")
for mcp in agent.mcp_servers:
    print(f"  - {mcp.name} ({mcp.type})")
    if mcp.env_placeholders:
        print(f"    Env vars: {', '.join(mcp.env_placeholders.keys())}")
print("=" * 60)
print("✅ GitHub agent defined successfully!")
print("=" * 60)

# Convert to proto to verify
agent_proto = agent.to_proto()
print()
print("Proto conversion successful!")
print(f"Agent has {len(agent_proto.spec.mcp_servers)} MCP servers configured")
print()
print("Note: Environment variables like GITHUB_TOKEN will be")
print("provided when creating an AgentInstance (see next examples)")
print("=" * 60)
