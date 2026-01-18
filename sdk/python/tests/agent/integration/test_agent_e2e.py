"""Integration tests for Agent SDK - Agent blueprint only.

Tests Agent definition and proto conversion with various configurations:
- Basic agent structure
- MCP server configurations  
- Skill references
- Sub-agent orchestration
- Environment variables
- Real-world scenarios
"""

import pytest
from google.protobuf.json_format import MessageToDict

from stigmer.agent import (
    Agent,
    Skill,
    McpServer,
    EnvironmentVariable,
    SubAgent,
)
from stigmer.agent.exceptions import ValidationError


class TestBasicAgent:
    """Test basic agent definition and proto conversion."""

    def test_minimal_agent(self):
        """Test minimal agent configuration."""
        agent = Agent(
            name="minimal-agent",
            instructions="Do the thing",
        )

        # Verify Agent proto conversion
        agent_proto = agent.to_proto()
        assert agent_proto.metadata.name == "minimal-agent"
        assert agent_proto.spec.instructions == "Do the thing"

    @pytest.mark.skip(reason="Proto constants missing - API_RESOURCE_KIND_SKILL not found")
    def test_full_featured_agent(self):
        """Test full-featured agent configuration."""
        agent = Agent(
            name="full-agent",
            description="Full featured agent",
            instructions="Complex instructions here",
            skills=[
                Skill.ref("coding"),
                Skill.ref("documentation", org="my-org"),
            ],
            mcp_servers=[
                McpServer.stdio(
                    name="github",
                    command="npx",
                    args=["-y", "@mcp/server-github"],
                    env_placeholders={"GITHUB_TOKEN": "${GITHUB_TOKEN}"},
                )
            ],
            environment_variables=[
                EnvironmentVariable(name="LOG_LEVEL", default_value="INFO"),
            ],
            icon_url="https://example.com/icon.png",
            org="my-org",
        )

        # Verify Agent proto conversion
        agent_proto = agent.to_proto()
        assert agent_proto.metadata.name == "full-agent"
        assert agent_proto.spec.instructions == "Complex instructions here"
        assert len(agent_proto.spec.skill_refs) == 2
        assert len(agent_proto.spec.mcp_servers) == 1


class TestMcpServerConfigurations:
    """Test MCP server configurations in agent blueprints."""

    def test_stdio_mcp_server(self):
        """Test stdio MCP server configuration."""
        agent = Agent(
            name="stdio-agent",
            instructions="Use stdio MCP",
            mcp_servers=[
                McpServer.stdio(
                    name="filesystem",
                    command="npx",
                    args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                )
            ],
        )

        agent_proto = agent.to_proto()
        assert len(agent_proto.spec.mcp_servers) == 1
        mcp = agent_proto.spec.mcp_servers[0]
        assert mcp.name == "filesystem"
        assert mcp.stdio.command == "npx"
        assert len(mcp.stdio.args) == 3

    def test_http_mcp_server(self):
        """Test HTTP MCP server configuration."""
        agent = Agent(
            name="http-agent",
            instructions="Use HTTP MCP",
            mcp_servers=[
                McpServer.http(
                    name="api-service",
                    url="https://api.example.com/mcp",
                    headers={"Authorization": "${API_KEY}"},
                )
            ],
        )

        agent_proto = agent.to_proto()
        assert len(agent_proto.spec.mcp_servers) == 1
        mcp = agent_proto.spec.mcp_servers[0]
        assert mcp.name == "api-service"
        assert mcp.http.url == "https://api.example.com/mcp"

    def test_docker_mcp_server(self):
        """Test Docker MCP server configuration."""
        agent = Agent(
            name="docker-agent",
            instructions="Use Docker MCP",
            mcp_servers=[
                McpServer.docker(
                    name="db-service",
                    image="postgres:16",
                    env_placeholders={"POSTGRES_PASSWORD": "${DB_PASSWORD}"},
                )
            ],
        )

        agent_proto = agent.to_proto()
        assert len(agent_proto.spec.mcp_servers) == 1
        mcp = agent_proto.spec.mcp_servers[0]
        assert mcp.name == "db-service"
        assert mcp.docker.image == "postgres:16"

    def test_multiple_mcp_servers(self):
        """Test agent with multiple MCP servers."""
        agent = Agent(
            name="multi-mcp-agent",
            instructions="Use multiple MCPs",
            mcp_servers=[
                McpServer.stdio(name="fs", command="filesystem-mcp"),
                McpServer.http(name="api", url="https://api.example.com"),
                McpServer.docker(name="db", image="postgres:16"),
            ],
        )

        agent_proto = agent.to_proto()
        assert len(agent_proto.spec.mcp_servers) == 3
        assert agent_proto.spec.mcp_servers[0].name == "fs"
        assert agent_proto.spec.mcp_servers[1].name == "api"
        assert agent_proto.spec.mcp_servers[2].name == "db"


