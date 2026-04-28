"""Unit tests for SubAgent transformation utilities.

Tests cover:
- Single SubAgent transformation with full config
- Multiple SubAgent transformation
- MCP access filtering with valid slugs
- MCP access filtering with invalid slugs (warning, skip)
- MCP tools intersection logic
- Empty mcp_access (subagent gets no MCP servers)
- Skill resolution per subagent
- Empty sub_agents list returns None
- Graceful error handling
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from stigmer_runner.worker.activities.graphton.subagent_transformer import (
    BUILTIN_SUBAGENT_TYPES,
    _build_usage_slug_map,
    _collect_all_skill_refs,
    _filter_mcp_for_subagent,
    create_builtin_subagents,
    transform_sub_agents,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mock_sub_agent():
    """Create a mock SubAgent proto message."""
    sub_agent = MagicMock()
    sub_agent.name = "code-reviewer"
    sub_agent.description = "Reviews code for quality and security"
    sub_agent.instructions = "You are a code review expert. Focus on security issues."
    sub_agent.mcp_access = []
    sub_agent.skill_refs = []
    sub_agent.model_override = ""
    return sub_agent


@pytest.fixture
def mock_sub_agent_with_mcp():
    """Create a mock SubAgent with MCP access."""
    sub_agent = MagicMock()
    sub_agent.name = "github-agent"
    sub_agent.description = "Interacts with GitHub"
    sub_agent.instructions = "You are a GitHub assistant. Help with repository management."
    
    # MCP access grant
    mcp_access = MagicMock()
    mcp_access.mcp_server = "github"
    mcp_access.enabled_tools = ["search_code", "get_file"]
    sub_agent.mcp_access = [mcp_access]
    sub_agent.skill_refs = []
    sub_agent.model_override = ""
    
    return sub_agent


@pytest.fixture
def mock_sub_agent_with_skills():
    """Create a mock SubAgent with skill references."""
    sub_agent = MagicMock()
    sub_agent.name = "skilled-agent"
    sub_agent.description = "Agent with specialized skills"
    sub_agent.instructions = "You have special capabilities defined by your skills."
    sub_agent.mcp_access = []
    sub_agent.model_override = ""
    
    # Skill reference
    skill_ref = MagicMock()
    skill_ref.slug = "test-org/code-review-skill"
    sub_agent.skill_refs = [skill_ref]
    
    return sub_agent


@pytest.fixture
def mock_mcp_server_usage():
    """Create a mock McpServerUsage proto."""
    usage = MagicMock()
    usage.mcp_server_ref.slug = "github"
    usage.enabled_tools = ["search_code", "get_file", "create_pr", "list_repos"]
    return usage


@pytest.fixture
def mock_skill():
    """Create a mock Skill proto."""
    skill = MagicMock()
    skill.metadata.id = "skill-123"
    skill.metadata.name = "code-review-skill"
    skill.metadata.slug = "test-org/code-review-skill"
    skill.spec.skill_md = "# Code Review Skill\n\nReview code effectively."
    skill.status.version_hash = "abc123"
    skill.status.artifact_storage_key = ""
    return skill


@pytest.fixture
def mock_skill_client():
    """Create a mock SkillClient."""
    client = MagicMock()
    client.list_by_refs = AsyncMock(return_value=[])
    client.get_artifact = AsyncMock(return_value=b"artifact data")
    return client


@pytest.fixture
def mock_skill_writer_class():
    """Create a mock SkillWriter class."""
    writer_class = MagicMock()
    writer_instance = MagicMock()
    writer_instance.write_skills.return_value = {}
    writer_class.return_value = writer_instance
    writer_class.generate_prompt_section = MagicMock(return_value="## Skills\n\n...")
    return writer_class


@pytest.fixture
def parent_mcp_servers():
    """Parent's transformed MCP server configs."""
    return {
        "github": {
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
        },
        "slack": {
            "transport": "http",
            "url": "https://slack.mcp.example.com",
        },
    }


