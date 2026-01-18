"""Agent with Skills - Using skill references.

This example shows how to define an agent with skills.
Skills provide specialized capabilities that agents can use.

Deploy with:
    $ stigmer deploy 02_agent_with_skills.py --org my-org
"""

from stigmer.agent import Agent, Skill

# Define an agent with multiple skills
agent = Agent(
    name="code-reviewer",
    description="AI code reviewer with best practices",
    instructions="""
    Review code changes and provide constructive feedback.
    
    Focus on:
    - Code quality and best practices
    - Security vulnerabilities
    - Performance issues
    - Test coverage
    - Documentation
    
    Use your coding and security analysis skills to provide
    comprehensive reviews.
    """,
    llm_model="claude-sonnet-4",
    # Add skills - these reference pre-defined skill templates
    skills=[
        Skill.ref("coding"),  # Platform skill
        Skill.ref("security-analysis"),  # Platform skill
        Skill.ref("custom-style-guide", org="my-org"),  # Organization skill
    ],
    icon="🔍",
)

# Print agent information
print("=" * 60)
print("Code Review Agent Definition:")
print("=" * 60)
print(f"Name: {agent.name}")
print(f"Description: {agent.description}")
print(f"LLM Model: {agent.llm_model}")
print(f"Skills: {len(agent.skills)}")
for skill in agent.skills:
    scope = f"org:{skill.org}" if skill.org else "platform"
    print(f"  - {skill.name} ({scope})")
print("=" * 60)
print("✅ Code review agent defined successfully!")
print("=" * 60)

# Convert to proto to verify
agent_proto = agent.to_proto()
print()
print("Proto conversion successful!")
print(f"Agent has {len(agent_proto.spec.skill_refs)} skill references")
print("=" * 60)
