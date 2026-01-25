"""Unit tests for SkillWriter class."""

import pytest
from unittest.mock import MagicMock, patch
import os
import stat
import tempfile
import zipfile
import io

from worker.activities.graphton.skill_writer import SkillWriter


class TestSkillWriterExtractArtifactLocal:
    """Tests for SkillWriter._extract_artifact_local() method."""

    def test_extract_basic_zip(self, sample_artifact_zip):
        """Test extracting a basic ZIP with SKILL.md and scripts."""
        writer = SkillWriter(local_root="/tmp/test")
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Act
            writer._extract_artifact_local(sample_artifact_zip, tmpdir)
            
            # Assert - files exist
            assert os.path.exists(os.path.join(tmpdir, "SKILL.md"))
            assert os.path.exists(os.path.join(tmpdir, "run.sh"))
            assert os.path.exists(os.path.join(tmpdir, "main.py"))
            assert os.path.exists(os.path.join(tmpdir, "config.json"))
            
            # Assert - content is correct
            with open(os.path.join(tmpdir, "SKILL.md")) as f:
                content = f.read()
                assert "Test Skill" in content

    def test_extract_makes_scripts_executable(self, sample_artifact_zip):
        """Test that script files are made executable."""
        writer = SkillWriter(local_root="/tmp/test")
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Act
            writer._extract_artifact_local(sample_artifact_zip, tmpdir)
            
            # Assert - scripts are executable
            sh_path = os.path.join(tmpdir, "run.sh")
            py_path = os.path.join(tmpdir, "main.py")
            json_path = os.path.join(tmpdir, "config.json")
            
            sh_mode = os.stat(sh_path).st_mode
            py_mode = os.stat(py_path).st_mode
            json_mode = os.stat(json_path).st_mode
            
            # Shell script should be executable
            assert sh_mode & stat.S_IXUSR, "run.sh should be executable"
            assert sh_mode & stat.S_IXGRP, "run.sh should be group executable"
            assert sh_mode & stat.S_IXOTH, "run.sh should be other executable"
            
            # Python script should be executable
            assert py_mode & stat.S_IXUSR, "main.py should be executable"
            
            # JSON config should NOT be executable (or at least we don't explicitly set it)
            # Note: We don't explicitly remove execute bits, so this may vary by umask

    def test_extract_nested_directories(self, sample_artifact_zip_nested):
        """Test extracting ZIP with nested directories."""
        writer = SkillWriter(local_root="/tmp/test")
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Act
            writer._extract_artifact_local(sample_artifact_zip_nested, tmpdir)
            
            # Assert - nested files exist
            assert os.path.exists(os.path.join(tmpdir, "SKILL.md"))
            assert os.path.exists(os.path.join(tmpdir, "src", "main.py"))
            assert os.path.exists(os.path.join(tmpdir, "scripts", "run.sh"))
            assert os.path.exists(os.path.join(tmpdir, "data", "config.yaml"))
            
            # Assert - nested scripts are executable
            nested_py = os.path.join(tmpdir, "src", "main.py")
            nested_sh = os.path.join(tmpdir, "scripts", "run.sh")
            
            assert os.stat(nested_py).st_mode & stat.S_IXUSR
            assert os.stat(nested_sh).st_mode & stat.S_IXUSR

    def test_extract_invalid_zip_raises_error(self):
        """Test that invalid ZIP data raises RuntimeError."""
        writer = SkillWriter(local_root="/tmp/test")
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Act & Assert
            with pytest.raises(RuntimeError) as exc_info:
                writer._extract_artifact_local(b"not a valid zip file", tmpdir)
            
            assert "Invalid ZIP file" in str(exc_info.value)

    def test_extract_empty_zip(self):
        """Test extracting an empty ZIP file."""
        writer = SkillWriter(local_root="/tmp/test")
        
        # Create empty ZIP
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as zf:
            pass  # Empty ZIP
        empty_zip = buffer.getvalue()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Act - should succeed without error
            writer._extract_artifact_local(empty_zip, tmpdir)
            
            # Assert - directory is empty (except for what the OS might add)
            files = [f for f in os.listdir(tmpdir) if not f.startswith('.')]
            assert len(files) == 0