@pytest.fixture
def parent_mcp_tools():
    """Parent's enabled tools per server."""
    return {
        "github": ["search_code", "get_file", "create_pr", "list_repos"],
        "slack": ["send_message", "list_channels"],
    }


@pytest.fixture
def parent_mcp_usages():
    """Parent's MCP server usages."""
    github_usage = MagicMock()
    github_usage.mcp_server_ref.slug = "github"
    github_usage.enabled_tools = ["search_code", "get_file", "create_pr", "list_repos"]
    
    slack_usage = MagicMock()
    slack_usage.mcp_server_ref.slug = "slack"
    slack_usage.enabled_tools = ["send_message", "list_channels"]
    
    return [github_usage, slack_usage]


# =============================================================================
# Tests for _build_usage_slug_map
# =============================================================================


class TestBuildUsageSlugMap:
    """Tests for _build_usage_slug_map helper function."""

    def test_builds_mapping_correctly(self, parent_mcp_usages):
        """Test that slug mapping is built correctly."""
        result = _build_usage_slug_map(parent_mcp_usages)
        
        assert "github" in result
        assert "slack" in result
        assert len(result) == 2

    def test_empty_usages_returns_empty_dict(self):
        """Test that empty usages returns empty dict."""
        result = _build_usage_slug_map([])
        assert result == {}

    def test_skips_empty_slugs(self):
        """Test that usages with empty slugs are skipped."""
        usage_no_slug = MagicMock()
        usage_no_slug.mcp_server_ref.slug = ""
        
        usage_with_slug = MagicMock()
        usage_with_slug.mcp_server_ref.slug = "github"
        
        result = _build_usage_slug_map([usage_no_slug, usage_with_slug])
        
        assert "github" in result
        assert "" not in result
        assert len(result) == 1


# =============================================================================
# Tests for _collect_all_skill_refs
# =============================================================================


class TestCollectAllSkillRefs:
    """Tests for _collect_all_skill_refs helper function."""

    def test_collects_skill_refs_from_multiple_subagents(self):
        """Test collecting skill refs from multiple subagents."""
        ref1 = MagicMock()
        ref1.slug = "skill-1"
        
        ref2 = MagicMock()
        ref2.slug = "skill-2"
        
        sub_agent1 = MagicMock()
        sub_agent1.skill_refs = [ref1]
        
        sub_agent2 = MagicMock()
        sub_agent2.skill_refs = [ref2]
        
        result = _collect_all_skill_refs([sub_agent1, sub_agent2])
        
        assert len(result) == 2
        slugs = [r.slug for r in result]
        assert "skill-1" in slugs
        assert "skill-2" in slugs

    def test_deduplicates_skill_refs(self):
        """Test that duplicate skill refs are deduplicated."""
        ref1 = MagicMock()
        ref1.slug = "same-skill"
        
        ref2 = MagicMock()
        ref2.slug = "same-skill"
        
        sub_agent1 = MagicMock()
        sub_agent1.skill_refs = [ref1]
        
        sub_agent2 = MagicMock()
        sub_agent2.skill_refs = [ref2]
        
        result = _collect_all_skill_refs([sub_agent1, sub_agent2])
        
        assert len(result) == 1
        assert result[0].slug == "same-skill"

    def test_empty_subagents_returns_empty_list(self):
        """Test that empty subagents returns empty list."""
        result = _collect_all_skill_refs([])
        assert result == []

    def test_subagent_with_no_skills(self):
        """Test subagent with no skills."""
        sub_agent = MagicMock()
        sub_agent.skill_refs = []
        
        result = _collect_all_skill_refs([sub_agent])
        assert result == []


# =============================================================================
# Tests for _filter_mcp_for_subagent
# =============================================================================


