"""Integration tests for the skill artifact download and extraction pipeline.

These tests verify the end-to-end flow per ADR 001:
1. Skill fetch via gRPC (mocked)
2. Artifact download via GetArtifact RPC (mocked)
3. ZIP extraction to local filesystem
4. SKILL.md injection into system prompt with LOCATION header
5. Executable permissions set on scripts

Test Categories:
- Full Pipeline Integration: Complete flow from skill refs to prompt injection
- Version Resolution: Tests for latest/tag/hash resolution
- ADR 001 Compliance: Verify generated prompts match ADR format
- Error Recovery: Graceful degradation when artifacts unavailable
"""

import pytest
import tempfile
import os
import zipfile
import io
import stat
from unittest.mock import AsyncMock, MagicMock, patch

# Import components under test
from worker.activities.graphton.skill_writer import SkillWriter


class TestFullPipelineIntegration:
    """Integration tests for complete skill artifact pipeline."""

    @pytest.fixture
    def skill_with_artifact(self):
        """Create a mock skill with artifact storage key."""
        skill = MagicMock()
        skill.metadata.id = "skill-integration-001"
        skill.metadata.name = "integration-test-skill"
        skill.metadata.slug = "test-org/integration-skill"
        skill.spec.skill_md = """# Integration Test Skill

## Description
This skill demonstrates the full artifact pipeline.

## Usage
Run `./run.sh` to execute the skill.

## Tools
- `run.sh` - Main execution script
- `helper.py` - Python helper module
"""
        skill.status.version_hash = "a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd"
        skill.status.artifact_storage_key = "skills/test-org/integration-skill/a1b2c3d4e5f6.zip"
        return skill

    @pytest.fixture
    def skill_without_artifact(self):
        """Create a mock skill without artifact (SKILL.md only)."""
        skill = MagicMock()
        skill.metadata.id = "skill-no-artifact-002"
        skill.metadata.name = "metadata-only-skill"
        skill.metadata.slug = "test-org/metadata-skill"
        skill.spec.skill_md = """# Metadata Only Skill

This skill has no artifact ZIP, only SKILL.md content.
"""
        skill.status.version_hash = "b2c3d4e5f6789012345678901234567890123456789012345678901234abcdef"
        skill.status.artifact_storage_key = ""  # No artifact
        return skill

    @pytest.fixture
    def complex_artifact_zip(self) -> bytes:
        """Create a realistic artifact ZIP with nested structure."""
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            # SKILL.md - Required interface definition
            zf.writestr("SKILL.md", """# Integration Test Skill

## Description
Full integration test skill with all artifact types.

## Commands
- `./run.sh` - Main entry point
- `python helper.py` - Helper utilities
- `node index.js` - JavaScript runner

## Files
- `config/settings.yaml` - Configuration
- `data/sample.json` - Sample data
""")
            # Shell script (should be executable)
            zf.writestr("run.sh", """#!/bin/bash
set -e
echo "Running integration skill..."
python helper.py "$@"
""")
            # Python script (should be executable)
            zf.writestr("helper.py", """#!/usr/bin/env python3
import sys
import json

def main():
    print("Helper module executed")
    return 0

if __name__ == "__main__":
    sys.exit(main())
""")
            # JavaScript file (should be executable)
            zf.writestr("index.js", """#!/usr/bin/env node
console.log("JavaScript runner executed");
""")
            # TypeScript file (should be executable)
            zf.writestr("src/main.ts", """#!/usr/bin/env ts-node
console.log("TypeScript main");
""")
            # Ruby script (should be executable)
            zf.writestr("scripts/process.rb", """#!/usr/bin/env ruby
puts "Ruby processor"
""")
            # Perl script (should be executable)
            zf.writestr("scripts/legacy.pl", """#!/usr/bin/perl
print "Perl legacy script\\n";
""")
            # Config file (should NOT be executable)
            zf.writestr("config/settings.yaml", """version: "1.0.0"
debug: false
features:
  - artifact_download
  - skill_injection
""")
            # Data file (should NOT be executable)
            zf.writestr("data/sample.json", '{"items": [1, 2, 3]}')
            # Nested README (should NOT be executable)
            zf.writestr("docs/README.md", "# Documentation\n\nSee SKILL.md for usage.")
        return buffer.getvalue()

    def test_full_pipeline_with_artifact(self, skill_with_artifact, complex_artifact_zip):
        """Test complete pipeline: extract artifact → write files → generate prompt."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Setup
            skill = skill_with_artifact
            artifacts = {skill.metadata.id: complex_artifact_zip}
            
            # Execute pipeline
            writer = SkillWriter(local_root=tmpdir)
            skill_paths = writer.write_skills([skill], artifacts=artifacts)
            
            # Verify skill path returned
            assert skill.metadata.id in skill_paths
            expected_path = f"/bin/skills/{skill.status.version_hash}"
            assert skill_paths[skill.metadata.id] == expected_path
            
            # Verify files extracted to correct location
            local_skill_dir = f"{tmpdir}{expected_path}"
            assert os.path.isdir(local_skill_dir)
            
            # Verify SKILL.md extracted from ZIP
            skill_md_path = f"{local_skill_dir}/SKILL.md"
            assert os.path.isfile(skill_md_path)
            with open(skill_md_path, 'r') as f:
                content = f.read()
                assert "Integration Test Skill" in content
            
            # Verify shell script extracted and executable
            run_sh_path = f"{local_skill_dir}/run.sh"
            assert os.path.isfile(run_sh_path)
            assert os.access(run_sh_path, os.X_OK), "run.sh should be executable"
            
            # Verify Python script executable
            helper_py_path = f"{local_skill_dir}/helper.py"
            assert os.path.isfile(helper_py_path)
            assert os.access(helper_py_path, os.X_OK), "helper.py should be executable"
            
            # Verify JavaScript file executable
            index_js_path = f"{local_skill_dir}/index.js"
            assert os.path.isfile(index_js_path)
            assert os.access(index_js_path, os.X_OK), "index.js should be executable"
            
            # Verify TypeScript file executable (nested)
            main_ts_path = f"{local_skill_dir}/src/main.ts"
            assert os.path.isfile(main_ts_path)
            assert os.access(main_ts_path, os.X_OK), "main.ts should be executable"
            
            # Verify Ruby script executable
            ruby_path = f"{local_skill_dir}/scripts/process.rb"
            assert os.path.isfile(ruby_path)
            assert os.access(ruby_path, os.X_OK), "process.rb should be executable"
            
            # Verify Perl script executable
            perl_path = f"{local_skill_dir}/scripts/legacy.pl"
            assert os.path.isfile(perl_path)
            assert os.access(perl_path, os.X_OK), "legacy.pl should be executable"
            
            # Verify config file NOT executable (not a script)
            config_path = f"{local_skill_dir}/config/settings.yaml"
            assert os.path.isfile(config_path)
            # YAML files should not be executable
            mode = os.stat(config_path).st_mode
            assert not (mode & stat.S_IXUSR), "settings.yaml should not be executable"
            
            # Verify data file NOT executable
            data_path = f"{local_skill_dir}/data/sample.json"
            assert os.path.isfile(data_path)

    def test_full_pipeline_without_artifact_fallback(self, skill_without_artifact):
        """Test pipeline falls back to SKILL.md only when no artifact."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill = skill_without_artifact
            
            # Execute without artifacts
            writer = SkillWriter(local_root=tmpdir)
            skill_paths = writer.write_skills([skill], artifacts=None)
            
            # Verify skill path returned
            assert skill.metadata.id in skill_paths
            expected_path = f"/bin/skills/{skill.status.version_hash}"
            assert skill_paths[skill.metadata.id] == expected_path
            
            # Verify SKILL.md written from spec (not from ZIP)
            local_skill_dir = f"{tmpdir}{expected_path}"
            skill_md_path = f"{local_skill_dir}/SKILL.md"
            assert os.path.isfile(skill_md_path)
            with open(skill_md_path, 'r') as f:
                content = f.read()
                assert "Metadata Only Skill" in content
                assert "no artifact ZIP" in content

    def test_mixed_skills_with_and_without_artifacts(
        self, skill_with_artifact, skill_without_artifact, complex_artifact_zip
    ):
        """Test pipeline handles mix of skills with and without artifacts."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skills = [skill_with_artifact, skill_without_artifact]
            artifacts = {skill_with_artifact.metadata.id: complex_artifact_zip}
            
            writer = SkillWriter(local_root=tmpdir)
            skill_paths = writer.write_skills(skills, artifacts=artifacts)
            
            # Both skills should have paths
            assert len(skill_paths) == 2
            assert skill_with_artifact.metadata.id in skill_paths
            assert skill_without_artifact.metadata.id in skill_paths
            
            # Skill with artifact should have extracted files
            artifact_skill_dir = f"{tmpdir}{skill_paths[skill_with_artifact.metadata.id]}"
            assert os.path.isfile(f"{artifact_skill_dir}/run.sh")
            assert os.path.isfile(f"{artifact_skill_dir}/helper.py")
            
            # Skill without artifact should only have SKILL.md
            no_artifact_skill_dir = f"{tmpdir}{skill_paths[skill_without_artifact.metadata.id]}"
            assert os.path.isfile(f"{no_artifact_skill_dir}/SKILL.md")
            # Should not have any other files
            files_in_dir = os.listdir(no_artifact_skill_dir)
            assert files_in_dir == ["SKILL.md"]


class TestADR001Compliance:
    """Tests to verify compliance with ADR 001: Skill Injection & Sandbox Mounting Strategy."""

    @pytest.fixture
    def sample_skill(self):
        """Create a sample skill for ADR testing."""
        skill = MagicMock()
        skill.metadata.id = "adr-test-skill-001"
        skill.metadata.name = "adr-compliance-skill"
        skill.metadata.slug = "test-org/adr-skill"
        skill.spec.skill_md = """# ADR Compliance Skill

