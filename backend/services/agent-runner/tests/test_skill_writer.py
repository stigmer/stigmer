"""Unit tests for SkillWriter class.

Tests are organized around the public API surface:

- ``write_skills()`` — unified write path via ``WorkspaceBackend``
- ``compute_skill_paths()`` — read-only path computation
- ``generate_prompt_section()`` — system prompt generation
- ``_extract_zip_in_memory()`` — ZIP extraction logic
- ``_resolve_skill_dir_name()`` / ``_get_skill_relative_dir()`` — naming
"""

import os
import tempfile
from unittest.mock import MagicMock

import pytest
from graphton.core.backends.filesystem import FilesystemBackend

from stigmer_runner.worker.activities.graphton.skill_writer import SkillWriter
from stigmer_runner.worker.workspace.local import LocalWorkspaceBackend

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mock_backend() -> MagicMock:
    """Create a mock WorkspaceBackend for tests that don't need real I/O."""
    backend = MagicMock()
    backend.root_dir = "/workspace"
    backend.execute.return_value = MagicMock(exit_code=0, stdout="", stderr="")
    return backend


# ---------------------------------------------------------------------------
# ZIP extraction (in-memory)
# ---------------------------------------------------------------------------


class TestExtractZipInMemory:
    """Tests for SkillWriter._extract_zip_in_memory()."""

    def test_extract_basic_zip(self, sample_artifact_zip):
        files = SkillWriter._extract_zip_in_memory(
            sample_artifact_zip, ".stigmer/skills/test-skill", "test-skill",
        )
        paths = [p for p, _ in files]
        assert ".stigmer/skills/test-skill/SKILL.md" in paths
        assert ".stigmer/skills/test-skill/run.sh" in paths
        assert ".stigmer/skills/test-skill/main.py" in paths
        assert ".stigmer/skills/test-skill/config.json" in paths

    def test_extract_nested_zip(self, sample_artifact_zip_nested):
        files = SkillWriter._extract_zip_in_memory(
            sample_artifact_zip_nested, ".stigmer/skills/nested", "nested",
        )
        paths = [p for p, _ in files]
        assert ".stigmer/skills/nested/SKILL.md" in paths
        assert ".stigmer/skills/nested/src/main.py" in paths
        assert ".stigmer/skills/nested/scripts/run.sh" in paths
        assert ".stigmer/skills/nested/data/config.yaml" in paths

    def test_extract_invalid_zip_raises(self):
        with pytest.raises(RuntimeError, match="Invalid ZIP"):
            SkillWriter._extract_zip_in_memory(
                b"not a zip", ".stigmer/skills/bad", "bad",
            )

    def test_extract_preserves_content(self, sample_artifact_zip):
        files = SkillWriter._extract_zip_in_memory(
            sample_artifact_zip, ".stigmer/skills/s", "s",
        )
        content_map = dict(files)
        assert b"Test Skill" in content_map[".stigmer/skills/s/SKILL.md"]


# ---------------------------------------------------------------------------
# write_skills (with LocalWorkspaceBackend — real filesystem)
# ---------------------------------------------------------------------------


class TestWriteSkillsLocal:
    """Test write_skills() using a real LocalWorkspaceBackend."""

    def test_write_without_artifacts(self, mock_skill):
        with tempfile.TemporaryDirectory() as tmpdir:
            backend = LocalWorkspaceBackend(root_dir=tmpdir)
            writer = SkillWriter(backend=backend)

            result = writer.write_skills([mock_skill])

            assert mock_skill.metadata.id in result
            path = result[mock_skill.metadata.id]
            assert path == f".stigmer/skills/{mock_skill.metadata.name}"
            assert not path.startswith("/")

            md_path = os.path.join(tmpdir, path, "SKILL.md")
            assert os.path.exists(md_path)
            with open(md_path) as f:
                assert f.read() == mock_skill.spec.skill_md

    def test_write_with_artifacts(self, mock_skill, sample_artifact_zip):
        with tempfile.TemporaryDirectory() as tmpdir:
            backend = LocalWorkspaceBackend(root_dir=tmpdir)
            writer = SkillWriter(backend=backend)
            artifacts = {mock_skill.metadata.id: sample_artifact_zip}

            result = writer.write_skills([mock_skill], artifacts=artifacts)

            skill_dir = os.path.join(tmpdir, result[mock_skill.metadata.id])
            assert os.path.exists(os.path.join(skill_dir, "SKILL.md"))
            assert os.path.exists(os.path.join(skill_dir, "run.sh"))
            assert os.path.exists(os.path.join(skill_dir, "main.py"))

    def test_write_empty_list(self):
        backend = _make_mock_backend()
        writer = SkillWriter(backend=backend)
        assert writer.write_skills([]) == {}

    def test_write_uses_metadata_name(self, mock_skill_no_hash):
        with tempfile.TemporaryDirectory() as tmpdir:
            backend = LocalWorkspaceBackend(root_dir=tmpdir)
            writer = SkillWriter(backend=backend)

            result = writer.write_skills([mock_skill_no_hash])

            path = result[mock_skill_no_hash.metadata.id]
            assert path == f".stigmer/skills/{mock_skill_no_hash.metadata.name}"
            assert os.path.isdir(os.path.join(tmpdir, path))

    def test_write_multiple_skills(self, mock_skill, mock_skill_no_hash):
        with tempfile.TemporaryDirectory() as tmpdir:
            backend = LocalWorkspaceBackend(root_dir=tmpdir)
            writer = SkillWriter(backend=backend)

            result = writer.write_skills([mock_skill, mock_skill_no_hash])

            assert len(result) == 2
            assert mock_skill.metadata.id in result
            assert mock_skill_no_hash.metadata.id in result