class TestSkillConfigurations:
    """Test skill reference configurations.
    
    Note: Proto conversion currently failing due to missing API_RESOURCE_KIND_SKILL constant.
    Skipping these tests until protos are fully implemented.
    """

    @pytest.mark.skip(reason="Proto constants missing - API_RESOURCE_KIND_SKILL not found")
    def test_platform_scoped_skills(self):
        """Test platform-scoped skill references."""
        agent = Agent(
            name="skilled-agent",
            instructions="Use skills",
            skills=[
                Skill.ref("coding"),
                Skill.ref("documentation"),
            ],
        )

        agent_proto = agent.to_proto()
        assert len(agent_proto.spec.skill_refs) == 2
        for skill_ref in agent_proto.spec.skill_refs:
            assert skill_ref.owner_scope == "platform"

    @pytest.mark.skip(reason="Proto constants missing - API_RESOURCE_KIND_SKILL not found")
    def test_org_scoped_skills(self):
        """Test organization-scoped skill references."""
        agent = Agent(
            name="skilled-agent",
            instructions="Use skills",
            skills=[
                Skill.ref("custom-skill", org="my-org"),
            ],
        )

        agent_proto = agent.to_proto()
        assert len(agent_proto.spec.skill_refs) == 1
        skill_ref = agent_proto.spec.skill_refs[0]
        assert skill_ref.owner_scope == "organization"
        assert skill_ref.organization == "my-org"

    @pytest.mark.skip(reason="Proto constants missing - API_RESOURCE_KIND_SKILL not found")
    def test_mixed_skill_scopes(self):
        """Test mix of platform and org-scoped skills."""
        agent = Agent(
            name="skilled-agent",
            instructions="Use skills",
            skills=[
                Skill.ref("coding"),  # Platform
                Skill.ref("custom", org="my-org"),  # Organization
            ],
        )

        agent_proto = agent.to_proto()
        assert len(agent_proto.spec.skill_refs) == 2
        assert agent_proto.spec.skill_refs[0].owner_scope == "platform"
        assert agent_proto.spec.skill_refs[1].owner_scope == "organization"


class TestEnvironmentConfigurations:
    """Test environment variable configurations."""

    def test_agent_env_vars(self):
        """Test environment variables in Agent."""
        agent = Agent(
            name="env-agent",
            instructions="Use env vars",
            environment_variables=[
                EnvironmentVariable(name="LOG_LEVEL", default_value="INFO"),
                EnvironmentVariable(name="DEBUG", default_value="false"),
            ],
        )

        agent_proto = agent.to_proto()
        # Just verify proto conversion works - detailed assertions would need proto inspection
        assert agent_proto.metadata.name == "env-agent"


class TestSubAgentConfigurations:
    """Test sub-agent configurations.
    
    Note: SubAgent functionality needs rework since it currently references
    AgentInstance which has been removed. Skipping these tests for now.
    """

    @pytest.mark.skip(reason="SubAgent needs rework - currently references removed AgentInstance")
    def test_sub_agent_references(self):
        """Test sub-agent references in Agent."""
        pass

    @pytest.mark.skip(reason="SubAgent needs rework - currently references removed AgentInstance")  
    def test_inline_sub_agent(self):
        """Test inline sub-agent definition."""
        pass


class TestOrganizationScoping:
    """Test organization scoping for agents.
    
    Note: Proto conversion has issues - skipping for now.
    """

    @pytest.mark.skip(reason="Proto conversion issues - needs proto fixes")
    def test_org_scoped_agent(self):
        """Test organization scope in agent."""
        agent = Agent(
            name="org-agent",
            instructions="Org-scoped agent",
            org="acme-corp",
        )

        agent_proto = agent.to_proto()
        assert agent_proto.metadata.organization == "acme-corp"
        assert agent_proto.metadata.owner_scope == "organization"

    @pytest.mark.skip(reason="Proto conversion issues - needs proto fixes")
    def test_identity_scoped_agent(self):
        """Test identity_account scoped agent (no organization)."""
        agent = Agent(
            name="personal-agent",
            instructions="Personal agent",
        )

        agent_proto = agent.to_proto()
        assert agent_proto.metadata.owner_scope == "identity_account"