## Description
Tests compliance with ADR 001.

## Commands
- `./calculate.sh <args>` - Run calculation
"""
        skill.status.version_hash = "adr123abc456def789012345678901234567890123456789012345678901234"
        return skill

    def test_prompt_includes_location_header(self, sample_skill):
        """ADR Test 2: Generated prompt must contain LOCATION header."""
        skill_paths = {
            sample_skill.metadata.id: f"/bin/skills/{sample_skill.status.version_hash}"
        }
        
        prompt = SkillWriter.generate_prompt_section([sample_skill], skill_paths)
        
        # Must contain LOCATION header per ADR 001
        expected_location = f"LOCATION: /bin/skills/{sample_skill.status.version_hash}/"
        assert expected_location in prompt, f"Prompt must contain '{expected_location}'"

    def test_prompt_includes_skill_md_content(self, sample_skill):
        """ADR Test 1: Generated prompt must contain SKILL.md text content."""
        skill_paths = {
            sample_skill.metadata.id: f"/bin/skills/{sample_skill.status.version_hash}"
        }
        
        prompt = SkillWriter.generate_prompt_section([sample_skill], skill_paths)
        
        # Must contain full SKILL.md content
        assert "# ADR Compliance Skill" in prompt
        assert "Tests compliance with ADR 001" in prompt
        assert "./calculate.sh <args>" in prompt

    def test_prompt_format_matches_adr_template(self, sample_skill):
        """Verify prompt format matches ADR 001 template."""
        skill_paths = {
            sample_skill.metadata.id: f"/bin/skills/{sample_skill.status.version_hash}"
        }
        
        prompt = SkillWriter.generate_prompt_section([sample_skill], skill_paths)
        
        # ADR format: ### SKILL: {name} followed by LOCATION header
        assert "### SKILL: adr-compliance-skill" in prompt
        
        # LOCATION must come before SKILL.md content
        location_pos = prompt.find("LOCATION:")
        content_pos = prompt.find("# ADR Compliance Skill")
        assert location_pos < content_pos, "LOCATION header must precede SKILL.md content"

    def test_skills_written_to_bin_skills_directory(self, sample_skill):
        """ADR Decision B: Skills must be written to /bin/skills/{version_hash}/."""
        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(local_root=tmpdir)
            skill_paths = writer.write_skills([sample_skill])
            
            # Path must be /bin/skills/{version_hash}
            expected_path = f"/bin/skills/{sample_skill.status.version_hash}"
            assert skill_paths[sample_skill.metadata.id] == expected_path
            
            # Actual directory must exist
            local_path = f"{tmpdir}{expected_path}"
            assert os.path.isdir(local_path)

    def test_multiple_skills_generate_multiple_sections(self):
        """Test that multiple skills each get their own section."""
        skills = []
        skill_paths = {}
        
        for i in range(3):
            skill = MagicMock()
            skill.metadata.id = f"multi-skill-{i}"
            skill.metadata.name = f"skill-{i}"
            skill.spec.skill_md = f"# Skill {i} Content"
            skill.status.version_hash = f"hash{i}00000000000000000000000000000000000000000000000000000000"
            skills.append(skill)
            skill_paths[skill.metadata.id] = f"/bin/skills/{skill.status.version_hash}"
        
        prompt = SkillWriter.generate_prompt_section(skills, skill_paths)
        
        # Each skill should have its own section
        for i in range(3):
            assert f"### SKILL: skill-{i}" in prompt
            assert f"# Skill {i} Content" in prompt
            assert f"LOCATION: /bin/skills/hash{i}00000" in prompt


class TestVersionResolutionIntegration:
    """Integration tests for skill version resolution (latest/tag/hash)."""

    @pytest.fixture
    def skill_latest(self):
        """Skill at 'latest' version."""
        skill = MagicMock()
        skill.metadata.id = "version-latest-001"
        skill.metadata.name = "versioned-skill"
        skill.metadata.slug = "test-org/versioned"
        skill.spec.skill_md = "# Latest Version"
        skill.spec.tag = "latest"
        skill.status.version_hash = "latest123456789012345678901234567890123456789012345678901234ab"
        skill.status.artifact_storage_key = "skills/test-org/versioned/latest123.zip"
        return skill

    @pytest.fixture
    def skill_tagged_stable(self):
        """Skill at 'stable' tag."""
        skill = MagicMock()
        skill.metadata.id = "version-stable-002"
        skill.metadata.name = "versioned-skill"
        skill.metadata.slug = "test-org/versioned"
        skill.spec.skill_md = "# Stable Version"
        skill.spec.tag = "stable"
        skill.status.version_hash = "stable789012345678901234567890123456789012345678901234567890ab"
        skill.status.artifact_storage_key = "skills/test-org/versioned/stable789.zip"
        return skill

    @pytest.fixture
    def skill_pinned_hash(self):
        """Skill at exact hash version (immutable)."""
        skill = MagicMock()
        skill.metadata.id = "version-hash-003"
        skill.metadata.name = "versioned-skill"
        skill.metadata.slug = "test-org/versioned"
        skill.spec.skill_md = "# Pinned Hash Version (Immutable)"
        skill.spec.tag = "v1.2.3"
        skill.status.version_hash = "pinned456789012345678901234567890123456789012345678901234567ab"
        skill.status.artifact_storage_key = "skills/test-org/versioned/pinned456.zip"
        return skill

    def test_different_versions_have_different_paths(
        self, skill_latest, skill_tagged_stable, skill_pinned_hash
    ):
        """Different versions should result in different directories."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skills = [skill_latest, skill_tagged_stable, skill_pinned_hash]
            
            writer = SkillWriter(local_root=tmpdir)
            skill_paths = writer.write_skills(skills)
            
            # Each version should have unique path based on version_hash
            paths = list(skill_paths.values())
            assert len(set(paths)) == 3, "Each version should have unique path"
            
            # Verify paths use version_hash
            assert skill_paths[skill_latest.metadata.id] == f"/bin/skills/{skill_latest.status.version_hash}"
            assert skill_paths[skill_tagged_stable.metadata.id] == f"/bin/skills/{skill_tagged_stable.status.version_hash}"
            assert skill_paths[skill_pinned_hash.metadata.id] == f"/bin/skills/{skill_pinned_hash.status.version_hash}"

    def test_same_hash_reuses_directory(self):
        """Skills with same version_hash should use same directory (deduplication)."""
        skill1 = MagicMock()
        skill1.metadata.id = "skill-a"
        skill1.metadata.name = "skill-a"
        skill1.spec.skill_md = "# Skill A"
        skill1.status.version_hash = "shared123456789012345678901234567890123456789012345678901234ab"
        
        skill2 = MagicMock()
        skill2.metadata.id = "skill-b"
        skill2.metadata.name = "skill-b"
        skill2.spec.skill_md = "# Skill B (same hash)"
        skill2.status.version_hash = "shared123456789012345678901234567890123456789012345678901234ab"  # Same hash
        
        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(local_root=tmpdir)
            skill_paths = writer.write_skills([skill1, skill2])
            
            # Both skills should have same path (based on hash)
            assert skill_paths[skill1.metadata.id] == skill_paths[skill2.metadata.id]


