"""Shared pytest fixtures for agent-runner tests."""

import io
import zipfile
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture
def mock_skill():
    """Create a mock Skill proto message."""
    skill = MagicMock()
    skill.metadata.id = "skill-123-abc"
    skill.metadata.name = "test-skill"
    skill.metadata.slug = "test-org/test-skill"
    skill.spec.skill_md = "# Test Skill\n\nThis is a test skill."
    skill.spec.description = "A test skill for unit tests."
    skill.status.version_hash = "abc123def456"
    skill.status.artifact_storage_key = "skills/test-org/test-skill/abc123def456.zip"
    return skill


@pytest.fixture
def mock_skill_no_hash():
    """Create a mock Skill proto message without version_hash."""
    skill = MagicMock()
    skill.metadata.id = "skill-456-def"
    skill.metadata.name = "no-hash-skill"
    skill.metadata.slug = "test-org/no-hash-skill"
    skill.spec.skill_md = "# No Hash Skill\n\nSkill without version hash."
    skill.spec.description = "Skill for testing the no-hash fallback."
    skill.status.version_hash = ""  # Empty hash
    skill.status.artifact_storage_key = ""
    return skill


@pytest.fixture
def mock_skill_no_name():
    """Create a mock Skill proto message without metadata.name."""
    skill = MagicMock()
    skill.metadata.id = "skill-789-ghi"
    skill.metadata.name = ""  # Empty name
    skill.metadata.slug = "test-org/unnamed-skill"
    skill.spec.skill_md = "# Unnamed Skill\n\nSkill without a name."
    skill.spec.description = "Skill for testing name fallback chain."
    skill.status.version_hash = "fff999aaa111"
    skill.status.artifact_storage_key = ""
    return skill


@pytest.fixture
def sample_artifact_zip() -> bytes:
    """Create a sample artifact ZIP file as bytes."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Add SKILL.md
        zf.writestr("SKILL.md", "# Test Skill\n\nThis is a test skill from ZIP.")
        # Add a shell script
        zf.writestr("run.sh", "#!/bin/bash\necho 'Hello from skill!'")
        # Add a Python script
        zf.writestr("main.py", "#!/usr/bin/env python3\nprint('Hello from Python!')")
        # Add a regular file (not executable)
        zf.writestr("config.json", '{"version": "1.0.0"}')
    return buffer.getvalue()


@pytest.fixture
def sample_artifact_zip_nested() -> bytes:
    """Create a sample artifact ZIP file with nested directories."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("SKILL.md", "# Nested Skill")
        zf.writestr("src/main.py", "print('nested')")
        zf.writestr("scripts/run.sh", "#!/bin/bash\necho 'nested script'")
        zf.writestr("data/config.yaml", "key: value")
    return buffer.getvalue()


@pytest.fixture
def mock_grpc_channel():
    """Create a mock gRPC channel."""
    return MagicMock()


@pytest.fixture
def mock_skill_stub():
    """Create a mock SkillQueryController stub."""
    stub = MagicMock()
    stub.getArtifact = AsyncMock()
    stub.get = AsyncMock()
    stub.getByReference = AsyncMock()
    return stub


# =============================================================================
# MCP Server Fixtures
# =============================================================================


@pytest.fixture
def mock_mcp_server_stub():
    """Create a mock McpServerQueryController stub."""
    stub = MagicMock()
    stub.get = AsyncMock()
    stub.getByReference = AsyncMock()
    return stub


@pytest.fixture
def mock_mcp_server():
    """Create a mock McpServer proto message with stdio config."""
    server = MagicMock()
    server.metadata.id = "mcp-server-123"
    server.metadata.name = "github-mcp"
    server.metadata.slug = "github"
    server.spec.HasField.side_effect = lambda x: x == "stdio"
    server.spec.stdio.command = "npx"
    server.spec.stdio.args = ["-y", "@modelcontextprotocol/server-github"]
    server.spec.stdio.working_dir = ""
    server.spec.default_enabled_tools = ["search_code", "create_pr"]
    return server


@pytest.fixture
def mock_mcp_server_http():
    """Create a mock McpServer proto message with HTTP config."""
    server = MagicMock()
    server.metadata.id = "mcp-server-456"
    server.metadata.name = "custom-api-mcp"
    server.metadata.slug = "custom-api"
    server.spec.HasField.side_effect = lambda x: x == "http"
    server.spec.http.url = "https://api.example.com/mcp"
    server.spec.http.headers = {"Authorization": "Bearer ${API_TOKEN}"}
    server.spec.http.query_params = {}
    server.spec.http.timeout_seconds = 30
    server.spec.default_enabled_tools = []
    return server


@pytest.fixture
def mock_api_resource_reference():
    """Create a mock ApiResourceReference."""
    ref = MagicMock()
    ref.slug = "github"
    ref.scope = "org"
    ref.org = "test-org"
    ref.kind = "McpServer"
    return ref


# =============================================================================
# SubAgent Fixtures
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
    return sub_agent


@pytest.fixture
def mock_mcp_access():
    """Create a mock McpAccess proto message."""
    access = MagicMock()
    access.mcp_server = "github"
    access.enabled_tools = ["search_code", "get_file"]
    return access


@pytest.fixture
def mock_mcp_server_usage():
    """Create a mock McpServerUsage proto message."""
    usage = MagicMock()
    usage.mcp_server_ref.slug = "github"
    usage.enabled_tools = ["search_code", "get_file", "create_pr", "list_repos"]
    usage.tool_approval_overrides = []
    return usage
