"""Shared pytest fixtures for agent-runner tests."""

import pytest
from unittest.mock import AsyncMock, MagicMock
import zipfile
import io


@pytest.fixture
def mock_skill():
    """Create a mock Skill proto message."""
    skill = MagicMock()
    skill.metadata.id = "skill-123-abc"
    skill.metadata.name = "test-skill"
    skill.metadata.slug = "test-org/test-skill"
    skill.spec.skill_md = "# Test Skill\n\nThis is a test skill."
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
    skill.status.version_hash = ""  # Empty hash
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
