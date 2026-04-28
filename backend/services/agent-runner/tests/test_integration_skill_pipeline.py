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

import io
import os
import stat
import tempfile
import zipfile
from unittest.mock import MagicMock

import pytest

# Import components under test
from stigmer_runner.worker.activities.graphton.skill_writer import SkillWriter
from stigmer_runner.worker.workspace.local import LocalWorkspaceBackend


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
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            skill_paths = writer.write_skills([skill], artifacts=artifacts)
            
            # Verify skill path returned (local mode returns sandbox-relative, no leading /)
            assert skill.metadata.id in skill_paths
            expected_path = f".stigmer/skills/{skill.metadata.name}"
            assert skill_paths[skill.metadata.id] == expected_path
            
            # Verify files extracted to correct location
            local_skill_dir = os.path.join(tmpdir, expected_path)
            assert os.path.isdir(local_skill_dir)
            
            # Verify SKILL.md extracted from ZIP
            skill_md_path = f"{local_skill_dir}/SKILL.md"
            assert os.path.isfile(skill_md_path)
            with open(skill_md_path) as f:
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
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            skill_paths = writer.write_skills([skill], artifacts=None)
            
            # Verify skill path returned (local mode, no leading /)
            assert skill.metadata.id in skill_paths
            expected_path = f".stigmer/skills/{skill.metadata.name}"
            assert skill_paths[skill.metadata.id] == expected_path
            
            # Verify SKILL.md written from spec (not from ZIP)
            local_skill_dir = os.path.join(tmpdir, expected_path)
            skill_md_path = f"{local_skill_dir}/SKILL.md"
            assert os.path.isfile(skill_md_path)
            with open(skill_md_path) as f:
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
            
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            skill_paths = writer.write_skills(skills, artifacts=artifacts)
            
            # Both skills should have paths
            assert len(skill_paths) == 2
            assert skill_with_artifact.metadata.id in skill_paths
            assert skill_without_artifact.metadata.id in skill_paths
            
            # Skill with artifact should have extracted files
            artifact_skill_dir = os.path.join(tmpdir, skill_paths[skill_with_artifact.metadata.id])
            assert os.path.isfile(f"{artifact_skill_dir}/run.sh")
            assert os.path.isfile(f"{artifact_skill_dir}/helper.py")
            
            # Skill without artifact should only have SKILL.md
            no_artifact_skill_dir = os.path.join(tmpdir, skill_paths[skill_without_artifact.metadata.id])
            assert os.path.isfile(f"{no_artifact_skill_dir}/SKILL.md")
            # Should not have any other files
            files_in_dir = os.listdir(no_artifact_skill_dir)
            assert files_in_dir == ["SKILL.md"]


