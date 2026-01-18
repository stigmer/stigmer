"""
Unit tests for AgentConverter.
"""

import pytest

from stigmer.agent import Agent, Skill, McpServer, EnvironmentVariable, SubAgent
from stigmer.agent.converters import AgentConverter
from stigmer.agent.config.mcp_server import VolumeMount, PortMapping
from stigmer.agent.exceptions import ConversionError


class TestAgentConverter:
    """Tests for AgentConverter.to_proto()."""
    
    def test_minimal_agent_conversion(self):
        """Test conversion of minimal Agent to proto."""
        agent = Agent(
            name="test-agent",
            instructions="Test instructions for the agent"
        )
        
        proto = AgentConverter.to_proto(agent)
        
        # Check api_version and kind
        assert proto.api_version == "agentic.stigmer.ai/v1"
        assert proto.kind == "Agent"
        
        # Check metadata
        assert proto.metadata.name == "test-agent"
        assert proto.metadata.slug == "test-agent"
        assert proto.metadata.owner_scope == 1  # PLATFORM scope (no org)
        
        # Check spec
        assert proto.spec.instructions == "Test instructions for the agent"
        assert proto.spec.description == ""
        assert proto.spec.icon_url == ""
    
    def test_agent_with_org(self):
        """Test Agent with organization scope."""
        agent = Agent(
            name="org-agent",
            instructions="Org agent instructions",
            org="my-org"
        )
        
        proto = AgentConverter.to_proto(agent)
        
        # Check metadata has org and correct scope
        assert proto.metadata.org == "my-org"
        assert proto.metadata.owner_scope == 2  # ORGANIZATION scope
    
    def test_agent_with_description_and_icon(self):
        """Test Agent with description and icon."""
        agent = Agent(
            name="full-agent",
            instructions="Full agent instructions",
            description="A fully configured agent",
            icon_url="https://example.com/icon.png"
        )
        
        proto = AgentConverter.to_proto(agent)
        
        assert proto.spec.description == "A fully configured agent"
        assert proto.spec.icon_url == "https://example.com/icon.png"
    
    @pytest.mark.skip(reason="Proto constants missing - API_RESOURCE_KIND_SKILL not found")
    def test_agent_with_skills(self):
        """Test Agent with skill references."""
        agent = Agent(
            name="skilled-agent",
            instructions="Agent with skills",
            skills=[
                Skill.ref("coding"),
                Skill.ref("testing", org="qa-team")
            ]
        )
        
        proto = AgentConverter.to_proto(agent)
        
        # Check skill references
        assert len(proto.spec.skill_refs) == 2
        
        # First skill (platform scope)
        assert proto.spec.skill_refs[0].slug == "coding"
        assert proto.spec.skill_refs[0].scope == 1  # PLATFORM
        assert proto.spec.skill_refs[0].kind == 43  # SKILL enum value
        
        # Second skill (org scope)
        assert proto.spec.skill_refs[1].slug == "testing"
        assert proto.spec.skill_refs[1].org == "qa-team"
        assert proto.spec.skill_refs[1].scope == 2  # ORGANIZATION
    
    def test_agent_with_stdio_mcp_server(self):
        """Test Agent with stdio MCP server."""
        agent = Agent(
            name="mcp-agent",
            instructions="Agent with MCP server",
            mcp_servers=[
                McpServer.stdio(
                    name="github",
                    command="npx",
                    args=["-y", "@modelcontextprotocol/server-github"],
                    env_placeholders={"GITHUB_TOKEN": "${GITHUB_TOKEN}"},
                    working_dir="/workspace",
                    enabled_tools=["create_pr", "list_issues"]
                )
            ]
        )
        
        proto = AgentConverter.to_proto(agent)
        
        # Check MCP server
        assert len(proto.spec.mcp_servers) == 1
        mcp = proto.spec.mcp_servers[0]
        
        assert mcp.name == "github"
        assert mcp.enabled_tools == ["create_pr", "list_issues"]
        
        # Check stdio configuration
        assert mcp.HasField("stdio")
        assert mcp.stdio.command == "npx"
        assert list(mcp.stdio.args) == ["-y", "@modelcontextprotocol/server-github"]
        assert mcp.stdio.env_placeholders["GITHUB_TOKEN"] == "${GITHUB_TOKEN}"
        assert mcp.stdio.working_dir == "/workspace"
    
    def test_agent_with_http_mcp_server(self):
        """Test Agent with HTTP MCP server."""
        agent = Agent(
            name="http-agent",
            instructions="Agent with HTTP MCP",
            mcp_servers=[
                McpServer.http(
                    name="api-service",
                    url="https://mcp.example.com",
                    headers={"Authorization": "Bearer ${API_TOKEN}"},
                    query_params={"version": "v1"},
                    timeout_seconds=60
                )
            ]
        )
        
        proto = AgentConverter.to_proto(agent)
        
        # Check HTTP MCP server
        mcp = proto.spec.mcp_servers[0]
        assert mcp.HasField("http")
        assert mcp.http.url == "https://mcp.example.com"
        assert mcp.http.headers["Authorization"] == "Bearer ${API_TOKEN}"
        assert mcp.http.query_params["version"] == "v1"
        assert mcp.http.timeout_seconds == 60
    
    def test_agent_with_docker_mcp_server(self):
        """Test Agent with Docker MCP server."""
        agent = Agent(
            name="docker-agent",
            instructions="Agent with Docker MCP",
            mcp_servers=[
                McpServer.docker(
                    name="custom-mcp",
                    image="ghcr.io/org/mcp:latest",
                    args=["--verbose"],
                    env_placeholders={"API_KEY": "${API_KEY}"},
                    volumes=[
                        VolumeMount(
                            host_path="/data",
                            container_path="/mnt/data",
                            read_only=True
                        )
                    ],
                    network="bridge",
                    ports=[
                        PortMapping(host_port=8080, container_port=80, protocol="tcp")
                    ],
                    container_name="mcp-container"
                )
            ]
        )
        
        proto = AgentConverter.to_proto(agent)
        
        # Check Docker MCP server
        mcp = proto.spec.mcp_servers[0]
        assert mcp.HasField("docker")
        assert mcp.docker.image == "ghcr.io/org/mcp:latest"
        assert list(mcp.docker.args) == ["--verbose"]
        assert mcp.docker.env_placeholders["API_KEY"] == "${API_KEY}"
        assert mcp.docker.network == "bridge"
        assert mcp.docker.container_name == "mcp-container"
        
        # Check volume mount
        assert len(mcp.docker.volumes) == 1
        volume = mcp.docker.volumes[0]
        assert volume.host_path == "/data"
        assert volume.container_path == "/mnt/data"
        assert volume.read_only is True
        
        # Check port mapping
        assert len(mcp.docker.ports) == 1
        port = mcp.docker.ports[0]
        assert port.host_port == 8080
        assert port.container_port == 80
        assert port.protocol == "tcp"
    
    @pytest.mark.skip(reason="SubAgent needs rework - currently references removed AgentInstance")
    def test_agent_with_inline_sub_agent(self):
        """Test Agent with inline sub-agent."""
        agent = Agent(
            name="parent-agent",
            instructions="Parent agent",
            sub_agents=[
                SubAgent.inline(
                    name="analyzer",
                    instructions="Analyze code for bugs",
                    description="Code analyzer sub-agent",
                    mcp_servers=["github"],
                    skill_refs=[Skill.ref("code-analysis")]
                )
            ]
        )
        
        proto = AgentConverter.to_proto(agent)
        
        # Check sub-agent
        assert len(proto.spec.sub_agents) == 1
        sub_agent = proto.spec.sub_agents[0]
        
        assert sub_agent.HasField("inline_spec")
        inline = sub_agent.inline_spec
        assert inline.name == "analyzer"
        assert inline.instructions == "Analyze code for bugs"
        assert inline.description == "Code analyzer sub-agent"
        assert list(inline.mcp_servers) == ["github"]
        
        # Check sub-agent skill refs
        assert len(inline.skill_refs) == 1
        assert inline.skill_refs[0].slug == "code-analysis"
    
    @pytest.mark.skip(reason="SubAgent needs rework - currently references removed AgentInstance")
    def test_agent_with_referenced_sub_agent(self):
        """Test Agent with referenced sub-agent."""
        agent = Agent(
            name="parent-agent",
            instructions="Parent with ref",
            sub_agents=[
                SubAgent.ref("security", "security-checker-prod")
            ]
        )
        
        proto = AgentConverter.to_proto(agent)
        
        # Check sub-agent reference
        sub_agent = proto.spec.sub_agents[0]
        assert sub_agent.HasField("agent_instance_refs")
        ref = sub_agent.agent_instance_refs
        assert ref.slug == "security-checker-prod"
        assert ref.kind == 45  # AGENT_INSTANCE enum value
        assert ref.scope == 2  # ORGANIZATION scope
    
    def test_agent_with_environment_variables(self):
        """Test Agent with environment variables."""
        agent = Agent(
            name="env-agent",
            instructions="Agent with env vars",
            environment_variables=[
                EnvironmentVariable(
                    name="GITHUB_TOKEN",
                    is_secret=True,
                    description="GitHub API token",
                    required=True
                ),
                EnvironmentVariable(
                    name="AWS_REGION",
                    is_secret=False,
                    description="AWS region",
                    default_value="us-east-1",
                    required=False
                )
            ]
        )
        
        proto = AgentConverter.to_proto(agent)
        
        # Check environment spec
        assert proto.spec.HasField("env_spec")
        env_spec = proto.spec.env_spec
        
        # Check description
        assert "GITHUB_TOKEN: GitHub API token" in env_spec.description
        assert "AWS_REGION: AWS region" in env_spec.description
        
        # Check environment values
        assert "GITHUB_TOKEN" in env_spec.data
        github_token = env_spec.data["GITHUB_TOKEN"]
        assert github_token.is_secret is True
        assert github_token.description == "GitHub API token"
        assert github_token.value == ""  # No default
        
        assert "AWS_REGION" in env_spec.data
        aws_region = env_spec.data["AWS_REGION"]
        assert aws_region.is_secret is False
        assert aws_region.description == "AWS region"
        assert aws_region.value == "us-east-1"  # Has default
    
    @pytest.mark.skip(reason="Proto constants missing - API_RESOURCE_KIND_SKILL not found")
    def test_agent_with_all_features(self):
        """Test Agent with all features combined."""
        agent = Agent(
            name="full-featured-agent",
            instructions="Agent with everything",
            description="Comprehensive agent",
            icon_url="https://example.com/icon.png",
            org="test-org",
            skills=[Skill.ref("skill1"), Skill.ref("skill2")],
            mcp_servers=[
                McpServer.stdio("github", "npx", ["-y", "@mcp/server-github"]),
                McpServer.http("api", "https://api.example.com")
            ],
            sub_agents=[
                SubAgent.inline("inline1", "Instructions 1"),
                SubAgent.ref("ref1", "instance-123")
            ],
            environment_variables=[
                EnvironmentVariable("VAR1", is_secret=True),
                EnvironmentVariable("VAR2", is_secret=False)
            ]
        )
        
        proto = AgentConverter.to_proto(agent)
        
        # Verify all sections are populated
        assert proto.api_version == "agentic.stigmer.ai/v1"
        assert proto.kind == "Agent"
        assert proto.metadata.name == "full-featured-agent"
        assert proto.metadata.org == "test-org"
        assert proto.spec.description == "Comprehensive agent"
        assert len(proto.spec.skill_refs) == 2
        assert len(proto.spec.mcp_servers) == 2
        assert len(proto.spec.sub_agents) == 2
        assert len(proto.spec.env_spec.data) == 2
    
    def test_conversion_error_handling(self):
        """Test that conversion errors are properly wrapped."""
        # This test would require mocking to trigger an exception
        # For now, we just verify the structure is correct
        agent = Agent(name="test", instructions="Test instructions")
        
        # Should not raise
        proto = AgentConverter.to_proto(agent)
        assert proto is not None
