"""
Validator for Agent class.
"""

from stigmer.agent.exceptions import ValidationError
from stigmer.agent.validation import rules


class AgentValidator:
    """
    Validates Agent objects before proto conversion.
    
    Ensures that Agent objects meet all proto requirements and business rules.
    """
    
    @staticmethod
    def validate(agent: "Agent") -> None:
        """
        Validate an Agent object.
        
        Args:
            agent: Agent to validate
            
        Raises:
            ValidationError: If validation fails
            
        Example:
            ```python
            agent = Agent(name="test", instructions="Test instructions")
            AgentValidator.validate(agent)  # Raises ValidationError if invalid
            ```
        """
        # Validate name
        rules.validate_name(agent.name, "name")
        
        # Validate instructions (required, min 10 characters)
        rules.validate_instructions(agent.instructions, "instructions")
        
        # Validate description (optional)
        if agent.description:
            rules.validate_description(agent.description, "description")
        
        # Validate icon_url (optional)
        if agent.icon_url:
            rules.validate_url(agent.icon_url, "icon_url")
        
        # Validate skills
        if agent.skills:
            for i, skill in enumerate(agent.skills):
                AgentValidator._validate_skill(skill, f"skills[{i}]")
        
        # Validate MCP servers
        if agent.mcp_servers:
            for i, mcp in enumerate(agent.mcp_servers):
                AgentValidator._validate_mcp_server(mcp, f"mcp_servers[{i}]")
        
        # Validate sub-agents
        if agent.sub_agents:
            for i, sub in enumerate(agent.sub_agents):
                AgentValidator._validate_sub_agent(sub, f"sub_agents[{i}]")
        
        # Validate environment variables
        if agent.environment_variables:
            for i, env in enumerate(agent.environment_variables):
                AgentValidator._validate_environment_variable(env, f"environment_variables[{i}]")
    
    @staticmethod
    def _validate_skill(skill: "Skill", field_name: str) -> None:
        """Validate a Skill reference."""
        if not skill.name:
            raise ValidationError(f"{field_name}.name is required", field=field_name)
        
        rules.validate_name(skill.name, f"{field_name}.name")
        
        if skill.org:
            rules.validate_name(skill.org, f"{field_name}.org")
    
    @staticmethod
    def _validate_mcp_server(mcp: "McpServer", field_name: str) -> None:
        """Validate an MCP server definition."""
        from stigmer.agent.config.mcp_server import McpServerType
        
        if not mcp.name:
            raise ValidationError(f"{field_name}.name is required", field=field_name)
        
        rules.validate_name(mcp.name, f"{field_name}.name")
        
        # Type-specific validation
        if mcp.server_type == McpServerType.STDIO:
            if not mcp.command:
                raise ValidationError(f"{field_name}.command is required for stdio server", field=field_name)
        
        elif mcp.server_type == McpServerType.HTTP:
            if not mcp.url:
                raise ValidationError(f"{field_name}.url is required for http server", field=field_name)
            rules.validate_url(mcp.url, f"{field_name}.url")
        
        elif mcp.server_type == McpServerType.DOCKER:
            if not mcp.image:
                raise ValidationError(f"{field_name}.image is required for docker server", field=field_name)
    
    @staticmethod
    def _validate_sub_agent(sub: "SubAgent", field_name: str) -> None:
        """Validate a SubAgent reference or inline definition."""
        if not sub.name:
            raise ValidationError(f"{field_name}.name is required", field=field_name)
        
        rules.validate_name(sub.name, f"{field_name}.name")
        
        # Must be either a reference or inline
        if not sub.is_reference and not sub.is_inline:
            raise ValidationError(
                f"{field_name} must be either a reference (agent_instance_ref) "
                f"or inline definition (instructions)",
                field=field_name
            )
        
        # Cannot be both
        if sub.is_reference and sub.is_inline:
            raise ValidationError(
                f"{field_name} cannot be both a reference and inline definition",
                field=field_name
            )
        
        # Validate inline sub-agent
        if sub.is_inline:
            rules.validate_instructions(sub.instructions, f"{field_name}.instructions")
            
            if sub.description:
                rules.validate_description(sub.description, f"{field_name}.description")
            
            # Validate skill refs
            if sub.skill_refs:
                for i, skill in enumerate(sub.skill_refs):
                    AgentValidator._validate_skill(skill, f"{field_name}.skill_refs[{i}]")
    
    @staticmethod
    def _validate_environment_variable(env: "EnvironmentVariable", field_name: str) -> None:
        """Validate an environment variable definition."""
        if not env.name:
            raise ValidationError(f"{field_name}.name is required", field=field_name)
        
        # Env var names should be uppercase with underscores
        if not env.name.isupper() or not all(c.isalnum() or c == '_' for c in env.name):
            raise ValidationError(
                f"{field_name}.name must be uppercase with underscores "
                f"(e.g., 'GITHUB_TOKEN'), got '{env.name}'",
                field=field_name
            )
        
        if env.description:
            rules.validate_description(env.description, f"{field_name}.description")