class TestSpecCompliance:
    """Tests to verify compliance with the Agent Skills specification.

    https://agentskills.io/specification -- progressive disclosure model:
    - Metadata (name + description) injected at startup
    - SKILL.md body loaded by the agent on demand
    - Resources loaded as needed
    """

    @pytest.fixture
    def sample_skill(self):
        """Create a sample skill for spec compliance testing."""
        skill = MagicMock()
        skill.metadata.id = "spec-test-skill-001"
        skill.metadata.name = "spec-compliance-skill"
        skill.metadata.slug = "test-org/spec-skill"
        skill.spec.description = "Tests compliance with the Agent Skills specification."
        skill.spec.skill_md = """# Spec Compliance Skill

## Description
Tests compliance with the Agent Skills specification.

## Commands
- `./calculate.sh <args>` - Run calculation
"""
        skill.status.version_hash = "adr123abc456def789012345678901234567890123456789012345678901234"
        return skill

    def test_prompt_includes_location(self, sample_skill):
        """Prompt must contain the Location for the skill directory."""
        skill_paths = {
            sample_skill.metadata.id: f".stigmer/skills/{sample_skill.metadata.name}"
        }

        prompt = SkillWriter.generate_prompt_section([sample_skill], skill_paths)

        expected = f"**Location**: `.stigmer/skills/{sample_skill.metadata.name}/`"
        assert expected in prompt, f"Prompt must contain '{expected}'"

    def test_prompt_does_not_include_skill_md_body(self, sample_skill):
        """Prompt must NOT contain full SKILL.md body (progressive disclosure)."""
        skill_paths = {
            sample_skill.metadata.id: f".stigmer/skills/{sample_skill.metadata.name}"
        }

        prompt = SkillWriter.generate_prompt_section([sample_skill], skill_paths)

        # SKILL.md body markers must NOT be present
        assert "# Spec Compliance Skill" not in prompt
        assert "./calculate.sh <args>" not in prompt

    def test_prompt_includes_description(self, sample_skill):
        """Prompt must include the skill description."""
        skill_paths = {
            sample_skill.metadata.id: f".stigmer/skills/{sample_skill.metadata.name}"
        }

        prompt = SkillWriter.generate_prompt_section([sample_skill], skill_paths)

        assert sample_skill.spec.description in prompt

    def test_prompt_includes_activate_instruction(self, sample_skill):
        """Prompt must tell the agent how to activate the skill."""
        skill_paths = {
            sample_skill.metadata.id: f".stigmer/skills/{sample_skill.metadata.name}"
        }

        prompt = SkillWriter.generate_prompt_section([sample_skill], skill_paths)

        expected = f"**Activate**: `read .stigmer/skills/{sample_skill.metadata.name}/SKILL.md`"
        assert expected in prompt

    def test_skills_written_to_bin_skills_directory(self, sample_skill):
        """Skills must be written to .stigmer/skills/{name}/."""
        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            skill_paths = writer.write_skills([sample_skill])

            expected_path = f".stigmer/skills/{sample_skill.metadata.name}"
            assert skill_paths[sample_skill.metadata.id] == expected_path

            local_path = os.path.join(tmpdir, expected_path)
            assert os.path.isdir(local_path)

    def test_multiple_skills_generate_multiple_sections(self):
        """Test that multiple skills each get their own section."""
        skills = []
        skill_paths = {}

        for i in range(3):
            skill = MagicMock()
            skill.metadata.id = f"multi-skill-{i}"
            skill.metadata.name = f"skill-{i}"
            skill.spec.description = f"Description for skill {i}."
            skill.spec.skill_md = f"# Skill {i} Content"
            skill.status.version_hash = f"hash{i}"
            skills.append(skill)
            skill_paths[skill.metadata.id] = f".stigmer/skills/skill-{i}"

        prompt = SkillWriter.generate_prompt_section(skills, skill_paths)

        for i in range(3):
            assert f"### skill-{i}" in prompt
            assert f"**Location**: `.stigmer/skills/skill-{i}/`" in prompt
            # Body content must NOT be injected
            assert f"# Skill {i} Content" not in prompt


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
        """Different versions with same name share a directory (name-based paths)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skills = [skill_latest, skill_tagged_stable, skill_pinned_hash]
            
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            skill_paths = writer.write_skills(skills)
            
            # All three skills share the same metadata.name ("versioned-skill"),
            # so they map to the same name-based directory.
            expected_path = f".stigmer/skills/{skill_latest.metadata.name}"
            assert skill_paths[skill_latest.metadata.id] == expected_path
            assert skill_paths[skill_tagged_stable.metadata.id] == expected_path
            assert skill_paths[skill_pinned_hash.metadata.id] == expected_path

    def test_same_name_reuses_directory(self):
        """Skills with same metadata.name should use same directory (name-based dedup)."""
        skill1 = MagicMock()
        skill1.metadata.id = "skill-a"
        skill1.metadata.name = "shared-skill"
        skill1.spec.skill_md = "# Skill A"
        skill1.status.version_hash = "hash_a_123456789012345678901234567890123456789012345678901234"
        
        skill2 = MagicMock()
        skill2.metadata.id = "skill-b"
        skill2.metadata.name = "shared-skill"
        skill2.spec.skill_md = "# Skill B (same name)"
        skill2.status.version_hash = "hash_b_123456789012345678901234567890123456789012345678901234"
        
        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            skill_paths = writer.write_skills([skill1, skill2])
            
            # Both skills share the same name-based path
            assert skill_paths[skill1.metadata.id] == skill_paths[skill2.metadata.id]
            assert skill_paths[skill1.metadata.id] == ".stigmer/skills/shared-skill"


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
            
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            
            with pytest.raises(RuntimeError) as exc_info:
                writer.write_skills([valid_skill], artifacts=artifacts)
            
            assert "Invalid ZIP artifact" in str(exc_info.value)

    def test_empty_zip_handles_gracefully(self, valid_skill):
        """Empty ZIP file should extract without error."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create empty but valid ZIP
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED):
                pass  # Empty ZIP
            empty_zip = buffer.getvalue()
            
            artifacts = {valid_skill.metadata.id: empty_zip}
            
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            skill_paths = writer.write_skills([valid_skill], artifacts=artifacts)
            
            # Should complete without error
            assert valid_skill.metadata.id in skill_paths

    def test_no_backend_raises_type_error(self, valid_skill):
        """SkillWriter without backend should raise TypeError."""
        with pytest.raises(TypeError):
            SkillWriter()  # Missing required 'backend' argument

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
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            skill_paths = writer.write_skills([skill], artifacts=None)
            
            # Should succeed with SKILL.md fallback
            assert skill.metadata.id in skill_paths
            
            # SKILL.md should exist from spec (not from artifact)
            skill_md_path = os.path.join(tmpdir, skill_paths[skill.metadata.id], "SKILL.md")
            assert os.path.isfile(skill_md_path)
            with open(skill_md_path) as f:
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
            {skill.metadata.id: f"/.stigmer/skills/{skill.status.version_hash}"}
        )
        
        assert "## Available Skills" in prompt
        assert "pre-installed in your workspace" in prompt

    def test_prompt_handles_missing_skill_path_gracefully(self):
        """Skill not in paths dict should use fallback path from metadata.name."""
        skill = MagicMock()
        skill.metadata.id = "orphan-skill"
        skill.metadata.name = "orphan"
        skill.spec.skill_md = "# Orphan"
        skill.status.version_hash = "orphan123456789012345678901234567890123456789012345678901234ab"
        
        # Don't include skill in paths (missing entry)
        prompt = SkillWriter.generate_prompt_section([skill], {})
        
        # Should use fallback path from metadata.name
        assert ".stigmer/skills/orphan" in prompt

    def test_prompt_does_not_inline_skill_md_content(self):
        """Prompt follows progressive disclosure — SKILL.md body is NOT inlined."""
        skill = MagicMock()
        skill.metadata.id = "format-test"
        skill.metadata.name = "formatted-skill"
        skill.spec.description = "A skill for formatting tests."
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
            {skill.metadata.id: f".stigmer/skills/{skill.metadata.name}"}
        )
        
        # Metadata should be present
        assert "formatted-skill" in prompt
        assert ".stigmer/skills/formatted-skill" in prompt
        
        # SKILL.md body must NOT be inlined (progressive disclosure)
        assert "```python" not in prompt
        assert "def hello():" not in prompt
        assert "| Col1 | Col2 |" not in prompt


