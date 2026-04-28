"""Unit tests for session context merge utilities.

Tests cover:
- merge_mcp_server_usages: union by slug, session-level override semantics
- merge_skill_refs: union by slug, deduplication
- Edge cases: empty inputs, single-source inputs, slug collisions
"""

from unittest.mock import MagicMock

from stigmer_runner.worker.activities.graphton.session_context_merge import (
    merge_mcp_server_usages,
    merge_skill_refs,
)

# =============================================================================
# Helpers
# =============================================================================


def _make_mcp_usage(slug: str, enabled_tools: list[str] | None = None) -> MagicMock:
    """Create a mock McpServerUsage proto with the given slug."""
    usage = MagicMock()
    usage.mcp_server_ref.slug = slug
    usage.enabled_tools = enabled_tools or []
    usage.tool_approval_overrides = []
    return usage


def _make_skill_ref(slug: str) -> MagicMock:
    """Create a mock ApiResourceReference proto with the given slug."""
    ref = MagicMock()
    ref.slug = slug
    return ref


# =============================================================================
# merge_mcp_server_usages
# =============================================================================


class TestMergeMcpServerUsages:
    """Tests for merge_mcp_server_usages."""

    def test_both_empty(self) -> None:
        result = merge_mcp_server_usages([], [])
        assert result == []

    def test_agent_only(self) -> None:
        agent_usages = [
            _make_mcp_usage("github", ["search_code", "create_pr"]),
            _make_mcp_usage("slack", ["send_message"]),
        ]
        result = merge_mcp_server_usages(agent_usages, [])

        slugs = [u.mcp_server_ref.slug for u in result]
        assert slugs == ["github", "slack"]

    def test_session_only(self) -> None:
        session_usages = [
            _make_mcp_usage("jira", ["create_issue"]),
        ]
        result = merge_mcp_server_usages([], session_usages)

        slugs = [u.mcp_server_ref.slug for u in result]
        assert slugs == ["jira"]

    def test_non_overlapping_union(self) -> None:
        agent_usages = [_make_mcp_usage("github")]
        session_usages = [_make_mcp_usage("jira")]

        result = merge_mcp_server_usages(agent_usages, session_usages)

        slugs = {u.mcp_server_ref.slug for u in result}
        assert slugs == {"github", "jira"}
        assert len(result) == 2

    def test_session_overrides_on_slug_collision(self) -> None:
        """Session-level entry replaces the agent-level entry entirely."""
        agent_usage = _make_mcp_usage("github", ["search_code"])
        session_usage = _make_mcp_usage("github", ["search_code", "create_pr", "merge_pr"])

        result = merge_mcp_server_usages([agent_usage], [session_usage])

        assert len(result) == 1
        assert result[0] is session_usage
        assert result[0].enabled_tools == ["search_code", "create_pr", "merge_pr"]

    def test_mixed_overlap_and_unique(self) -> None:
        """Some slugs overlap, some are unique to each source."""
        agent_usages = [
            _make_mcp_usage("github", ["search_code"]),
            _make_mcp_usage("slack", ["send_message"]),
        ]
        session_usages = [
            _make_mcp_usage("github", ["create_pr"]),
            _make_mcp_usage("jira", ["create_issue"]),
        ]

        result = merge_mcp_server_usages(agent_usages, session_usages)

        result_by_slug = {u.mcp_server_ref.slug: u for u in result}
        assert set(result_by_slug.keys()) == {"github", "slack", "jira"}
        # github should be the session version
        assert result_by_slug["github"] is session_usages[0]
        # slack is agent-only
        assert result_by_slug["slack"] is agent_usages[1]
        # jira is session-only
        assert result_by_slug["jira"] is session_usages[1]

    def test_skips_empty_slug(self) -> None:
        """Entries with empty slugs are excluded from the merge."""
        agent_usage = _make_mcp_usage("")
        session_usage = _make_mcp_usage("github")

        result = merge_mcp_server_usages([agent_usage], [session_usage])

        assert len(result) == 1
        assert result[0].mcp_server_ref.slug == "github"

    def test_preserves_tool_approval_overrides(self) -> None:
        """Session override carries its own tool_approval_overrides."""
        agent_usage = _make_mcp_usage("github")
        agent_usage.tool_approval_overrides = [MagicMock(tool_name="dangerous_tool")]

        session_usage = _make_mcp_usage("github")
        session_override = MagicMock(tool_name="dangerous_tool")
        session_usage.tool_approval_overrides = [session_override]

        result = merge_mcp_server_usages([agent_usage], [session_usage])

        assert len(result) == 1
        assert result[0].tool_approval_overrides == [session_override]


# =============================================================================
# merge_skill_refs
# =============================================================================


class TestMergeSkillRefs:
    """Tests for merge_skill_refs."""

    def test_both_empty(self) -> None:
        result = merge_skill_refs([], [])
        assert result == []

    def test_agent_only(self) -> None:
        agent_refs = [
            _make_skill_ref("org/code-review"),
            _make_skill_ref("org/security-scan"),
        ]
        result = merge_skill_refs(agent_refs, [])

        slugs = [r.slug for r in result]
        assert slugs == ["org/code-review", "org/security-scan"]

    def test_session_only(self) -> None:
        session_refs = [_make_skill_ref("org/api-design")]
        result = merge_skill_refs([], session_refs)

        assert len(result) == 1
        assert result[0].slug == "org/api-design"

    def test_non_overlapping_union(self) -> None:
        agent_refs = [_make_skill_ref("org/code-review")]
        session_refs = [_make_skill_ref("org/api-design")]

        result = merge_skill_refs(agent_refs, session_refs)

        slugs = [r.slug for r in result]
        assert slugs == ["org/code-review", "org/api-design"]

    def test_duplicate_slug_deduplicated(self) -> None:
        """Same slug from both sources results in a single entry."""
        agent_ref = _make_skill_ref("org/code-review")
        session_ref = _make_skill_ref("org/code-review")

        result = merge_skill_refs([agent_ref], [session_ref])

        assert len(result) == 1
        assert result[0].slug == "org/code-review"
        # Agent-level is kept (first seen)
        assert result[0] is agent_ref

    def test_mixed_overlap_and_unique(self) -> None:
        agent_refs = [
            _make_skill_ref("org/code-review"),
            _make_skill_ref("org/testing"),
        ]
        session_refs = [
            _make_skill_ref("org/code-review"),
            _make_skill_ref("org/api-design"),
        ]

        result = merge_skill_refs(agent_refs, session_refs)

        slugs = [r.slug for r in result]
        assert slugs == ["org/code-review", "org/testing", "org/api-design"]
        assert len(result) == 3

    def test_skips_empty_slug(self) -> None:
        """Entries with empty slugs are excluded."""
        agent_ref = _make_skill_ref("")
        session_ref = _make_skill_ref("org/api-design")

        result = merge_skill_refs([agent_ref], [session_ref])

        assert len(result) == 1
        assert result[0].slug == "org/api-design"

    def test_ordering_agent_first(self) -> None:
        """Agent refs appear before session-added refs."""
        agent_refs = [_make_skill_ref("org/b-skill"), _make_skill_ref("org/a-skill")]
        session_refs = [_make_skill_ref("org/z-skill"), _make_skill_ref("org/c-skill")]

        result = merge_skill_refs(agent_refs, session_refs)

        slugs = [r.slug for r in result]
        assert slugs == ["org/b-skill", "org/a-skill", "org/z-skill", "org/c-skill"]
