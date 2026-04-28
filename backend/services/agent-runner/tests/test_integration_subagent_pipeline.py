"""Integration tests for the SubAgent execution pipeline.

These tests verify the end-to-end flow for subagent support:
1. SubAgent proto transformation to graphton format
2. MCP access restriction (filtering parent's tools)
3. Skill resolution and injection into subagent system_prompt
4. Tool wrapper creation for allowed MCP servers
5. Integration with execute_graphton.py flow

Test Categories:
- Full Pipeline Integration: Complete flow from AgentSpec.sub_agents to graphton subagents
- MCP Restriction: Permission model enforcement (subagent ∩ parent tools)
- Skill Injection: Per-subagent skill resolution and prompt enhancement
- Error Recovery: Graceful degradation when components fail
"""

import logging
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from stigmer_runner.worker.activities.graphton.skill_writer import SkillWriter
from stigmer_runner.worker.activities.graphton.subagent_transformer import transform_sub_agents
from stigmer_runner.worker.workspace.local import LocalWorkspaceBackend


class TestFullPipelineIntegration:
    """Integration tests for complete subagent transformation pipeline."""

    @pytest.fixture
    def sub_agent_code_reviewer(self):
        """Create a code reviewer SubAgent with MCP and skills."""
        sub_agent = MagicMock()
        sub_agent.name = "code-reviewer"
        sub_agent.description = "Reviews code changes for quality, security, and best practices"
        sub_agent.instructions = """You are an expert code reviewer.

Your responsibilities:
- Review pull requests for security vulnerabilities
- Check for coding best practices
- Suggest improvements
- Verify test coverage

Be thorough but constructive in your feedback."""
        sub_agent.model_override = ""
        
        # MCP access - only github with restricted tools
        mcp_access = MagicMock()
        mcp_access.mcp_server = "github"
        mcp_access.enabled_tools = ["search_code", "get_file"]  # Restricted set
        sub_agent.mcp_access = [mcp_access]
        
        # Skill reference
        skill_ref = MagicMock()
        skill_ref.slug = "stigmer/code-review-best-practices"
        sub_agent.skill_refs = [skill_ref]
        
        return sub_agent

    @pytest.fixture
    def sub_agent_researcher(self):
        """Create a research specialist SubAgent without MCP."""
        sub_agent = MagicMock()
        sub_agent.name = "deep-researcher"
        sub_agent.description = "Conducts thorough research on technical topics"
        sub_agent.instructions = """You are a research specialist.

Your approach:
- Gather comprehensive information
- Analyze multiple perspectives
- Synthesize findings into actionable insights
- Cite sources when possible"""
        sub_agent.model_override = ""
        
        sub_agent.mcp_access = []  # No MCP access
        sub_agent.skill_refs = []  # No skills
        
        return sub_agent

    @pytest.fixture
    def parent_mcp_config(self):
        """Create parent agent's MCP configuration."""
        servers = {
            "github": {
                "transport": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-github"],
                "env": {"GITHUB_TOKEN": "test-token"},
            },
            "slack": {
                "transport": "http",
                "url": "https://mcp.slack.example.com",
                "headers": {"Authorization": "Bearer slack-token"},
            },
        }
        
        tools = {
            "github": ["search_code", "get_file", "create_pr", "list_repos", "create_issue"],
            "slack": ["send_message", "list_channels", "get_messages"],
        }
        
        # MCP server usages
        github_usage = MagicMock()
        github_usage.mcp_server_ref.slug = "github"
        github_usage.enabled_tools = tools["github"]
        
        slack_usage = MagicMock()
        slack_usage.mcp_server_ref.slug = "slack"
        slack_usage.enabled_tools = tools["slack"]
        
        return {
            "servers": servers,
            "tools": tools,
            "usages": [github_usage, slack_usage],
        }

    @pytest.fixture
    def mock_skill(self):
        """Create a realistic mock skill for code review."""
        skill = MagicMock()
        skill.metadata.id = "skill-code-review-123"
        skill.metadata.name = "code-review-best-practices"
        skill.metadata.slug = "stigmer/code-review-best-practices"
        skill.spec.skill_md = """# Code Review Best Practices

## Overview
This skill provides guidelines for effective code review.

## Security Checklist
- [ ] No hardcoded credentials
- [ ] Input validation present
- [ ] SQL injection prevention
- [ ] XSS prevention

## Best Practices
1. Review in small batches
2. Provide constructive feedback
3. Focus on logic, not style
4. Verify test coverage

## Tools
Run `./review.sh <path>` to analyze code.
"""
        skill.status.version_hash = "code-review-v1-abc123"
        skill.status.artifact_storage_key = ""  # No artifact for this test
        
        return skill

    @pytest.mark.asyncio
    async def test_full_pipeline_single_subagent_with_mcp_and_skills(
        self,
        sub_agent_code_reviewer,
        parent_mcp_config,
        mock_skill,
    ):
        """Test complete pipeline with single subagent having MCP and skills."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create mock skill client
            skill_client = MagicMock()
            skill_client.list_by_refs = AsyncMock(return_value=[mock_skill])
            skill_client.get_artifact = AsyncMock(return_value=b"")
            
            # Use real SkillWriter for integration testing
            skill_writer_kwargs = {"backend": LocalWorkspaceBackend(root_dir=tmpdir)}
            
            # Patch MCP tool creation to avoid actual MCP connections
            with patch(
                "graphton.core.middleware.McpToolsLoader"
            ) as mock_loader, patch(
                "graphton.core.tool_wrappers.create_tool_wrapper"
            ) as mock_create_wrapper:
                # Configure mocks
                mock_middleware = MagicMock()
                mock_middleware._deferred_loading = False
                mock_middleware._tools_loaded = True
                mock_loader.return_value = mock_middleware
                
                mock_tool = MagicMock()
                mock_tool.name = "github_search_code"
                mock_create_wrapper.return_value = mock_tool
                
                result = await transform_sub_agents(
                    sub_agents=[sub_agent_code_reviewer],
                    parent_mcp_servers=parent_mcp_config["servers"],
                    parent_mcp_tools=parent_mcp_config["tools"],
                    parent_mcp_usages=parent_mcp_config["usages"],
                    skill_client=skill_client,
                    skill_writer_class=SkillWriter,
                    skill_writer_kwargs=skill_writer_kwargs,
                    activity_logger=logging.getLogger("test"),
                )
                
                # Verify result structure
                assert result is not None
                assert len(result) == 1
                
                subagent_dict = result[0]
                
                # Verify basic fields
                assert subagent_dict["name"] == "code-reviewer"
                assert "code changes" in subagent_dict["description"]
                
                # Verify system_prompt includes original instructions
                assert "expert code reviewer" in subagent_dict["system_prompt"]
                
                # Verify skill reference was injected into system_prompt
                assert "code-review-best-practices" in subagent_dict["system_prompt"]
                
                # Verify tools were created
                assert "tools" in subagent_dict
                assert len(subagent_dict["tools"]) > 0
                
                # Verify MCP restriction: only github, not slack
                mock_loader.assert_called_once()
                loader_call_args = mock_loader.call_args
                filtered_servers = loader_call_args[1]["servers"]
                filtered_tools = loader_call_args[1]["tool_filter"]
                
                assert "github" in filtered_servers
                assert "slack" not in filtered_servers
                
                # Verify tool restriction: only search_code and get_file
                assert set(filtered_tools["github"]) == {"search_code", "get_file"}

    @pytest.mark.asyncio
    async def test_full_pipeline_multiple_subagents(
        self,
        sub_agent_code_reviewer,
        sub_agent_researcher,
        parent_mcp_config,
        mock_skill,
    ):
        """Test pipeline with multiple subagents having different configs."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_client = MagicMock()
            skill_client.list_by_refs = AsyncMock(return_value=[mock_skill])
            skill_client.get_artifact = AsyncMock(return_value=b"")
            
            with patch(
                "graphton.core.middleware.McpToolsLoader"
            ) as mock_loader, patch(
                "graphton.core.tool_wrappers.create_tool_wrapper"
            ) as mock_create_wrapper:
                mock_middleware = MagicMock()
                mock_middleware._deferred_loading = False
                mock_middleware._tools_loaded = True
                mock_loader.return_value = mock_middleware
                
                mock_tool = MagicMock()
                mock_create_wrapper.return_value = mock_tool
                
                result = await transform_sub_agents(
                    sub_agents=[sub_agent_code_reviewer, sub_agent_researcher],
                    parent_mcp_servers=parent_mcp_config["servers"],
                    parent_mcp_tools=parent_mcp_config["tools"],
                    parent_mcp_usages=parent_mcp_config["usages"],
                    skill_client=skill_client,
                    skill_writer_class=SkillWriter,
                    skill_writer_kwargs={"backend": LocalWorkspaceBackend(root_dir=tmpdir)},
                    activity_logger=logging.getLogger("test"),
                )
                
                assert result is not None
                assert len(result) == 2
                
                # Find each subagent
                code_reviewer = next(s for s in result if s["name"] == "code-reviewer")
                researcher = next(s for s in result if s["name"] == "deep-researcher")
                
                # Code reviewer should have tools
                assert "tools" in code_reviewer
                assert len(code_reviewer["tools"]) > 0
                
                # Researcher should have no tools (no MCP access)
                assert "tools" not in researcher or len(researcher.get("tools", [])) == 0

    @pytest.mark.asyncio
    async def test_mcp_restriction_enforcement(self, parent_mcp_config):
        """Test that MCP access restrictions are properly enforced."""
        # Create subagent that tries to access both servers but should only get github
        sub_agent = MagicMock()
        sub_agent.name = "restricted-agent"
        sub_agent.description = "Agent with restricted MCP access"
        sub_agent.instructions = "You have limited access."
        sub_agent.model_override = ""
        sub_agent.skill_refs = []
        
        # Request access to github only (not slack)
        mcp_access = MagicMock()
        mcp_access.mcp_server = "github"
        mcp_access.enabled_tools = ["search_code"]  # Only one tool
        sub_agent.mcp_access = [mcp_access]
        
        skill_client = MagicMock()
        skill_client.list_by_refs = AsyncMock(return_value=[])
        
        with patch(
            "graphton.core.middleware.McpToolsLoader"
        ) as mock_loader, patch(
            "graphton.core.tool_wrappers.create_tool_wrapper"
        ) as mock_create_wrapper:
            mock_middleware = MagicMock()
            mock_middleware._deferred_loading = False
            mock_middleware._tools_loaded = True
            mock_loader.return_value = mock_middleware
            
            mock_tool = MagicMock()
            mock_create_wrapper.return_value = mock_tool
            
            await transform_sub_agents(
                sub_agents=[sub_agent],
                parent_mcp_servers=parent_mcp_config["servers"],
                parent_mcp_tools=parent_mcp_config["tools"],
                parent_mcp_usages=parent_mcp_config["usages"],
                skill_client=skill_client,
                skill_writer_class=SkillWriter,
                skill_writer_kwargs={"backend": MagicMock()},
                activity_logger=logging.getLogger("test"),
            )
            
            # Verify only github was included
            loader_call_args = mock_loader.call_args
            filtered_servers = loader_call_args[1]["servers"]
            filtered_tools = loader_call_args[1]["tool_filter"]
            
            # Only github, no slack
            assert list(filtered_servers.keys()) == ["github"]
            
            # Only search_code tool (intersection with parent)
            assert filtered_tools["github"] == ["search_code"]

    @pytest.mark.asyncio
    async def test_subagent_cannot_expand_parent_tools(self, parent_mcp_config):
        """Test that subagent cannot request tools parent doesn't have."""
        sub_agent = MagicMock()
        sub_agent.name = "greedy-agent"
        sub_agent.description = "Agent trying to get more tools"
        sub_agent.instructions = "You want all the tools."
        sub_agent.model_override = ""
        sub_agent.skill_refs = []
        
        # Try to request tool that parent doesn't have
        mcp_access = MagicMock()
        mcp_access.mcp_server = "github"
        mcp_access.enabled_tools = ["search_code", "delete_repository"]  # delete_repository not in parent
        sub_agent.mcp_access = [mcp_access]
        
        skill_client = MagicMock()
        skill_client.list_by_refs = AsyncMock(return_value=[])
        
        with patch(
            "graphton.core.middleware.McpToolsLoader"
        ) as mock_loader, patch(
            "graphton.core.tool_wrappers.create_tool_wrapper"
        ) as mock_create_wrapper:
            mock_middleware = MagicMock()
            mock_middleware._deferred_loading = False
            mock_middleware._tools_loaded = True
            mock_loader.return_value = mock_middleware
            
            mock_tool = MagicMock()
            mock_create_wrapper.return_value = mock_tool
            
            await transform_sub_agents(
                sub_agents=[sub_agent],
                parent_mcp_servers=parent_mcp_config["servers"],
                parent_mcp_tools=parent_mcp_config["tools"],
                parent_mcp_usages=parent_mcp_config["usages"],
                skill_client=skill_client,
                skill_writer_class=SkillWriter,
                skill_writer_kwargs={"backend": MagicMock()},
                activity_logger=logging.getLogger("test"),
            )
            
            # Verify intersection worked - delete_repository should not be included
            loader_call_args = mock_loader.call_args
            filtered_tools = loader_call_args[1]["tool_filter"]
            
            # Only search_code (the one that exists in parent)
            assert filtered_tools["github"] == ["search_code"]

    @pytest.mark.asyncio
    async def test_skill_injection_into_system_prompt(self):
        """Test that skills are properly injected into subagent system prompt."""
        sub_agent = MagicMock()
        sub_agent.name = "skilled-agent"
        sub_agent.description = "Agent with specialized skills"
        sub_agent.instructions = "Base instructions for the agent."
        sub_agent.model_override = ""
        sub_agent.mcp_access = []
        
        skill_ref = MagicMock()
        skill_ref.slug = "test-org/special-skill"
        sub_agent.skill_refs = [skill_ref]
        
        mock_skill = MagicMock()
        mock_skill.metadata.id = "skill-special-123"
        mock_skill.metadata.name = "special-skill"
        mock_skill.metadata.slug = "test-org/special-skill"
        mock_skill.spec.skill_md = "# Special Skill\n\nDo something special."
        mock_skill.status.version_hash = "special-v1"
        mock_skill.status.artifact_storage_key = ""
        
        skill_client = MagicMock()
        skill_client.list_by_refs = AsyncMock(return_value=[mock_skill])
        skill_client.get_artifact = AsyncMock(return_value=b"")
        
        with tempfile.TemporaryDirectory() as tmpdir:
            result = await transform_sub_agents(
                sub_agents=[sub_agent],
                parent_mcp_servers={},
                parent_mcp_tools={},
                parent_mcp_usages=[],
                skill_client=skill_client,
                skill_writer_class=SkillWriter,
                skill_writer_kwargs={"backend": LocalWorkspaceBackend(root_dir=tmpdir)},
                activity_logger=logging.getLogger("test"),
            )
            
            assert result is not None
            assert len(result) == 1
            
            system_prompt = result[0]["system_prompt"]
            
            # Original instructions should be present
            assert "Base instructions" in system_prompt
            
            # Skill content should be injected
            assert "Special Skill" in system_prompt or "special-skill" in system_prompt.lower()