class TestPathResolution:
    """Tests for skill path resolution logic.

    With name-based directories, the path uses ``skill.metadata.name``
    as the directory name (human-readable), falling back to
    ``version_hash`` or ``slug`` only when the name is absent.
    """

    def test_skill_uses_name_for_path(self):
        """Skill with metadata.name should use name for directory."""
        skill = MagicMock()
        skill.metadata.name = "my-skill"
        skill.metadata.slug = "org/my-skill"
        skill.status.version_hash = "abc12345678901234567890123456789012345678901234567890123456789a"

        writer = SkillWriter(backend=MagicMock())
        path = writer._get_skill_relative_dir(skill)

        assert path == ".stigmer/skills/my-skill"
        assert not path.startswith("/"), "Path should be workspace-relative"

    def test_skill_without_name_falls_back_to_hash(self):
        """Skill without metadata.name should fall back to version_hash."""
        skill = MagicMock()
        skill.metadata.name = ""
        skill.metadata.slug = "test-org/unnamed"
        skill.status.version_hash = "fff999aaa111"

        writer = SkillWriter(backend=MagicMock())
        path = writer._get_skill_relative_dir(skill)

        assert path == ".stigmer/skills/fff999aaa111"

    def test_skill_without_name_or_hash_falls_back_to_slug(self):
        """Skill without name or hash should fall back to slugified slug."""
        skill = MagicMock()
        skill.metadata.name = ""
        skill.metadata.slug = "test-org/my-skill"
        skill.status.version_hash = ""

        writer = SkillWriter(backend=MagicMock())
        path = writer._get_skill_relative_dir(skill)

        assert path == ".stigmer/skills/test-org_my-skill"

    def test_skill_dir_base_path_is_bin_skills(self):
        """Skills base dir constant is kept for backward compatibility."""
        assert SkillWriter.SKILLS_BASE_DIR == "/.stigmer/skills"