class TestSkillWriterWriteSkillsLocal:
    """Tests for SkillWriter._write_skills_local() method."""

    def test_write_skills_without_artifacts(self, mock_skill):
        """Test writing skills without artifacts (backward compatibility)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(local_root=tmpdir)
            
            # Act
            result = writer.write_skills([mock_skill])
            
            # Assert
            assert mock_skill.metadata.id in result
            
            # Verify SKILL.md was written
            expected_path = f"{tmpdir}/bin/skills/{mock_skill.status.version_hash}/SKILL.md"
            assert os.path.exists(expected_path)
            
            with open(expected_path) as f:
                content = f.read()
                assert content == mock_skill.spec.skill_md

    def test_write_skills_with_artifacts(self, mock_skill, sample_artifact_zip):
        """Test writing skills with artifacts."""
        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(local_root=tmpdir)
            
            artifacts = {mock_skill.metadata.id: sample_artifact_zip}
            
            # Act
            result = writer.write_skills([mock_skill], artifacts=artifacts)
            
            # Assert
            assert mock_skill.metadata.id in result
            
            # Verify artifact was extracted (not just SKILL.md written)
            skill_dir = f"{tmpdir}/bin/skills/{mock_skill.status.version_hash}"
            assert os.path.exists(os.path.join(skill_dir, "SKILL.md"))
            assert os.path.exists(os.path.join(skill_dir, "run.sh"))
            assert os.path.exists(os.path.join(skill_dir, "main.py"))

    def test_write_skills_empty_list(self):
        """Test writing empty skill list."""
        writer = SkillWriter(local_root="/tmp/test")
        
        result = writer.write_skills([])
        
        assert result == {}

    def test_write_skills_fallback_to_slug_when_no_hash(self, mock_skill_no_hash):
        """Test skill directory uses slug when version_hash is empty."""
        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(local_root=tmpdir)
            
            # Act
            result = writer.write_skills([mock_skill_no_hash])
            
            # Assert - should use slug-based path (with / replaced by _)
            assert mock_skill_no_hash.metadata.id in result
            
            # The path should contain the slug (normalized)
            expected_slug = mock_skill_no_hash.metadata.slug.replace("/", "_")
            expected_dir = f"{tmpdir}/bin/skills/{expected_slug}"
            assert os.path.exists(expected_dir)

    def test_write_skills_no_sandbox_or_local_root_raises(self, mock_skill):
        """Test that missing both sandbox and local_root raises error."""
        writer = SkillWriter()  # No sandbox or local_root
        
        with pytest.raises(RuntimeError) as exc_info:
            writer.write_skills([mock_skill])
        
        assert "No sandbox or local_root configured" in str(exc_info.value)

    def test_write_multiple_skills(self, mock_skill, mock_skill_no_hash):
        """Test writing multiple skills at once."""
        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(local_root=tmpdir)
            
            # Act
            result = writer.write_skills([mock_skill, mock_skill_no_hash])
            
            # Assert
            assert len(result) == 2
            assert mock_skill.metadata.id in result
            assert mock_skill_no_hash.metadata.id in result


class TestSkillWriterGeneratePromptSection:
    """Tests for SkillWriter.generate_prompt_section() static method."""

    def test_generate_prompt_empty_skills(self):
        """Test prompt generation with empty skills list."""
        result = SkillWriter.generate_prompt_section([], {})
        assert result == ""

    def test_generate_prompt_single_skill(self, mock_skill):
        """Test prompt generation with single skill."""
        skill_paths = {
            mock_skill.metadata.id: f"/bin/skills/{mock_skill.status.version_hash}"
        }
        
        result = SkillWriter.generate_prompt_section([mock_skill], skill_paths)
        
        # Assert - contains required sections
        assert "## Available Skills" in result
        assert f"### SKILL: {mock_skill.metadata.name}" in result
        assert f"LOCATION: /bin/skills/{mock_skill.status.version_hash}/" in result
        assert mock_skill.spec.skill_md in result

    def test_generate_prompt_multiple_skills(self, mock_skill, mock_skill_no_hash):
        """Test prompt generation with multiple skills."""
        skill_paths = {
            mock_skill.metadata.id: f"/bin/skills/{mock_skill.status.version_hash}",
            mock_skill_no_hash.metadata.id: f"/bin/skills/{mock_skill_no_hash.metadata.slug.replace('/', '_')}"
        }
        
        result = SkillWriter.generate_prompt_section(
            [mock_skill, mock_skill_no_hash], 
            skill_paths
        )
        
        # Assert - contains both skills
        assert f"### SKILL: {mock_skill.metadata.name}" in result
        assert f"### SKILL: {mock_skill_no_hash.metadata.name}" in result

    def test_generate_prompt_uses_fallback_path(self, mock_skill):
        """Test prompt uses version_hash fallback when path not in dict."""
        # Empty skill_paths - should fall back to version_hash
        skill_paths = {}
        
        result = SkillWriter.generate_prompt_section([mock_skill], skill_paths)
        
        # Should still have a LOCATION with version_hash
        assert f"LOCATION: /bin/skills/{mock_skill.status.version_hash}/" in result

    def test_generate_prompt_format_adr_001(self, mock_skill):
        """Test prompt follows ADR 001 format: LOCATION header + full content."""
        skill_paths = {
            mock_skill.metadata.id: f"/bin/skills/{mock_skill.status.version_hash}"
        }
        
        result = SkillWriter.generate_prompt_section([mock_skill], skill_paths)
        
        # ADR 001 format: SKILL header, LOCATION, then full content
        lines = result.split('\n')
        
        # Find the skill section
        skill_header_idx = None
        for i, line in enumerate(lines):
            if f"### SKILL: {mock_skill.metadata.name}" in line:
                skill_header_idx = i
                break
        
        assert skill_header_idx is not None, "Skill header not found"
        
        # LOCATION should be right after header
        location_line = lines[skill_header_idx + 1]
        assert location_line.startswith("LOCATION:"), f"Expected LOCATION line, got: {location_line}"


class TestSkillWriterDaytona:
    """Tests for Daytona-specific functionality."""

    def test_write_skills_daytona_creates_directories(self, mock_skill):
        """Test that Daytona mode creates directories."""
        mock_sandbox = MagicMock()
        mock_sandbox.process.exec.return_value = MagicMock(exit_code=0, output="")
        mock_sandbox.fs.upload_files = MagicMock()
        
        writer = SkillWriter(sandbox=mock_sandbox)
        
        # Act
        result = writer.write_skills([mock_skill])
        
        # Assert - mkdir was called for base and skill directories
        mkdir_calls = [
            call for call in mock_sandbox.process.exec.call_args_list
            if 'mkdir' in str(call)
        ]
        assert len(mkdir_calls) >= 2  # At least base dir + skill dir

    def test_write_skills_daytona_with_artifacts_extracts(
        self, mock_skill, sample_artifact_zip
    ):
        """Test that Daytona mode extracts artifacts."""
        mock_sandbox = MagicMock()
        mock_sandbox.process.exec.return_value = MagicMock(exit_code=0, output="")
        mock_sandbox.fs.upload_files = MagicMock()
        
        writer = SkillWriter(sandbox=mock_sandbox)
        artifacts = {mock_skill.metadata.id: sample_artifact_zip}
        
        # Act
        result = writer.write_skills([mock_skill], artifacts=artifacts)
        
        # Assert - unzip command was called
        exec_calls = [str(call) for call in mock_sandbox.process.exec.call_args_list]
        assert any('unzip' in call for call in exec_calls), \
            "Expected unzip command in sandbox"

    def test_write_skills_daytona_upload_failure_raises(self, mock_skill):
        """Test that upload failure raises RuntimeError."""
        mock_sandbox = MagicMock()
        mock_sandbox.process.exec.return_value = MagicMock(exit_code=0, output="")
        mock_sandbox.fs.upload_files.side_effect = Exception("Upload failed")
        
        writer = SkillWriter(sandbox=mock_sandbox)
        
        # Act & Assert
        with pytest.raises(RuntimeError) as exc_info:
            writer.write_skills([mock_skill])
        
        assert "Failed to upload skills" in str(exc_info.value)

    def test_extract_artifact_daytona_makes_scripts_executable(self, mock_skill):
        """Test that Daytona extraction makes scripts executable."""
        mock_sandbox = MagicMock()
        mock_sandbox.process.exec.return_value = MagicMock(exit_code=0, output="")
        
        writer = SkillWriter(sandbox=mock_sandbox)
        skill_dir = "/bin/skills/abc123"
        
        # Act
        writer._extract_artifact_daytona(skill_dir)
        
        # Assert - chmod command was called
        exec_calls = [str(call) for call in mock_sandbox.process.exec.call_args_list]
        assert any('chmod' in call for call in exec_calls), \
            "Expected chmod command for making scripts executable"


class TestSkillWriterGetSkillDir:
    """Tests for SkillWriter._get_skill_dir() method."""

    def test_get_skill_dir_with_hash(self, mock_skill):
        """Test directory path uses version_hash."""
        writer = SkillWriter(local_root="/tmp")
        
        result = writer._get_skill_dir(mock_skill)
        
        assert result == f"/bin/skills/{mock_skill.status.version_hash}"

    def test_get_skill_dir_without_hash_uses_slug(self, mock_skill_no_hash):
        """Test directory path falls back to normalized slug."""
        writer = SkillWriter(local_root="/tmp")
        
        result = writer._get_skill_dir(mock_skill_no_hash)
        
        expected_slug = mock_skill_no_hash.metadata.slug.replace("/", "_")
        assert result == f"/bin/skills/{expected_slug}"