class TestFilterMcpForSubagent:
    """Tests for _filter_mcp_for_subagent helper function."""

    def test_filters_mcp_with_valid_slug(
        self, parent_mcp_servers, parent_mcp_tools, parent_mcp_usages
    ):
        """Test filtering MCP with valid slug."""
        mcp_access = MagicMock()
        mcp_access.mcp_server = "github"
        mcp_access.enabled_tools = ["search_code", "get_file"]
        
        usage_by_slug = _build_usage_slug_map(parent_mcp_usages)
        
        filtered_servers, filtered_tools = _filter_mcp_for_subagent(
            mcp_access_list=[mcp_access],
            parent_mcp_servers=parent_mcp_servers,
            parent_mcp_tools=parent_mcp_tools,
            usage_by_slug=usage_by_slug,
            log=logging.getLogger("test"),
        )
        
        assert "github" in filtered_servers
        assert "slack" not in filtered_servers
        assert filtered_tools["github"] == ["search_code", "get_file"]

    def test_skips_invalid_slug(
        self, parent_mcp_servers, parent_mcp_tools, parent_mcp_usages
    ):
        """Test that invalid slug is skipped with warning."""
        mcp_access = MagicMock()
        mcp_access.mcp_server = "nonexistent-server"
        mcp_access.enabled_tools = ["some_tool"]
        
        usage_by_slug = _build_usage_slug_map(parent_mcp_usages)
        
        filtered_servers, filtered_tools = _filter_mcp_for_subagent(
            mcp_access_list=[mcp_access],
            parent_mcp_servers=parent_mcp_servers,
            parent_mcp_tools=parent_mcp_tools,
            usage_by_slug=usage_by_slug,
            log=logging.getLogger("test"),
        )
        
        assert filtered_servers == {}
        assert filtered_tools == {}

    def test_intersects_tools_with_parent(
        self, parent_mcp_servers, parent_mcp_tools, parent_mcp_usages
    ):
        """Test that subagent tools are intersected with parent tools."""
        mcp_access = MagicMock()
        mcp_access.mcp_server = "github"
        # Request tool that parent doesn't have
        mcp_access.enabled_tools = ["search_code", "delete_repo"]
        
        usage_by_slug = _build_usage_slug_map(parent_mcp_usages)
        
        filtered_servers, filtered_tools = _filter_mcp_for_subagent(
            mcp_access_list=[mcp_access],
            parent_mcp_servers=parent_mcp_servers,
            parent_mcp_tools=parent_mcp_tools,
            usage_by_slug=usage_by_slug,
            log=logging.getLogger("test"),
        )
        
        # Only search_code should be included (delete_repo not in parent)
        assert filtered_tools["github"] == ["search_code"]

    def test_empty_enabled_tools_inherits_all(
        self, parent_mcp_servers, parent_mcp_tools, parent_mcp_usages
    ):
        """Test that empty enabled_tools inherits all parent tools."""
        mcp_access = MagicMock()
        mcp_access.mcp_server = "github"
        mcp_access.enabled_tools = []  # Empty = inherit all
        
        usage_by_slug = _build_usage_slug_map(parent_mcp_usages)
        
        filtered_servers, filtered_tools = _filter_mcp_for_subagent(
            mcp_access_list=[mcp_access],
            parent_mcp_servers=parent_mcp_servers,
            parent_mcp_tools=parent_mcp_tools,
            usage_by_slug=usage_by_slug,
            log=logging.getLogger("test"),
        )
        
        # Should have all parent tools for github
        assert filtered_tools["github"] == parent_mcp_tools["github"]

    def test_removes_server_if_no_valid_tools(
        self, parent_mcp_servers, parent_mcp_tools, parent_mcp_usages
    ):
        """Test that server is removed if no valid tools after filtering."""
        mcp_access = MagicMock()
        mcp_access.mcp_server = "github"
        # Request only tools that parent doesn't have
        mcp_access.enabled_tools = ["delete_repo", "destroy_everything"]
        
        usage_by_slug = _build_usage_slug_map(parent_mcp_usages)
        
        filtered_servers, filtered_tools = _filter_mcp_for_subagent(
            mcp_access_list=[mcp_access],
            parent_mcp_servers=parent_mcp_servers,
            parent_mcp_tools=parent_mcp_tools,
            usage_by_slug=usage_by_slug,
            log=logging.getLogger("test"),
        )
        
        # Server should be removed since no valid tools
        assert "github" not in filtered_servers
        assert "github" not in filtered_tools

    def test_multiple_mcp_access_grants(
        self, parent_mcp_servers, parent_mcp_tools, parent_mcp_usages
    ):
        """Test multiple MCP access grants."""
        github_access = MagicMock()
        github_access.mcp_server = "github"
        github_access.enabled_tools = ["search_code"]
        
        slack_access = MagicMock()
        slack_access.mcp_server = "slack"
        slack_access.enabled_tools = ["send_message"]
        
        usage_by_slug = _build_usage_slug_map(parent_mcp_usages)
        
        filtered_servers, filtered_tools = _filter_mcp_for_subagent(
            mcp_access_list=[github_access, slack_access],
            parent_mcp_servers=parent_mcp_servers,
            parent_mcp_tools=parent_mcp_tools,
            usage_by_slug=usage_by_slug,
            log=logging.getLogger("test"),
        )
        
        assert "github" in filtered_servers
        assert "slack" in filtered_servers
        assert filtered_tools["github"] == ["search_code"]
        assert filtered_tools["slack"] == ["send_message"]