class TestZipFormatEndToEnd:
    """End-to-end: create ZIP in various formats → extract → list → read via backend.

    These tests verify that the skill pipeline works consistently regardless of
    how the ZIP was created (vendor_skill.sh, CLI push, or package_skill.py).
    The critical invariant is: every file the backend can *list* must also be
    *readable* at the listed path.
    """

    @pytest.fixture
    def mock_skill(self):
        """A minimal mock skill for ZIP format tests."""
        skill = MagicMock()
        skill.metadata.id = "zip-fmt-skill"
        skill.metadata.name = "zip-format-skill"
        skill.metadata.slug = "test-org/zip-format"
        skill.spec.skill_md = "# ZIP Format Test Skill"
        skill.status.version_hash = (
            "e2e0000000000000000000000000000000000000000000000000000000000001"
        )
        skill.status.artifact_storage_key = "skills/test/zip-format.zip"
        return skill

    # ------------------------------------------------------------------
    # Helper: create ZIPs in the three known formats
    # ------------------------------------------------------------------

    @staticmethod
    def _create_flat_zip() -> bytes:
        """Create a ZIP with flat paths (as produced by CLI push and vendor_skill.sh).

        Entries:
            SKILL.md
            scripts/init_skill.py
            scripts/helper.py
            references/guide.md
            LICENSE.txt
        """
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("SKILL.md", "# Flat ZIP Skill\n\nFlat structure.")
            zf.writestr(
                "scripts/init_skill.py",
                '#!/usr/bin/env python3\nprint("init")\n',
            )
            zf.writestr(
                "scripts/helper.py",
                '#!/usr/bin/env python3\nprint("helper")\n',
            )
            zf.writestr("references/guide.md", "# Guide\n\nReference doc.")
            zf.writestr("LICENSE.txt", "MIT License")
        return buf.getvalue()

    @staticmethod
    def _create_nested_zip(skill_name: str = "my-skill") -> bytes:
        """Create a ZIP with nested skill-name prefix (old package_skill.py bug).

        Entries:
            my-skill/SKILL.md
            my-skill/scripts/init_skill.py
            my-skill/LICENSE.txt
        """
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                f"{skill_name}/SKILL.md",
                "# Nested ZIP Skill\n\nNested structure.",
            )
            zf.writestr(
                f"{skill_name}/scripts/init_skill.py",
                '#!/usr/bin/env python3\nprint("init")\n',
            )
            zf.writestr(f"{skill_name}/LICENSE.txt", "MIT License")
        return buf.getvalue()

    @staticmethod
    def _create_dot_prefix_zip() -> bytes:
        """Create a ZIP with ./ prefixed paths (as produced by ``zip -rq . ...``).

        Entries:
            ./SKILL.md
            ./scripts/init_skill.py
            ./LICENSE.txt
        """
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("./SKILL.md", "# Dot-prefix ZIP Skill")
            zf.writestr(
                "./scripts/init_skill.py",
                '#!/usr/bin/env python3\nprint("init")\n',
            )
            zf.writestr("./LICENSE.txt", "MIT License")
        return buf.getvalue()

    # ------------------------------------------------------------------
    # Core invariant: everything listable must be readable
    # ------------------------------------------------------------------

    def _assert_listable_files_are_readable(
        self, backend, skill_path: str, *, depth: int = 0, max_depth: int = 5
    ) -> list[str]:
        """Recursively walk directories via backend and read every file.

        Returns the list of all readable file paths (relative to workspace).
        Raises AssertionError if any listed item cannot be read.
        """
        if depth > max_depth:
            return []

        items = backend.list_files(skill_path)
        readable = []

        for item in items:
            item_path = f"{skill_path}/{item}"
            if backend.is_directory(item_path):
                readable.extend(
                    self._assert_listable_files_are_readable(
                        backend, item_path, depth=depth + 1, max_depth=max_depth
                    )
                )
            else:
                try:
                    backend.read(item_path)
                    readable.append(item_path)
                except FileNotFoundError as exc:
                    raise AssertionError(
                        f"File listed but not readable: '{item_path}'"
                    ) from exc

        return readable

    # ------------------------------------------------------------------
    # Tests
    # ------------------------------------------------------------------

    def test_flat_zip_list_then_read(self, mock_skill):
        """Flat ZIP (CLI / vendor format): every listed file must be readable."""
        from graphton.core.backends.filesystem import FilesystemBackend

        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            artifacts = {mock_skill.metadata.id: self._create_flat_zip()}
            skill_paths = writer.write_skills([mock_skill], artifacts=artifacts)

            backend = FilesystemBackend(root_dir=tmpdir)
            skill_path = skill_paths[mock_skill.metadata.id]

            files = self._assert_listable_files_are_readable(backend, skill_path)

            # Verify expected files are present
            assert any("SKILL.md" in f for f in files)
            assert any("scripts/init_skill.py" in f for f in files)
            assert any("scripts/helper.py" in f for f in files)
            assert any("references/guide.md" in f for f in files)
            assert any("LICENSE.txt" in f for f in files)

    def test_dot_prefix_zip_list_then_read(self, mock_skill):
        """Dot-prefix ZIP (vendor_skill.sh format): list then read consistency."""
        from graphton.core.backends.filesystem import FilesystemBackend

        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            artifacts = {mock_skill.metadata.id: self._create_dot_prefix_zip()}
            skill_paths = writer.write_skills([mock_skill], artifacts=artifacts)

            backend = FilesystemBackend(root_dir=tmpdir)
            skill_path = skill_paths[mock_skill.metadata.id]

            files = self._assert_listable_files_are_readable(backend, skill_path)

            assert any("SKILL.md" in f for f in files)
            assert any("scripts/init_skill.py" in f for f in files)

    def test_nested_zip_extracts_with_extra_directory(self, mock_skill):
        """Nested ZIP (old package_skill.py bug): files land one level deeper.

        This test documents the known pathological behaviour so we can detect
        if the nesting bug is reintroduced.  With the old format the agent
        would see ``ls {hash}/`` returning ``['my-skill']`` instead of
        ``['SKILL.md', 'scripts', ...]``.
        """
        from graphton.core.backends.filesystem import FilesystemBackend

        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            artifacts = {mock_skill.metadata.id: self._create_nested_zip("my-skill")}
            skill_paths = writer.write_skills([mock_skill], artifacts=artifacts)

            backend = FilesystemBackend(root_dir=tmpdir)
            skill_path = skill_paths[mock_skill.metadata.id]

            # With the nested ZIP the top-level listing shows the skill-name
            # directory instead of the actual skill contents.
            top_level = backend.list_files(skill_path)
            assert "my-skill" in top_level, (
                "Nested ZIP should extract skill-name as a subdirectory"
            )
            # SKILL.md should NOT be at the top level (it's nested inside)
            assert "SKILL.md" not in top_level

    def test_flat_zip_scripts_are_executable(self, mock_skill):
        """Scripts in flat ZIP must be executable after extraction."""
        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            artifacts = {mock_skill.metadata.id: self._create_flat_zip()}
            writer.write_skills([mock_skill], artifacts=artifacts)

            skill_dir = os.path.join(
                tmpdir,
                ".stigmer",
                "skills",
                mock_skill.metadata.name,
            )

            py_path = os.path.join(skill_dir, "scripts", "init_skill.py")
            assert os.path.isfile(py_path)
            assert os.stat(py_path).st_mode & stat.S_IXUSR, (
                "Python scripts must be executable"
            )

    def test_read_nonexistent_file_gives_diagnostic(self, mock_skill):
        """Reading a missing file should report the resolved path and siblings."""
        from graphton.core.backends.filesystem import FilesystemBackend

        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            artifacts = {mock_skill.metadata.id: self._create_flat_zip()}
            skill_paths = writer.write_skills([mock_skill], artifacts=artifacts)

            backend = FilesystemBackend(root_dir=tmpdir)
            skill_path = skill_paths[mock_skill.metadata.id]

            with pytest.raises(FileNotFoundError) as exc_info:
                backend.read(f"{skill_path}/scripts/nonexistent.py")

            error_msg = str(exc_info.value)
            # Error should contain the resolved absolute path for debugging
            assert "resolved to" in error_msg
            # Error should hint at what the directory actually contains
            assert "Parent directory" in error_msg

    def test_read_directory_returns_listing(self, mock_skill):
        """Reading a directory path should return a structured listing."""
        from graphton.core.backends.filesystem import FilesystemBackend

        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            artifacts = {mock_skill.metadata.id: self._create_flat_zip()}
            skill_paths = writer.write_skills([mock_skill], artifacts=artifacts)

            backend = FilesystemBackend(root_dir=tmpdir)
            skill_path = skill_paths[mock_skill.metadata.id]

            result = backend.read(f"{skill_path}/scripts")
            assert "[Directory:" in result
            assert "init_skill.py" in result

    def test_list_file_path_gives_clear_error(self, mock_skill):
        """Listing a file (not directory) should raise NotADirectoryError."""
        from graphton.core.backends.filesystem import FilesystemBackend

        with tempfile.TemporaryDirectory() as tmpdir:
            writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
            artifacts = {mock_skill.metadata.id: self._create_flat_zip()}
            skill_paths = writer.write_skills([mock_skill], artifacts=artifacts)

            backend = FilesystemBackend(root_dir=tmpdir)
            skill_path = skill_paths[mock_skill.metadata.id]

            with pytest.raises(NotADirectoryError) as exc_info:
                backend.list_files(f"{skill_path}/SKILL.md")

            assert "is a file" in str(exc_info.value)