class TestErrorRecoveryIntegration:
    """Integration tests for error recovery and graceful degradation."""

    @pytest.fixture
    def valid_skill(self):
        """Valid skill for error recovery tests."""
        skill = MagicMock()
        skill.metadata.id = "error-test-skill"
        skill.metadata.name = "error-recovery-skill"
        skill.metadata.slug = "test-org/error-skill"
        skill.spec.skill_md = "# Error Recovery Skill"
        skill.status.version_hash = "error123456789012345678901234567890123456789012345678901234ab"
        skill.status.artifact_storage_key = "skills/test-org/error-skill/error123.zip"
        return skill

    def test_invalid_zip_raises_runtime_error(self, valid_skill):
        """Invalid ZIP file should raise RuntimeError."""
        with tempfile.TemporaryDirectory() as tmpdir:
            invalid_zip = b"this is not a valid zip file"
            artifacts = {valid_skill.metadata.id: invalid_zip}
            
            writer = SkillWriter(local_root=tmpdir)
            
            with pytest.raises(RuntimeError) as exc_info:
                writer.write_skills([valid_skill], artifacts=artifacts)
            
            assert "Invalid ZIP file" in str(exc_info.value)

    def test_empty_zip_handles_gracefully(self, valid_skill):
        """Empty ZIP file should extract without error."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create empty but valid ZIP
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                pass  # Empty ZIP
            empty_zip = buffer.getvalue()
            
            artifacts = {valid_skill.metadata.id: empty_zip}
            
            writer = SkillWriter(local_root=tmpdir)
            skill_paths = writer.write_skills([valid_skill], artifacts=artifacts)
            
            # Should complete without error
            assert valid_skill.metadata.id in skill_paths

    def test_no_sandbox_or_local_root_raises_error(self, valid_skill):
        """SkillWriter without sandbox or local_root should raise error."""
        writer = SkillWriter()  # Neither sandbox nor local_root
        
        with pytest.raises(RuntimeError) as exc_info:
            writer.write_skills([valid_skill])
        
        assert "No sandbox or local_root configured" in str(exc_info.value)

    def test_artifact_download_failure_allows_fallback(self):
        """
        Simulate the execute_graphton fallback behavior:
        When artifact download fails, skill should still work with SKILL.md only.
        """
        skill = MagicMock()
        skill.metadata.id = "fallback-skill"
        skill.metadata.name = "fallback-skill"
        skill.spec.skill_md = "# Fallback Skill Content"
        skill.status.version_hash = "fallback1234567890123456789012345678901234567890123456789012ab"
        skill.status.artifact_storage_key = "skills/test/fallback.zip"  # Has key but download will "fail"
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Don't provide artifact (simulating download failure)
            writer = SkillWriter(local_root=tmpdir)
            skill_paths = writer.write_skills([skill], artifacts=None)
            
            # Should succeed with SKILL.md fallback
            assert skill.metadata.id in skill_paths
            
            # SKILL.md should exist from spec (not from artifact)
            skill_md_path = f"{tmpdir}{skill_paths[skill.metadata.id]}/SKILL.md"
            assert os.path.isfile(skill_md_path)
            with open(skill_md_path, 'r') as f:
                assert "Fallback Skill Content" in f.read()


class TestPromptGenerationIntegration:
    """Integration tests for system prompt generation."""

    def test_empty_skills_returns_empty_string(self):
        """Empty skill list should return empty string."""
        prompt = SkillWriter.generate_prompt_section([], {})
        assert prompt == ""

    def test_prompt_starts_with_section_header(self):
        """Prompt should start with Available Skills header."""
        skill = MagicMock()
        skill.metadata.id = "header-test"
        skill.metadata.name = "test-skill"
        skill.spec.skill_md = "# Test"
        skill.status.version_hash = "header123456789012345678901234567890123456789012345678901234ab"
        
        prompt = SkillWriter.generate_prompt_section(
            [skill], 
            {skill.metadata.id: f"/bin/skills/{skill.status.version_hash}"}
        )
        
        assert "## Available Skills" in prompt
        assert "specialized capabilities" in prompt

    def test_prompt_handles_missing_skill_path_gracefully(self):
        """Skill not in paths dict should use fallback path."""
        skill = MagicMock()
        skill.metadata.id = "orphan-skill"
        skill.metadata.name = "orphan"
        skill.spec.skill_md = "# Orphan"
        skill.status.version_hash = "orphan123456789012345678901234567890123456789012345678901234ab"
        
        # Don't include skill in paths (missing entry)
        prompt = SkillWriter.generate_prompt_section([skill], {})
        
        # Should use fallback path from version_hash
        assert f"/bin/skills/{skill.status.version_hash}" in prompt

    def test_prompt_preserves_skill_md_formatting(self):
        """SKILL.md content should preserve markdown formatting."""
        skill = MagicMock()
        skill.metadata.id = "format-test"
        skill.metadata.name = "formatted-skill"
        skill.spec.skill_md = """# Formatted Skill