# ---------------------------------------------------------------------------
# write_skills (with mock WorkspaceBackend)
# ---------------------------------------------------------------------------


class TestWriteSkillsMockBackend:
    """Test write_skills() using a mocked WorkspaceBackend.

    Verifies the method's interaction with the backend protocol without
    real I/O — the equivalent of the old Daytona-mode tests.
    """

    def test_creates_directories(self, mock_skill):
        backend = _make_mock_backend()
        writer = SkillWriter(backend=backend)

        writer.write_skills([mock_skill])

        mkdir_calls = [
            str(c) for c in backend.mkdir.call_args_list
        ]
        assert any(".stigmer/skills" in c for c in mkdir_calls)
        assert any(mock_skill.metadata.name in c for c in mkdir_calls)

    def test_returns_relative_paths(self, mock_skill):
        backend = _make_mock_backend()
        writer = SkillWriter(backend=backend)

        result = writer.write_skills([mock_skill])

        path = result[mock_skill.metadata.id]
        assert not path.startswith("/")
        assert path == f".stigmer/skills/{mock_skill.metadata.name}"

    def test_calls_write_files(self, mock_skill):
        backend = _make_mock_backend()
        writer = SkillWriter(backend=backend)

        writer.write_skills([mock_skill])

        backend.write_files.assert_called_once()
        files_arg = backend.write_files.call_args[0][0]
        assert len(files_arg) == 1
        rel_path, content = files_arg[0]
        assert rel_path == f".stigmer/skills/{mock_skill.metadata.name}/SKILL.md"
        assert content == mock_skill.spec.skill_md.encode("utf-8")

    def test_write_failure_raises_runtime_error(self, mock_skill):
        backend = _make_mock_backend()
        backend.write_files.side_effect = Exception("Write failed")
        writer = SkillWriter(backend=backend)

        with pytest.raises(RuntimeError, match="Failed to write skills"):
            writer.write_skills([mock_skill])

    def test_artifact_extracts_and_sets_permissions(
        self, mock_skill, sample_artifact_zip,
    ):
        backend = _make_mock_backend()
        writer = SkillWriter(backend=backend)
        artifacts = {mock_skill.metadata.id: sample_artifact_zip}

        writer.write_skills([mock_skill], artifacts=artifacts)

        # write_files should be called with the extracted files
        backend.write_files.assert_called_once()
        files_written = backend.write_files.call_args[0][0]
        paths_written = [p for p, _ in files_written]
        assert any("SKILL.md" in p for p in paths_written)
        assert any("run.sh" in p for p in paths_written)

        # chmod should have been executed
        exec_calls = [str(c) for c in backend.execute.call_args_list]
        assert any("chmod" in c for c in exec_calls)


# ---------------------------------------------------------------------------
# Prompt generation
# ---------------------------------------------------------------------------


