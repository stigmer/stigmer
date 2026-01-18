"""Basic Agent SDK example - Simple agent definition.

This example shows how to define a basic agent with minimal configuration.
The agent can be deployed using the Stigmer CLI.

Deploy with:
    $ stigmer deploy 01_basic_agent.py --org my-org
"""

from stigmer.agent import Agent

# Define a simple agent
agent = Agent(
    name="hello-agent",
    instructions="""
    You are a friendly assistant that helps users with questions.
    Always be polite and provide clear, concise answers.
    """,
    llm_model="claude-sonnet-4",
)

# Print agent information
print("=" * 60)
print("Agent Definition:")
print("=" * 60)
print(f"Name: {agent.name}")
print(f"LLM Model: {agent.llm_model}")
print(f"Instructions: {agent.instructions.strip()[:60]}...")
print("=" * 60)
print("✅ Agent defined successfully!")
print("=" * 60)
print()
print("To deploy this agent:")
print("  $ stigmer deploy 01_basic_agent.py --org my-org")
print()
print("The agent will be created in Stigmer and can be instantiated")
print("for use in different environments (dev, staging, prod).")
print("=" * 60)

# Convert to proto to verify
agent_proto = agent.to_proto()
print()
print("Proto conversion successful! Agent ready for deployment.")
print("=" * 60)