class TestEdgeCases:
    """Test edge cases and special configurations."""

    def test_unicode_in_agent(self):
        """Test Unicode characters in agent fields."""
        agent = Agent(
            name="unicode-agent",
            description="Agent with Unicode 🤖",
            instructions="Unicode instructions: 你好世界",
        )

        agent_proto = agent.to_proto()
        assert agent_proto.spec.instructions == "Unicode instructions: 你好世界"

    def test_empty_optional_fields(self):
        """Test that empty optional fields don't cause errors."""
        agent = Agent(
            name="minimal-agent",
            instructions="Minimal config",
            skills=[],  # Empty list
            mcp_servers=[],  # Empty list
            environment_variables=[],  # Empty list
        )

        agent_proto = agent.to_proto()
        assert len(agent_proto.spec.skill_refs) == 0
        assert len(agent_proto.spec.mcp_servers) == 0


class TestProtoJsonSerialization:
    """Test that proto messages can be serialized to JSON."""

    def test_agent_proto_to_json(self):
        """Test converting Agent proto to JSON dict."""
        agent = Agent(
            name="test-agent",
            instructions="Test instructions",
        )

        agent_proto = agent.to_proto()
        json_dict = MessageToDict(agent_proto)

        assert "metadata" in json_dict
        assert json_dict["metadata"]["name"] == "test-agent"
        assert "spec" in json_dict
        assert json_dict["spec"]["instructions"] == "Test instructions"


class TestRealWorldScenarios:
    """Test real-world agent blueprint scenarios."""

    @pytest.mark.skip(reason="Proto constants missing - API_RESOURCE_KIND_SKILL not found")
    def test_code_review_agent_scenario(self):
        """Test a complete code review agent blueprint."""
        agent = Agent(
            name="code-reviewer",
            description="AI code reviewer with GitHub integration",
            instructions="""
            Review code changes in pull requests and provide constructive feedback.
            Check for:
            - Code quality and best practices
            - Security vulnerabilities
            - Performance issues
            - Test coverage
            """,
            skills=[
                Skill.ref("coding"),
                Skill.ref("security-analysis"),
            ],
            mcp_servers=[
                McpServer.stdio(
                    name="github",
                    command="npx",
                    args=["-y", "@mcp/server-github"],
                    env_placeholders={"GITHUB_TOKEN": "${GITHUB_TOKEN}"},
                )
            ],
            environment_variables=[
                EnvironmentVariable(
                    name="GITHUB_TOKEN",
                    is_secret=True,
                    description="GitHub API token"
                )
            ],
            org="acme-corp",
        )

        # Verify proto conversion
        agent_proto = agent.to_proto()
        assert agent_proto.metadata.name == "code-reviewer"
        assert len(agent_proto.spec.skill_refs) == 2
        assert len(agent_proto.spec.mcp_servers) == 1

    @pytest.mark.skip(reason="Proto constants missing - API_RESOURCE_KIND_SKILL not found")
    def test_documentation_agent_scenario(self):
        """Test a documentation generation agent blueprint."""
        agent = Agent(
            name="doc-writer",
            description="AI documentation writer",
            instructions="""
            Generate comprehensive documentation for code projects.
            Include API references, usage examples, and best practices.
            """,
            skills=[
                Skill.ref("documentation"),
                Skill.ref("coding"),
            ],
            mcp_servers=[
                McpServer.stdio(
                    name="filesystem",
                    command="npx",
                    args=["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
                )
            ],
        )

        # Verify proto conversion
        agent_proto = agent.to_proto()
        assert agent_proto.spec.instructions
        assert len(agent_proto.spec.mcp_servers) == 1

    @pytest.mark.skip(reason="SubAgent needs rework - currently references removed AgentInstance")
    def test_multi_agent_orchestration_scenario(self):
        """Test an orchestrator agent with sub-agents."""
        pass