# =============================================================================
# Tests for transform_sub_agents
# =============================================================================


class TestTransformSubAgents:
    """Tests for the main transform_sub_agents function."""

    @pytest.mark.asyncio
    async def test_empty_sub_agents_returns_none(
        self, mock_skill_client, mock_skill_writer_class
    ):
        """Test that empty sub_agents list returns None."""
        result = await transform_sub_agents(
            sub_agents=[],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )
        
        assert result is None

    @pytest.mark.asyncio
    async def test_transforms_single_subagent(
        self,
        mock_sub_agent,
        mock_skill_client,
        mock_skill_writer_class,
    ):
        """Test transforming a single SubAgent without MCP or skills."""
        result = await transform_sub_agents(
            sub_agents=[mock_sub_agent],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )
        
        assert result is not None
        assert len(result) == 1
        
        subagent_dict = result[0]
        assert subagent_dict["name"] == "code-reviewer"
        assert subagent_dict["description"] == "Reviews code for quality and security"
        assert "system_prompt" in subagent_dict
        assert "You are a code review expert" in subagent_dict["system_prompt"]

    @pytest.mark.asyncio
    async def test_transforms_multiple_subagents(
        self,
        mock_sub_agent,
        mock_skill_client,
        mock_skill_writer_class,
    ):
        """Test transforming multiple SubAgents."""
        sub_agent2 = MagicMock()
        sub_agent2.name = "researcher"
        sub_agent2.description = "Research specialist"
        sub_agent2.instructions = "You are a research expert."
        sub_agent2.mcp_access = []
        sub_agent2.skill_refs = []
        sub_agent2.model_override = ""
        
        result = await transform_sub_agents(
            sub_agents=[mock_sub_agent, sub_agent2],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )
        
        assert result is not None
        assert len(result) == 2
        names = [s["name"] for s in result]
        assert "code-reviewer" in names
        assert "researcher" in names

    @pytest.mark.asyncio
    async def test_subagent_with_skills_gets_enhanced_prompt(
        self,
        mock_sub_agent_with_skills,
        mock_skill,
        mock_skill_client,
        mock_skill_writer_class,
    ):
        """Test that subagent with skills gets enhanced system prompt."""
        # Configure mock to return skill
        mock_skill_client.list_by_refs = AsyncMock(return_value=[mock_skill])
        mock_skill_writer_class.generate_prompt_section.return_value = (
            "\n\n## Available Skills\n\n### SKILL: code-review-skill\n..."
        )
        
        # Mock write_skills to return skill paths
        writer_instance = mock_skill_writer_class.return_value
        writer_instance.write_skills.return_value = {
            mock_skill.metadata.id: "/bin/skills/abc123"
        }
        
        result = await transform_sub_agents(
            sub_agents=[mock_sub_agent_with_skills],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )
        
        assert result is not None
        assert len(result) == 1
        
        # Verify skill resolution was called
        mock_skill_client.list_by_refs.assert_called()

    @pytest.mark.asyncio
    @patch("graphton.core.middleware.McpToolsLoader")
    @patch("graphton.core.tool_wrappers.create_tool_wrapper")
    async def test_subagent_with_mcp_gets_tool_wrappers(
        self,
        mock_create_tool_wrapper,
        mock_mcp_tools_loader,
        mock_sub_agent_with_mcp,
        mock_skill_client,
        mock_skill_writer_class,
        parent_mcp_servers,
        parent_mcp_tools,
        parent_mcp_usages,
    ):
        """Test that subagent with MCP access gets tool wrappers."""
        # Configure mocks
        mock_middleware = MagicMock()
        mock_middleware._deferred_loading = False
        mock_middleware._tools_loaded = True
        mock_mcp_tools_loader.return_value = mock_middleware
        
        mock_tool = MagicMock()
        mock_create_tool_wrapper.return_value = mock_tool
        
        result = await transform_sub_agents(
            sub_agents=[mock_sub_agent_with_mcp],
            parent_mcp_servers=parent_mcp_servers,
            parent_mcp_tools=parent_mcp_tools,
            parent_mcp_usages=parent_mcp_usages,
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )
        
        assert result is not None
        assert len(result) == 1
        
        subagent_dict = result[0]
        assert "tools" in subagent_dict
        assert len(subagent_dict["tools"]) > 0

    @pytest.mark.asyncio
    async def test_graceful_handling_of_mcp_errors(
        self,
        mock_sub_agent_with_mcp,
        mock_skill_client,
        mock_skill_writer_class,
        parent_mcp_servers,
        parent_mcp_tools,
        parent_mcp_usages,
    ):
        """Test graceful handling when MCP tool creation fails."""
        # Patch McpToolsLoader to raise an error
        with patch(
            "graphton.core.middleware.McpToolsLoader"
        ) as mock_loader:
            mock_loader.side_effect = RuntimeError("MCP connection failed")
            
            result = await transform_sub_agents(
                sub_agents=[mock_sub_agent_with_mcp],
                parent_mcp_servers=parent_mcp_servers,
                parent_mcp_tools=parent_mcp_tools,
                parent_mcp_usages=parent_mcp_usages,
                skill_client=mock_skill_client,
                skill_writer_class=mock_skill_writer_class,
                skill_writer_kwargs={"backend": MagicMock()},
                activity_logger=logging.getLogger("test"),
            )
            
            # Should still return the subagent, just without tools
            assert result is not None
            assert len(result) == 1
            # Tools should be absent or empty
            assert "tools" not in result[0] or len(result[0].get("tools", [])) == 0

    @pytest.mark.asyncio
    async def test_graceful_handling_of_skill_errors(
        self,
        mock_sub_agent_with_skills,
        mock_skill_client,
        mock_skill_writer_class,
    ):
        """Test graceful handling when skill resolution fails."""
        # Configure mock to raise an error
        mock_skill_client.list_by_refs = AsyncMock(
            side_effect=RuntimeError("Skill fetch failed")
        )
        
        result = await transform_sub_agents(
            sub_agents=[mock_sub_agent_with_skills],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )
        
        # Should still return the subagent, just without skill enhancement
        assert result is not None
        assert len(result) == 1