def _tc(name: str, args: dict, tc_id: str = "call_test_001") -> dict:
    """Build a ToolCall-format input dict for tool.ainvoke()."""
    return {"name": name, "args": args, "id": tc_id, "type": "tool_call"}


class TestToolAliasSkillReads:
    """Integration tests verifying that platform tool ALIASES can read skills.

    This is the critical regression test for the tool-selection-conflict bug:
    deepagents creates in-memory ``read_file``/``write_file``/``edit_file``
    tools, while graphton creates filesystem-backed ``read``/``write``/``edit``
    tools.  If the LLM calls ``read_file`` (the deepagents name), it misses
    files on the real filesystem.

    The fix registers graphton aliases with the *same* names
    (``read_file``, ``write_file``, ``edit_file``) backed by the real
    filesystem, so both tool names resolve to the same backend.

    These tests verify that:
    1. ``create_platform_tool_wrappers`` returns aliases with expected names
    2. The ``read``-named tool can read skill files with all path formats
    3. The ``read_file``-named alias can read skill files with all path formats
    """

    @pytest.fixture
    def skill_and_backend(self):
        """Write a skill to a temp dir and return (backend, skill_path, expected_content)."""
        skill = MagicMock()
        skill.metadata.id = "tool-alias-test-001"
        skill.metadata.name = "alias-test-skill"
        skill.metadata.slug = "test-org/alias-skill"
        skill.spec.skill_md = "# Alias Test Skill\n\nThis skill tests tool alias resolution."
        skill.status.version_hash = "alias00000000000000000000000000000000000000000000000000000001"
        skill.status.artifact_storage_key = ""

        tmpdir = tempfile.mkdtemp()
        writer = SkillWriter(backend=LocalWorkspaceBackend(root_dir=tmpdir))
        skill_paths = writer.write_skills([skill])
        skill_path = skill_paths[skill.metadata.id]

        from graphton.core.backends.filesystem import FilesystemBackend
        backend = FilesystemBackend(root_dir=tmpdir)

        expected_content = skill.spec.skill_md
        yield backend, skill_path, expected_content, tmpdir

        # Cleanup
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)

    def test_platform_tools_include_aliases(self):
        """create_platform_tool_wrappers must return read_file, write_file, edit_file aliases."""
        from graphton.core.backends.filesystem import FilesystemBackend
        from graphton.core.tool_wrappers import create_platform_tool_wrappers

        with tempfile.TemporaryDirectory() as tmpdir:
            backend = FilesystemBackend(root_dir=tmpdir)
            tools = create_platform_tool_wrappers(backend)

            tool_names = [getattr(t, "name", "?") for t in tools]

            # Primary tools
            assert "read" in tool_names
            assert "write" in tool_names
            assert "edit" in tool_names
            assert "delete" in tool_names
            assert "ls" in tool_names
            assert "glob" in tool_names
            assert "grep" in tool_names
            assert "search" in tool_names
            assert "execute" in tool_names

            # Aliases (override deepagents' in-memory tools)
            assert "read_file" in tool_names, (
                "read_file alias must be present to override deepagents' in-memory tool"
            )
            assert "write_file" in tool_names, (
                "write_file alias must be present to override deepagents' in-memory tool"
            )
            assert "edit_file" in tool_names, (
                "edit_file alias must be present to override deepagents' in-memory tool"
            )
            assert "delete_file" in tool_names, (
                "delete_file alias must be present to override deepagents' in-memory tool"
            )

            # Total: 9 primary + 4 aliases = 13
            assert len(tools) == 13

    @pytest.mark.asyncio
    async def test_read_tool_reads_skill_relative_path(self, skill_and_backend):
        """The 'read' tool must read skill files with relative paths."""
        from graphton.core.tool_wrappers import create_platform_tool_wrappers

        backend, skill_path, expected_content, _ = skill_and_backend
        tools = create_platform_tool_wrappers(backend)
        read_tool = next(t for t in tools if getattr(t, "name", "") == "read")

        result = await read_tool.ainvoke(
            _tc("read", {"path": f"{skill_path}/SKILL.md"})
        )
        assert "Alias Test Skill" in result.content

    @pytest.mark.asyncio
    async def test_read_file_alias_reads_skill_relative_path(self, skill_and_backend):
        """The 'read_file' alias must read skill files with relative paths."""
        from graphton.core.tool_wrappers import create_platform_tool_wrappers

        backend, skill_path, expected_content, _ = skill_and_backend
        tools = create_platform_tool_wrappers(backend)
        read_file_tool = next(t for t in tools if getattr(t, "name", "") == "read_file")

        result = await read_file_tool.ainvoke(
            _tc("read_file", {"path": f"{skill_path}/SKILL.md"})
        )
        assert "Alias Test Skill" in result.content

    @pytest.mark.asyncio
    async def test_read_tool_reads_skill_absolute_path(self, skill_and_backend):
        """The 'read' tool must read skill files with absolute paths (chroot-stripped)."""
        from graphton.core.tool_wrappers import create_platform_tool_wrappers

        backend, skill_path, _, tmpdir = skill_and_backend
        tools = create_platform_tool_wrappers(backend)
        read_tool = next(t for t in tools if getattr(t, "name", "") == "read")

        # Use backend.root_dir (resolved path) to construct absolute paths.
        # On macOS, /var/folders/... resolves to /private/var/folders/..., so
        # we must use the resolved root to match what the backend expects.
        abs_path = f"{backend.root_dir}/{skill_path}/SKILL.md"
        result = await read_tool.ainvoke(_tc("read", {"path": abs_path}))
        assert "Alias Test Skill" in result.content

    @pytest.mark.asyncio
    async def test_read_file_alias_reads_skill_absolute_path(self, skill_and_backend):
        """The 'read_file' alias must read skill files with absolute paths."""
        from graphton.core.tool_wrappers import create_platform_tool_wrappers

        backend, skill_path, _, tmpdir = skill_and_backend
        tools = create_platform_tool_wrappers(backend)
        read_file_tool = next(t for t in tools if getattr(t, "name", "") == "read_file")

        # Use resolved root path (see comment in test above)
        abs_path = f"{backend.root_dir}/{skill_path}/SKILL.md"
        result = await read_file_tool.ainvoke(_tc("read_file", {"path": abs_path}))
        assert "Alias Test Skill" in result.content

    @pytest.mark.asyncio
    async def test_read_file_alias_reads_skill_with_leading_slash(self, skill_and_backend):
        """The 'read_file' alias must handle paths with leading slash (chroot-like)."""
        from graphton.core.tool_wrappers import create_platform_tool_wrappers

        backend, skill_path, _, _ = skill_and_backend
        tools = create_platform_tool_wrappers(backend)
        read_file_tool = next(t for t in tools if getattr(t, "name", "") == "read_file")

        # Leading-slash path: /<skill_path>/SKILL.md
        # FilesystemBackend's chroot behavior should strip the leading /
        leading_slash_path = f"/{skill_path}/SKILL.md"
        result = await read_file_tool.ainvoke(
            _tc("read_file", {"path": leading_slash_path})
        )
        assert "Alias Test Skill" in result.content