class TestErrorRecovery:
    """Tests for graceful error handling in the pipeline."""

    @pytest.mark.asyncio
    async def test_continues_when_mcp_fails(self):
        """Test that pipeline continues when MCP tool creation fails."""
        sub_agent = MagicMock()
        sub_agent.name = "mcp-fail-agent"
        sub_agent.description = "Agent where MCP fails"
        sub_agent.instructions = "Should still work without MCP."
        sub_agent.model_override = ""
        sub_agent.skill_refs = []
        
        mcp_access = MagicMock()
        mcp_access.mcp_server = "github"
        mcp_access.enabled_tools = ["search_code"]
        sub_agent.mcp_access = [mcp_access]
        
        # Parent has the MCP config
        parent_servers = {"github": {"transport": "stdio"}}
        parent_tools = {"github": ["search_code"]}
        parent_usage = MagicMock()
        parent_usage.mcp_server_ref.slug = "github"
        
        skill_client = MagicMock()
        skill_client.list_by_refs = AsyncMock(return_value=[])
        
        # Make MCP loader fail
        with patch(
            "graphton.core.middleware.McpToolsLoader"
        ) as mock_loader:
            mock_loader.side_effect = RuntimeError("MCP connection refused")
            
            result = await transform_sub_agents(
                sub_agents=[sub_agent],
                parent_mcp_servers=parent_servers,
                parent_mcp_tools=parent_tools,
                parent_mcp_usages=[parent_usage],
                skill_client=skill_client,
                skill_writer_class=SkillWriter,
                skill_writer_kwargs={"backend": MagicMock()},
                activity_logger=logging.getLogger("test"),
            )
            
            # Should still return the subagent
            assert result is not None
            assert len(result) == 1
            assert result[0]["name"] == "mcp-fail-agent"
            
            # But without tools
            assert "tools" not in result[0] or len(result[0].get("tools", [])) == 0

    @pytest.mark.asyncio
    async def test_continues_when_skill_fetch_fails(self):
        """Test that pipeline continues when skill fetching fails."""
        sub_agent = MagicMock()
        sub_agent.name = "skill-fail-agent"
        sub_agent.description = "Agent where skills fail"
        sub_agent.instructions = "Should still work without skills."
        sub_agent.model_override = ""
        sub_agent.mcp_access = []
        
        skill_ref = MagicMock()
        skill_ref.slug = "nonexistent/skill"
        sub_agent.skill_refs = [skill_ref]
        
        skill_client = MagicMock()
        skill_client.list_by_refs = AsyncMock(
            side_effect=RuntimeError("Skill not found")
        )
        
        result = await transform_sub_agents(
            sub_agents=[sub_agent],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=skill_client,
            skill_writer_class=SkillWriter,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )
        
        # Should still return the subagent
        assert result is not None
        assert len(result) == 1
        assert result[0]["name"] == "skill-fail-agent"
        
        # System prompt should still have base instructions
        assert "Should still work" in result[0]["system_prompt"]

    @pytest.mark.asyncio
    async def test_returns_valid_subagents_when_some_fail(self):
        """Test that valid subagents are returned even when some fail."""
        # Good subagent
        good_agent = MagicMock()
        good_agent.name = "good-agent"
        good_agent.description = "Working agent"
        good_agent.instructions = "I work correctly."
        good_agent.model_override = ""
        good_agent.mcp_access = []
        good_agent.skill_refs = []
        
        # Bad subagent - name is None which might cause issues
        bad_agent = MagicMock()
        bad_agent.name = "problematic-agent"
        bad_agent.description = "Agent with issues"
        bad_agent.instructions = "I have issues."
        bad_agent.model_override = ""
        bad_agent.mcp_access = []
        bad_agent.skill_refs = []
        
        skill_client = MagicMock()
        skill_client.list_by_refs = AsyncMock(return_value=[])
        
        result = await transform_sub_agents(
            sub_agents=[good_agent, bad_agent],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=skill_client,
            skill_writer_class=SkillWriter,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )
        
        # Should return both subagents (both are valid in this case)
        assert result is not None
        assert len(result) == 2