# =============================================================================
# Tests for edge cases
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases and error conditions."""

    @pytest.mark.asyncio
    async def test_subagent_with_empty_name_still_transforms(
        self, mock_skill_client, mock_skill_writer_class
    ):
        """Test subagent with minimal config still transforms."""
        sub_agent = MagicMock()
        sub_agent.name = "minimal"
        sub_agent.description = ""  # Empty description
        sub_agent.instructions = "Short instructions here."
        sub_agent.mcp_access = []
        sub_agent.skill_refs = []
        sub_agent.model_override = ""
        
        result = await transform_sub_agents(
            sub_agents=[sub_agent],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )
        
        assert result is not None
        assert len(result) == 1
        # Should have a fallback description
        assert result[0]["description"] == "Sub-agent: minimal"

    @pytest.mark.asyncio
    async def test_mcp_access_with_empty_slug_skipped(
        self,
        mock_skill_client,
        mock_skill_writer_class,
        parent_mcp_servers,
        parent_mcp_tools,
        parent_mcp_usages,
    ):
        """Test that MCP access with empty slug is skipped."""
        sub_agent = MagicMock()
        sub_agent.name = "test-agent"
        sub_agent.description = "Test"
        sub_agent.instructions = "Test instructions here."
        sub_agent.skill_refs = []
        sub_agent.model_override = ""
        
        mcp_access = MagicMock()
        mcp_access.mcp_server = ""  # Empty slug
        mcp_access.enabled_tools = ["some_tool"]
        sub_agent.mcp_access = [mcp_access]
        
        result = await transform_sub_agents(
            sub_agents=[sub_agent],
            parent_mcp_servers=parent_mcp_servers,
            parent_mcp_tools=parent_mcp_tools,
            parent_mcp_usages=parent_mcp_usages,
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )
        
        assert result is not None
        assert len(result) == 1
        # Should have no tools since MCP access was invalid
        assert "tools" not in result[0] or len(result[0].get("tools", [])) == 0


# =============================================================================
# Tests for model_override (Phase 7)
# =============================================================================


class TestModelOverride:
    """Tests for SubAgent.model_override wiring in the transformer."""

    def _make_sub_agent(self, *, model_override: str = "") -> MagicMock:
        """Helper to create a minimal mock SubAgent with model_override."""
        sa = MagicMock()
        sa.name = "fast-searcher"
        sa.description = "Cheap search sub-agent"
        sa.instructions = "You are a fast search assistant."
        sa.mcp_access = []
        sa.skill_refs = []
        sa.model_override = model_override
        return sa

    @pytest.mark.asyncio
    @patch("graphton.core.model_registry.ModelRegistry")
    async def test_valid_model_override_adds_model_key(
        self, mock_registry, mock_skill_client, mock_skill_writer_class
    ):
        """Valid model_override is validated and added to the dict."""
        mock_registry.is_registered.return_value = True

        sa = self._make_sub_agent(model_override="claude-haiku-4.5")

        result = await transform_sub_agents(
            sub_agents=[sa],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )

        assert result is not None
        assert len(result) == 1
        assert result[0]["model"] == "claude-haiku-4.5"
        mock_registry.is_registered.assert_called_with("claude-haiku-4.5")

    @pytest.mark.asyncio
    async def test_empty_model_override_omits_model_key(
        self, mock_skill_client, mock_skill_writer_class
    ):
        """Empty model_override means no 'model' key — inherits parent."""
        sa = self._make_sub_agent(model_override="")

        result = await transform_sub_agents(
            sub_agents=[sa],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )

        assert result is not None
        assert len(result) == 1
        assert "model" not in result[0]

    @pytest.mark.asyncio
    @patch("graphton.core.model_registry.ModelRegistry")
    async def test_invalid_model_override_skips_subagent(
        self, mock_registry, mock_skill_client, mock_skill_writer_class
    ):
        """Unrecognised model_override causes the sub-agent to be skipped."""
        mock_registry.is_registered.return_value = False
        mock_registry.get_by_api_model_id.return_value = None

        sa = self._make_sub_agent(model_override="claude-snonet-4")

        result = await transform_sub_agents(
            sub_agents=[sa],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )

        # Sub-agent was the only one and it was skipped -> None
        assert result is None

    @pytest.mark.asyncio
    @patch("graphton.core.model_registry.ModelRegistry")
    async def test_invalid_model_override_does_not_block_other_subagents(
        self, mock_registry, mock_skill_client, mock_skill_writer_class
    ):
        """An invalid model_override on one sub-agent doesn't block others."""
        # First call for the bad model: not registered, not an API ID.
        # Second call for the good sub-agent: no model_override, so
        # ModelRegistry is never consulted.
        mock_registry.is_registered.return_value = False
        mock_registry.get_by_api_model_id.return_value = None

        bad_sa = self._make_sub_agent(model_override="nonexistent-model")
        bad_sa.name = "bad-model-agent"

        good_sa = self._make_sub_agent(model_override="")
        good_sa.name = "good-agent"

        result = await transform_sub_agents(
            sub_agents=[bad_sa, good_sa],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )

        assert result is not None
        assert len(result) == 1
        assert result[0]["name"] == "good-agent"
        assert "model" not in result[0]

    @pytest.mark.asyncio
    @patch("graphton.core.model_registry.ModelRegistry")
    async def test_model_override_validated_via_api_model_id_fallback(
        self, mock_registry, mock_skill_client, mock_skill_writer_class
    ):
        """model_override is accepted when it matches an API model ID."""
        mock_registry.is_registered.return_value = False
        mock_metadata = MagicMock()
        mock_registry.get_by_api_model_id.return_value = mock_metadata

        sa = self._make_sub_agent(
            model_override="claude-haiku-4-5-20251001"
        )

        result = await transform_sub_agents(
            sub_agents=[sa],
            parent_mcp_servers={},
            parent_mcp_tools={},
            parent_mcp_usages=[],
            skill_client=mock_skill_client,
            skill_writer_class=mock_skill_writer_class,
            skill_writer_kwargs={"backend": MagicMock()},
            activity_logger=logging.getLogger("test"),
        )

        assert result is not None
        assert len(result) == 1
        assert result[0]["model"] == "claude-haiku-4-5-20251001"