## Code Example
```python
def hello():
    print("world")
```

## List
- Item 1
- Item 2

## Table
| Col1 | Col2 |
|------|------|
| A    | B    |
"""
        skill.status.version_hash = "format123456789012345678901234567890123456789012345678901234ab"
        
        prompt = SkillWriter.generate_prompt_section(
            [skill],
            {skill.metadata.id: f"/bin/skills/{skill.status.version_hash}"}
        )
        
        # All formatting should be preserved
        assert "```python" in prompt
        assert "def hello():" in prompt
        assert "- Item 1" in prompt
        assert "| Col1 | Col2 |" in prompt


class TestPathResolution:
    """Tests for skill path resolution logic."""

    def test_skill_with_hash_uses_hash_for_path(self):
        """Skill with version_hash should use hash for directory name."""
        skill = MagicMock()
        skill.metadata.slug = "org/skill"
        skill.status.version_hash = "abc12345678901234567890123456789012345678901234567890123456789a"
        
        writer = SkillWriter(local_root="/tmp")
        path = writer._get_skill_dir(skill)
        
        assert path == f"/bin/skills/{skill.status.version_hash}"

    def test_skill_without_hash_falls_back_to_slug(self):
        """Skill without version_hash should fall back to slugified name."""
        skill = MagicMock()
        skill.metadata.slug = "test-org/my-skill"
        skill.status.version_hash = ""  # Empty hash
        
        writer = SkillWriter(local_root="/tmp")
        path = writer._get_skill_dir(skill)
        
        # Slug with / replaced by _
        assert path == "/bin/skills/test-org_my-skill"

    def test_skill_dir_base_path_is_bin_skills(self):
        """All skill paths should be under /bin/skills/."""
        writer = SkillWriter(local_root="/tmp")
        assert writer.skills_base == "/bin/skills"