class TestGeneratePromptSection:
    """Tests for SkillWriter.generate_prompt_section() (static, no backend)."""

    def test_empty_skills(self):
        assert SkillWriter.generate_prompt_section([], {}) == ""

    def test_single_skill(self, mock_skill):
        skill_paths = {
            mock_skill.metadata.id: f".stigmer/skills/{mock_skill.metadata.name}",
        }
        result = SkillWriter.generate_prompt_section([mock_skill], skill_paths)

        assert "## Available Skills" in result
        assert f"### {mock_skill.metadata.name}" in result
        assert f"**Description**: {mock_skill.spec.description}" in result
        assert f"**Location**: `.stigmer/skills/{mock_skill.metadata.name}/`" in result
        assert f"**Activate**: `read .stigmer/skills/{mock_skill.metadata.name}/SKILL.md`" in result
        assert "MUST stop execution immediately" in result
        assert mock_skill.spec.skill_md not in result

    def test_multiple_skills(self, mock_skill, mock_skill_no_hash):
        skill_paths = {
            mock_skill.metadata.id: f".stigmer/skills/{mock_skill.metadata.name}",
            mock_skill_no_hash.metadata.id: f".stigmer/skills/{mock_skill_no_hash.metadata.name}",
        }
        result = SkillWriter.generate_prompt_section(
            [mock_skill, mock_skill_no_hash], skill_paths,
        )
        assert f"### {mock_skill.metadata.name}" in result
        assert f"### {mock_skill_no_hash.metadata.name}" in result
        assert mock_skill.spec.skill_md not in result
        assert mock_skill_no_hash.spec.skill_md not in result

    def test_fallback_path_when_missing(self, mock_skill):
        result = SkillWriter.generate_prompt_section([mock_skill], {})
        assert f"**Location**: `.stigmer/skills/{mock_skill.metadata.name}/`" in result

    def test_workspace_rule_covers_read_and_execute(self, mock_skill):
        """Prompt must guide agents on resolving skill-relative paths
        for both file reading and shell execution."""
        skill_paths = {
            mock_skill.metadata.id: f".stigmer/skills/{mock_skill.metadata.name}",
        }
        result = SkillWriter.generate_prompt_section([mock_skill], skill_paths)

        assert "### Working with Skill Files" in result, (
            "Prompt must include a dedicated subsection for skill file access"
        )
        assert "**Location**" in result, (
            "Prompt must explain how to read skill files via Location path"
        )
        assert "`read {location}/" in result, (
            "Prompt must show a read example using {location}"
        )
        assert "`execute(" in result, (
            "Prompt must show an execute example"
        )

    def test_progressive_disclosure_format(self, mock_skill):
        skill_paths = {
            mock_skill.metadata.id: f".stigmer/skills/{mock_skill.metadata.name}",
        }
        result = SkillWriter.generate_prompt_section([mock_skill], skill_paths)
        lines = result.split("\n")

        header_idx = next(
            i for i, line in enumerate(lines)
            if f"### {mock_skill.metadata.name}" == line
        )
        assert lines[header_idx + 1].startswith("**Description**:")
        assert lines[header_idx + 2].startswith("**Location**:")
        assert lines[header_idx + 3].startswith("**Activate**:")


# ---------------------------------------------------------------------------
# Skill directory naming
# ---------------------------------------------------------------------------


class TestSkillDirNaming:
    """Tests for _get_skill_relative_dir() and _resolve_skill_dir_name()."""

    def test_uses_metadata_name(self, mock_skill):
        backend = _make_mock_backend()
        writer = SkillWriter(backend=backend)
        result = writer._get_skill_relative_dir(mock_skill)
        assert result == f".stigmer/skills/{mock_skill.metadata.name}"
        assert not result.startswith("/")

    def test_name_preferred_over_hash(self, mock_skill):
        backend = _make_mock_backend()
        writer = SkillWriter(backend=backend)
        result = writer._get_skill_relative_dir(mock_skill)
        assert mock_skill.metadata.name in result
        assert mock_skill.status.version_hash not in result

    def test_falls_back_to_hash(self, mock_skill_no_name):
        backend = _make_mock_backend()
        writer = SkillWriter(backend=backend)
        result = writer._get_skill_relative_dir(mock_skill_no_name)
        assert result == f".stigmer/skills/{mock_skill_no_name.status.version_hash}"

    def test_full_fallback_chain(self):
        skill = MagicMock()
        skill.metadata.name = ""
        skill.status.version_hash = ""
        skill.metadata.slug = "org/my-skill"

        assert SkillWriter._resolve_skill_dir_name(skill) == "org_my-skill"


# ---------------------------------------------------------------------------
# Prompt integration (write then generate)
# ---------------------------------------------------------------------------