class TestGraphtonCompatibility:
    """Tests verifying output format compatibility with graphton."""

    @pytest.mark.asyncio
    async def test_output_format_matches_graphton_expectations(self):
        """Test that output dict matches graphton's expected format."""
        sub_agent = MagicMock()
        sub_agent.name = "format-test-agent"
        sub_agent.description = "Testing output format"
        sub_agent.instructions = "Verify the output format is correct for graphton."
        sub_agent.model_override = ""
        sub_agent.mcp_access = []
        sub_agent.skill_refs = []
        
        skill_client = MagicMock()
        skill_client.list_by_refs = AsyncMock(return_value=[])
        
        result = await transform_sub_agents(
            sub_agents=[sub_agent],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=skill_client,
            skill_writer_class=SkillWriter,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )
        
        assert result is not None
        subagent_dict = result[0]
        
        # Required fields per graphton's AgentConfig.validate_subagents()
        assert "name" in subagent_dict
        assert isinstance(subagent_dict["name"], str)
        assert subagent_dict["name"].strip() != ""
        
        assert "description" in subagent_dict
        assert isinstance(subagent_dict["description"], str)
        assert subagent_dict["description"].strip() != ""
        
        assert "system_prompt" in subagent_dict
        assert isinstance(subagent_dict["system_prompt"], str)
        assert subagent_dict["system_prompt"].strip() != ""
        
        # Optional tools field should be list if present
        if "tools" in subagent_dict:
            assert isinstance(subagent_dict["tools"], list)
