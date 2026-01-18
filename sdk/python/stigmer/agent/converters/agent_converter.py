"""
Converter for Agent SDK class to proto message.
"""

from typing import TYPE_CHECKING

from stigmer.agent.exceptions import ConversionError

# Import proto stubs
from ai.stigmer.agentic.agent.v1 import api_pb2, spec_pb2
from ai.stigmer.agentic.environment.v1 import spec_pb2 as env_spec_pb2
from ai.stigmer.commons.apiresource import io_pb2, metadata_pb2
from ai.stigmer.commons.apiresource.apiresourcekind import (
    api_resource_kind_pb2,
)
from ai.stigmer.commons.apiresource.enum_pb2 import ApiResourceOwnerScope

if TYPE_CHECKING:
    from stigmer.agent.agent import Agent


class AgentConverter:
    """Converts Agent SDK instances to proto messages."""
    
    @staticmethod
    def to_proto(agent: "Agent") -> api_pb2.Agent:
        """
        Convert Agent SDK instance to proto message.
        
        Args:
            agent: Agent SDK instance
            
        Returns:
            ai.stigmer.agentic.agent.v1.Agent proto message
            
        Raises:
            ConversionError: If conversion fails
            
        Example:
            ```python
            agent = Agent(name="test", instructions="Test instructions")
            proto = AgentConverter.to_proto(agent)
            ```
        """
        try:
            # Create the proto message
            proto = api_pb2.Agent()
            
            # Set api_version and kind (constants)
            proto.api_version = "agentic.stigmer.ai/v1"
            proto.kind = "Agent"
            
            # Build metadata
            proto.metadata.CopyFrom(AgentConverter._build_metadata(agent))
            
            # Build spec
            proto.spec.CopyFrom(AgentConverter._build_spec(agent))
            
            # Status is system-managed, leave empty for creation
            
            return proto
            
        except Exception as e:
            raise ConversionError(
                f"Failed to convert Agent to proto: {str(e)}",
                source_type="Agent"
            ) from e
    
    @staticmethod
    def _build_metadata(agent: "Agent") -> metadata_pb2.ApiResourceMetadata:
        """Build ApiResourceMetadata from Agent."""
        metadata = metadata_pb2.ApiResourceMetadata()
        
        # Set name and slug (use name as slug for creation)
        metadata.name = agent.name
        metadata.slug = agent.name
        
        # Set org if provided
        if agent.org:
            metadata.org = agent.org
        
        # Set owner_scope
        # Agent can only have platform (1) or organization (2) scope
        # Default to organization if org is provided, otherwise platform
        if agent.org:
            metadata.owner_scope = ApiResourceOwnerScope.organization
        else:
            metadata.owner_scope = ApiResourceOwnerScope.platform
        
        return metadata
    
    @staticmethod
    def _build_spec(agent: "Agent") -> spec_pb2.AgentSpec:
        """Build AgentSpec from Agent."""
        spec = spec_pb2.AgentSpec()
        
        # Set basic fields
        if agent.description:
            spec.description = agent.description
        
        if agent.icon_url:
            spec.icon_url = agent.icon_url
        
        spec.instructions = agent.instructions
        
        # Convert MCP servers
        if agent.mcp_servers:
            for mcp_server in agent.mcp_servers:
                mcp_proto = AgentConverter._convert_mcp_server(mcp_server)
                spec.mcp_servers.append(mcp_proto)
        
        # Convert skill references
        if agent.skills:
            for skill in agent.skills:
                skill_ref = AgentConverter._convert_skill_ref(skill)
                spec.skill_refs.append(skill_ref)
        
        # Convert sub-agents
        if agent.sub_agents:
            for sub_agent in agent.sub_agents:
                sub_agent_proto = AgentConverter._convert_sub_agent(sub_agent)
                spec.sub_agents.append(sub_agent_proto)
        
        # Convert environment variables to EnvironmentSpec
        if agent.environment_variables:
            env_spec = AgentConverter._convert_environment_variables(
                agent.environment_variables
            )
            spec.env_spec.CopyFrom(env_spec)
        
        return spec
    
    @staticmethod
    def _convert_mcp_server(mcp_server) -> spec_pb2.McpServerDefinition:
        """Convert McpServer SDK instance to proto."""
        from stigmer.agent.config.mcp_server import McpServerType
        
        mcp_proto = spec_pb2.McpServerDefinition()
        mcp_proto.name = mcp_server.name
        
        # Set enabled_tools if provided
        if mcp_server.enabled_tools:
            mcp_proto.enabled_tools.extend(mcp_server.enabled_tools)
        
        # Convert based on server type
        if mcp_server.server_type == McpServerType.STDIO:
            stdio = spec_pb2.StdioServer()
            stdio.command = mcp_server.command
            
            if mcp_server.args:
                stdio.args.extend(mcp_server.args)
            
            if mcp_server.env_placeholders:
                for key, value in mcp_server.env_placeholders.items():
                    stdio.env_placeholders[key] = value
            
            if mcp_server.working_dir:
                stdio.working_dir = mcp_server.working_dir
            
            mcp_proto.stdio.CopyFrom(stdio)
        
        elif mcp_server.server_type == McpServerType.HTTP:
            http = spec_pb2.HttpServer()
            http.url = mcp_server.url
            
            if mcp_server.headers:
                for key, value in mcp_server.headers.items():
                    http.headers[key] = value
            
            if mcp_server.query_params:
                for key, value in mcp_server.query_params.items():
                    http.query_params[key] = value
            
            if mcp_server.timeout_seconds:
                http.timeout_seconds = mcp_server.timeout_seconds
            
            mcp_proto.http.CopyFrom(http)
        
        elif mcp_server.server_type == McpServerType.DOCKER:
            docker = spec_pb2.DockerServer()
            docker.image = mcp_server.image
            
            if mcp_server.args:
                docker.args.extend(mcp_server.args)
            
            if mcp_server.env_placeholders:
                for key, value in mcp_server.env_placeholders.items():
                    docker.env_placeholders[key] = value
            
            if mcp_server.volumes:
                for volume in mcp_server.volumes:
                    volume_proto = spec_pb2.VolumeMount()
                    volume_proto.host_path = volume.host_path
                    volume_proto.container_path = volume.container_path
                    volume_proto.read_only = volume.read_only
                    docker.volumes.append(volume_proto)
            
            if mcp_server.network:
                docker.network = mcp_server.network
            
            if mcp_server.ports:
                for port in mcp_server.ports:
                    port_proto = spec_pb2.PortMapping()
                    port_proto.host_port = port.host_port
                    port_proto.container_port = port.container_port
                    port_proto.protocol = port.protocol
                    docker.ports.append(port_proto)
            
            if mcp_server.container_name:
                docker.container_name = mcp_server.container_name
            
            mcp_proto.docker.CopyFrom(docker)
        
        return mcp_proto
    
    @staticmethod
    def _convert_skill_ref(skill) -> io_pb2.ApiResourceReference:
        """Convert Skill SDK instance to ApiResourceReference proto."""
        ref = io_pb2.ApiResourceReference()
        
        # Set scope (organization if org provided, otherwise platform)
        if skill.org:
            ref.scope = ApiResourceOwnerScope.organization
            ref.org = skill.org
        else:
            ref.scope = ApiResourceOwnerScope.platform
        
        # Set kind to skill (enum value 43)
        ref.kind = api_resource_kind_pb2.API_RESOURCE_KIND_SKILL
        
        # Set slug (use name as slug)
        ref.slug = skill.name
        
        return ref
    
    @staticmethod
    def _convert_sub_agent(sub_agent) -> spec_pb2.SubAgent:
        """Convert SubAgent SDK instance to proto."""
        sub_agent_proto = spec_pb2.SubAgent()
        
        if sub_agent.is_reference:
            # Referenced sub-agent
            ref = io_pb2.ApiResourceReference()
            ref.kind = api_resource_kind_pb2.API_RESOURCE_KIND_AGENT_INSTANCE
            ref.slug = sub_agent.agent_instance_ref
            # Scope defaults to organization, will be resolved by server
            ref.scope = ApiResourceOwnerScope.organization
            sub_agent_proto.agent_instance_refs.CopyFrom(ref)
        
        elif sub_agent.is_inline:
            # Inline sub-agent
            inline = spec_pb2.InlineSubAgentSpec()
            inline.name = sub_agent.name
            
            if sub_agent.description:
                inline.description = sub_agent.description
            
            inline.instructions = sub_agent.instructions
            
            if sub_agent.mcp_servers:
                inline.mcp_servers.extend(sub_agent.mcp_servers)
            
            if sub_agent.mcp_tool_selections:
                for server_name, tools in sub_agent.mcp_tool_selections.items():
                    tool_selection = spec_pb2.McpToolSelection()
                    tool_selection.enabled_tools.extend(tools)
                    inline.mcp_tool_selections[server_name].CopyFrom(tool_selection)
            
            if sub_agent.skill_refs:
                for skill in sub_agent.skill_refs:
                    skill_ref = AgentConverter._convert_skill_ref(skill)
                    inline.skill_refs.append(skill_ref)
            
            sub_agent_proto.inline_spec.CopyFrom(inline)
        
        return sub_agent_proto
    
    @staticmethod
    def _convert_environment_variables(env_vars) -> env_spec_pb2.EnvironmentSpec:
        """Convert list of EnvironmentVariable to EnvironmentSpec proto."""
        env_spec = env_spec_pb2.EnvironmentSpec()
        
        # Build description from env var list
        descriptions = []
        for env_var in env_vars:
            if env_var.description:
                descriptions.append(f"{env_var.name}: {env_var.description}")
        
        if descriptions:
            env_spec.description = "; ".join(descriptions)
        
        # Convert each env var to EnvironmentValue
        for env_var in env_vars:
            env_value = env_spec_pb2.EnvironmentValue()
            
            # Use default_value if provided, otherwise empty string
            env_value.value = env_var.default_value or ""
            env_value.is_secret = env_var.is_secret
            
            if env_var.description:
                env_value.description = env_var.description
            
            env_spec.data[env_var.name].CopyFrom(env_value)
        
        return env_spec