# =============================================================================
# Tests for BUILTIN_SUBAGENT_TYPES constant
# =============================================================================


class TestBuiltinSubagentTypes:
    """Tests for the BUILTIN_SUBAGENT_TYPES constant."""

    def test_contains_explore_and_shell(self):
        """Built-in types include exactly explore and shell."""
        assert BUILTIN_SUBAGENT_TYPES == {"explore", "shell"}

    def test_is_frozenset(self):
        """Built-in types set is immutable."""
        assert isinstance(BUILTIN_SUBAGENT_TYPES, frozenset)


# =============================================================================
# Tests for create_builtin_subagents
# =============================================================================


class TestCreateBuiltinSubagents:
    """Tests for create_builtin_subagents function."""

    def test_returns_empty_without_sandbox_config(self):
        """Returns empty list when no sandbox config is provided."""
        result = create_builtin_subagents(sandbox_config=None)
        assert result == []

    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    @patch("graphton.core.tool_wrappers.create_filtered_platform_tools")
    def test_creates_both_types(self, mock_filtered_tools, mock_sandbox):
        """Creates both explore and shell subagents."""
        mock_sandbox.return_value = MagicMock()
        mock_filtered_tools.return_value = [MagicMock()]

        result = create_builtin_subagents(
            sandbox_config={"type": "filesystem", "root_dir": "/workspace"},
        )

        assert len(result) == 2
        names = {sa["name"] for sa in result}
        assert names == {"explore", "shell"}

    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    @patch("graphton.core.tool_wrappers.create_filtered_platform_tools")
    def test_explore_has_restricted_prompt(self, mock_filtered_tools, mock_sandbox):
        """Explore subagent has prompt with scope boundaries."""
        mock_sandbox.return_value = MagicMock()
        mock_filtered_tools.return_value = [MagicMock()]

        result = create_builtin_subagents(
            sandbox_config={"type": "filesystem", "root_dir": "/workspace"},
        )

        explore = next(sa for sa in result if sa["name"] == "explore")
        assert "exploration specialist" in explore["system_prompt"].lower()
        assert "Do NOT write files" in explore["system_prompt"]
        assert "Do NOT execute shell commands" in explore["system_prompt"]

    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    @patch("graphton.core.tool_wrappers.create_filtered_platform_tools")
    def test_shell_has_restricted_prompt(self, mock_filtered_tools, mock_sandbox):
        """Shell subagent has prompt with scope boundaries."""
        mock_sandbox.return_value = MagicMock()
        mock_filtered_tools.return_value = [MagicMock()]

        result = create_builtin_subagents(
            sandbox_config={"type": "filesystem", "root_dir": "/workspace"},
        )

        shell = next(sa for sa in result if sa["name"] == "shell")
        assert "command execution specialist" in shell["system_prompt"].lower()
        assert "Do NOT follow skill activation instructions" in shell["system_prompt"]

    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    @patch("graphton.core.tool_wrappers.create_filtered_platform_tools")
    def test_explore_uses_explore_tool_set(self, mock_filtered_tools, mock_sandbox):
        """Explore subagent requests EXPLORE_TOOL_SET from the filter."""
        mock_sandbox.return_value = MagicMock()
        mock_filtered_tools.return_value = [MagicMock()]

        create_builtin_subagents(
            sandbox_config={"type": "filesystem", "root_dir": "/workspace"},
        )

        from graphton.core.tool_wrappers import EXPLORE_TOOL_SET

        calls = mock_filtered_tools.call_args_list
        explore_call = next(
            c for c in calls if c.kwargs.get("sub_agent_name") == "explore"
        )
        assert explore_call.kwargs["allowed_tools"] == EXPLORE_TOOL_SET

    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    @patch("graphton.core.tool_wrappers.create_filtered_platform_tools")
    def test_shell_uses_shell_tool_set(self, mock_filtered_tools, mock_sandbox):
        """Shell subagent requests SHELL_TOOL_SET from the filter."""
        mock_sandbox.return_value = MagicMock()
        mock_filtered_tools.return_value = [MagicMock()]

        create_builtin_subagents(
            sandbox_config={"type": "filesystem", "root_dir": "/workspace"},
        )

        from graphton.core.tool_wrappers import SHELL_TOOL_SET

        calls = mock_filtered_tools.call_args_list
        shell_call = next(
            c for c in calls if c.kwargs.get("sub_agent_name") == "shell"
        )
        assert shell_call.kwargs["allowed_tools"] == SHELL_TOOL_SET

    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    @patch("graphton.core.tool_wrappers.create_filtered_platform_tools")
    def test_subagent_dicts_have_required_keys(self, mock_filtered_tools, mock_sandbox):
        """Each subagent dict has name, description, system_prompt, tools."""
        mock_sandbox.return_value = MagicMock()
        mock_filtered_tools.return_value = [MagicMock()]

        result = create_builtin_subagents(
            sandbox_config={"type": "filesystem", "root_dir": "/workspace"},
        )

        for sa in result:
            assert "name" in sa
            assert "description" in sa
            assert "system_prompt" in sa
            assert "tools" in sa

    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    @patch("graphton.core.tool_wrappers.create_filtered_platform_tools")
    def test_response_rules_appended(self, mock_filtered_tools, mock_sandbox):
        """Response rules are appended to system prompts."""
        mock_sandbox.return_value = MagicMock()
        mock_filtered_tools.return_value = [MagicMock()]

        result = create_builtin_subagents(
            sandbox_config={"type": "filesystem", "root_dir": "/workspace"},
        )

        for sa in result:
            assert "Response rules" in sa["system_prompt"]
            assert "NEVER reprint" in sa["system_prompt"]

    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    def test_graceful_on_sandbox_creation_failure(self, mock_sandbox):
        """Returns empty list on sandbox backend creation failure."""
        mock_sandbox.side_effect = RuntimeError("Sandbox init failed")

        result = create_builtin_subagents(
            sandbox_config={"type": "filesystem", "root_dir": "/workspace"},
            activity_logger=logging.getLogger("test"),
        )

        assert result == []

    @patch("graphton.core.sandbox_factory.create_sandbox_backend")
    @patch("graphton.core.tool_wrappers.create_filtered_platform_tools")
    def test_approval_checker_passed_through(self, mock_filtered_tools, mock_sandbox):
        """Approval checker is forwarded to create_filtered_platform_tools."""
        mock_sandbox.return_value = MagicMock()
        mock_filtered_tools.return_value = [MagicMock()]
        checker = MagicMock()

        create_builtin_subagents(
            sandbox_config={"type": "filesystem", "root_dir": "/workspace"},
            approval_checker=checker,
        )

        for call in mock_filtered_tools.call_args_list:
            assert call.kwargs["approval_checker"] is checker