class TestWriteThenPrompt:
    """End-to-end: write skills, then generate prompt.

    Verifies that workspace-relative paths flow correctly from
    write_skills() through generate_prompt_section().
    """

    def test_local_backend_location_is_relative(self, mock_skill):
        with tempfile.TemporaryDirectory() as tmpdir:
            backend = LocalWorkspaceBackend(root_dir=tmpdir)
            writer = SkillWriter(backend=backend)
            skill_paths = writer.write_skills([mock_skill])

            prompt = SkillWriter.generate_prompt_section([mock_skill], skill_paths)

            expected = f"**Location**: `.stigmer/skills/{mock_skill.metadata.name}/`"
            assert expected in prompt

    def test_mock_backend_location_is_relative(self, mock_skill):
        backend = _make_mock_backend()
        writer = SkillWriter(backend=backend)
        skill_paths = writer.write_skills([mock_skill])

        prompt = SkillWriter.generate_prompt_section([mock_skill], skill_paths)

        expected = f"**Location**: `.stigmer/skills/{mock_skill.metadata.name}/`"
        assert expected in prompt


# ---------------------------------------------------------------------------
# End-to-end with FilesystemBackend (agent-side read after runner-side write)
# ---------------------------------------------------------------------------


class TestEndToEndWithFilesystemBackend:
    """Write via SkillWriter + LocalWorkspaceBackend, read via graphton's
    FilesystemBackend.

    Validates that the runner's write paths align with the agent's read
    paths — the same cross-layer contract the old tests verified.
    """

    def test_write_then_ls_finds_skills(self, mock_skill):
        with tempfile.TemporaryDirectory() as tmpdir:
            backend = LocalWorkspaceBackend(root_dir=tmpdir)
            writer = SkillWriter(backend=backend)
            skill_paths = writer.write_skills([mock_skill])

            agent_backend = FilesystemBackend(root_dir=tmpdir)
            skill_path = skill_paths[mock_skill.metadata.id]
            parent_dir = os.path.dirname(skill_path)
            items = agent_backend.list_files(parent_dir)

            assert mock_skill.metadata.name in items

    def test_write_then_read_skill_md(self, mock_skill):
        with tempfile.TemporaryDirectory() as tmpdir:
            backend = LocalWorkspaceBackend(root_dir=tmpdir)
            writer = SkillWriter(backend=backend)
            skill_paths = writer.write_skills([mock_skill])

            agent_backend = FilesystemBackend(root_dir=tmpdir)
            skill_path = skill_paths[mock_skill.metadata.id]
            content = agent_backend.read(f"{skill_path}/SKILL.md")

            assert content == mock_skill.spec.skill_md

    def test_write_artifact_then_ls(self, mock_skill, sample_artifact_zip):
        with tempfile.TemporaryDirectory() as tmpdir:
            backend = LocalWorkspaceBackend(root_dir=tmpdir)
            writer = SkillWriter(backend=backend)
            artifacts = {mock_skill.metadata.id: sample_artifact_zip}
            skill_paths = writer.write_skills([mock_skill], artifacts=artifacts)

            agent_backend = FilesystemBackend(root_dir=tmpdir)
            skill_path = skill_paths[mock_skill.metadata.id]
            items = agent_backend.list_files(skill_path)

            assert "SKILL.md" in items
            assert "run.sh" in items
            assert "main.py" in items

    def test_write_artifact_then_execute_script(
        self, mock_skill, sample_artifact_zip,
    ):
        with tempfile.TemporaryDirectory() as tmpdir:
            backend = LocalWorkspaceBackend(root_dir=tmpdir)
            writer = SkillWriter(backend=backend)
            artifacts = {mock_skill.metadata.id: sample_artifact_zip}
            skill_paths = writer.write_skills([mock_skill], artifacts=artifacts)

            agent_backend = FilesystemBackend(root_dir=tmpdir)
            skill_path = skill_paths[mock_skill.metadata.id]
            result = agent_backend.execute(f"python3 {skill_path}/main.py")

            assert result.exit_code == 0
            assert "Hello from Python!" in result.stdout


# ---------------------------------------------------------------------------
# Also Available section (skill relevance filtering)
# ---------------------------------------------------------------------------


class TestGenerateAlsoAvailableSection:
    """Tests for SkillWriter.generate_also_available_section()."""

    def test_empty_excluded_names_returns_empty(self):
        assert SkillWriter.generate_also_available_section([]) == ""

    def test_single_excluded_skill(self):
        section = SkillWriter.generate_also_available_section(["redis-cache"])
        assert "### Also Available" in section
        assert "`redis-cache`" in section
        assert "SKILL.md" in section

    def test_multiple_excluded_skills(self):
        section = SkillWriter.generate_also_available_section(
            ["alpha-skill", "beta-skill", "gamma-skill"],
        )
        assert "`alpha-skill`" in section
        assert "`beta-skill`" in section
        assert "`gamma-skill`" in section

    def test_activation_guidance_present(self):
        section = SkillWriter.generate_also_available_section(["any-skill"])
        assert ".stigmer/skills/<name>/SKILL.md" in section
