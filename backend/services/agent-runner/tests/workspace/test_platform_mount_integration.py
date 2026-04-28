"""Integration tests for the virtual platform mount (AD-01 v3).

These tests verify the full stack for local mode: workspace initialization
creates a platform_dir, skills and attachments are routed there, the agent
runtime sees the correct paths, and the workspace directory remains clean.
"""

from __future__ import annotations

import stat

import pytest
from graphton.core.backends.filesystem import FilesystemBackend
from graphton.core.sandbox_factory import create_sandbox_backend

from stigmer_runner.worker.workspace.local import LocalWorkspaceBackend
from stigmer_runner.worker.workspace.platform_mount import (
    PLATFORM_DIR_NAME,
    PLATFORM_PREFIX,
    STIGMER_PLATFORM_DIR_ENV,
    classify_platform_path,
)

# =============================================================================
# classify_platform_path — unit-level exhaustive coverage
# =============================================================================


class TestClassifyPlatformPath:
    """Pure function: classification of .stigmer/* paths."""

    @pytest.mark.parametrize(
        ("path", "expected"),
        [
            (".stigmer/skills/a/SKILL.md", (True, "skills/a/SKILL.md")),
            ("/.stigmer/inputs/data.pdf", (True, "inputs/data.pdf")),
            (".stigmer", (True, "")),
            ("src/main.py", (False, "src/main.py")),
            ("/bin/tools", (False, "bin/tools")),
            ("", (False, "")),
            (".", (False, ".")),
            (".stigmer/", (True, "")),
            (".stigmerx/stuff", (False, ".stigmerx/stuff")),
            ("a/.stigmer/b", (False, "a/.stigmer/b")),
        ],
    )
    def test_classification(self, path, expected):
        assert classify_platform_path(path) == expected

    def test_constants(self):
        assert PLATFORM_PREFIX == ".stigmer/"
        assert PLATFORM_DIR_NAME == ".stigmer"
        assert STIGMER_PLATFORM_DIR_ENV == "STIGMER_PLATFORM_DIR"


# =============================================================================
# Full stack: skill write → agent read → workspace clean
# =============================================================================


class TestSkillWriteAgentReadIntegration:
    """Skills written via agent-runner, read via agent-runtime."""

    @pytest.fixture()
    def stack(self, tmp_path):
        """Create both layers sharing the same physical directories."""
        ws = tmp_path / "workspace"
        pdir = tmp_path / "platform"

        runner_backend = LocalWorkspaceBackend(root_dir=ws, platform_dir=pdir)
        agent_backend = FilesystemBackend(root_dir=ws, platform_dir=pdir)

        return runner_backend, agent_backend, ws, pdir

    def test_skill_roundtrip(self, stack):
        runner, agent, ws, pdir = stack

        runner.write_file(
            ".stigmer/skills/my-skill/SKILL.md",
            b"# My Skill\nDoes things.",
        )

        content = agent.read_file(".stigmer/skills/my-skill/SKILL.md")
        assert "My Skill" in content
        assert (pdir / "skills" / "my-skill" / "SKILL.md").exists()
        assert not (ws / ".stigmer").exists()

    def test_attachment_roundtrip(self, stack):
        runner, agent, ws, pdir = stack

        runner.write_file(
            ".stigmer/inputs/requirements.txt",
            b"flask==3.0\nrequests>=2.31\n",
        )

        content = agent.read_file(".stigmer/inputs/requirements.txt")
        assert "flask" in content
        assert not (ws / ".stigmer").exists()

    def test_list_files_root_includes_stigmer(self, stack):
        runner, agent, ws, pdir = stack

        (ws / "src").mkdir(parents=True)
        runner.write_file(".stigmer/skills/a/SKILL.md", b"x")

        entries = agent.list_files(".")
        assert ".stigmer" in entries
        assert "src" in entries

    def test_list_files_stigmer_subdir(self, stack):
        runner, agent, ws, pdir = stack

        runner.write_file(".stigmer/skills/a/SKILL.md", b"x")
        runner.write_file(".stigmer/skills/b/SKILL.md", b"y")

        entries = agent.list_files(".stigmer/skills")
        assert "a" in entries
        assert "b" in entries

    def test_execute_env_var(self, stack):
        _, agent, _, pdir = stack

        result = agent.execute("echo $STIGMER_PLATFORM_DIR")
        assert result.exit_code == 0
        assert result.stdout.strip() == str(pdir)


# =============================================================================
# Zero-pollution guarantee
# =============================================================================


class TestZeroPollution:
    """The workspace directory must have ZERO platform-related modifications."""

    def test_local_path_workspace_untouched(self, tmp_path):
        ws = tmp_path / "workspace"
        pdir = tmp_path / "platform"

        backend = LocalWorkspaceBackend(root_dir=ws, platform_dir=pdir)

        backend.write_file(".stigmer/skills/s/SKILL.md", b"skill content")
        backend.write_file(".stigmer/inputs/data.csv", b"a,b,c")
        backend.mkdir(".stigmer/skills/s/scripts")

        ws_contents = list(ws.iterdir())
        ws_names = {p.name for p in ws_contents}

        assert ".stigmer" not in ws_names
        assert ".stigmer-inputs" not in ws_names
        assert "bin" not in ws_names

    def test_regular_files_still_work(self, tmp_path):
        ws = tmp_path / "workspace"
        pdir = tmp_path / "platform"

        backend = LocalWorkspaceBackend(root_dir=ws, platform_dir=pdir)
        backend.write_file("src/main.py", b"print('hi')")

        assert (ws / "src" / "main.py").read_bytes() == b"print('hi')"
        assert not (pdir / "src").exists()


# =============================================================================
# Sandbox factory wiring
# =============================================================================


class TestSandboxFactoryPlatformDir:
    """create_sandbox_backend passes platform_dir to FilesystemBackend."""

    def test_platform_dir_wired(self, tmp_path):
        ws = tmp_path / "ws"
        pdir = tmp_path / "platform"

        backend = create_sandbox_backend({
            "type": "filesystem",
            "root_dir": str(ws),
            "platform_dir": str(pdir),
        })

        assert isinstance(backend, FilesystemBackend)
        assert backend._platform_root is not None
        assert str(backend._platform_root) == str(pdir.resolve())

    def test_no_platform_dir_is_none(self, tmp_path):
        backend = create_sandbox_backend({
            "type": "filesystem",
            "root_dir": str(tmp_path),
        })
        assert isinstance(backend, FilesystemBackend)
        assert backend._platform_root is None


# =============================================================================
# Traversal guards — both scopes
# =============================================================================


class TestTraversalGuardsBothScopes:
    """Traversal attempts from either scope are blocked."""

    @pytest.fixture()
    def backend(self, tmp_path):
        return LocalWorkspaceBackend(
            root_dir=tmp_path / "ws",
            platform_dir=tmp_path / "platform",
        )

    def test_escape_workspace_via_dotdot(self, backend):
        with pytest.raises(ValueError, match="outside workspace"):
            backend.read_file("../../etc/passwd")

    def test_escape_platform_via_dotdot(self, backend):
        with pytest.raises(ValueError, match="outside platform"):
            backend.read_file(".stigmer/../../etc/passwd")

    def test_symlink_within_workspace_cannot_reach_platform(self, tmp_path):
        ws = tmp_path / "ws"
        pdir = tmp_path / "platform"

        backend = LocalWorkspaceBackend(root_dir=ws, platform_dir=pdir)
        backend.write_file(".stigmer/secrets/token.txt", b"secret-value")

        # A symlink in the workspace pointing to platform_dir would be
        # caught because resolve() follows symlinks and the containment
        # check would see it's outside root_dir.
        (ws / "sneaky").symlink_to(pdir)
        with pytest.raises(ValueError, match="outside workspace"):
            backend.read_file("sneaky/secrets/token.txt")


# =============================================================================
# Backward compatibility
# =============================================================================


class TestBackwardCompatNoVirtualMount:
    """When platform_dir is not set, all behavior is unchanged."""

    def test_stigmer_path_goes_to_workspace(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        backend.write_file(".stigmer/skills/a/SKILL.md", b"data")
        assert (tmp_path / ".stigmer" / "skills" / "a" / "SKILL.md").exists()

    def test_no_env_var_injected(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        result = backend.execute("echo ${STIGMER_PLATFORM_DIR:-UNSET}")
        assert result.stdout.strip() == "UNSET"

    def test_platform_dir_property_is_none(self, tmp_path):
        backend = LocalWorkspaceBackend(root_dir=tmp_path)
        assert backend.platform_dir is None


# =============================================================================
# Agent-runtime FilesystemBackend integration
# =============================================================================


class TestFilesystemBackendIntegration:
    """FilesystemBackend (graphton) with virtual mount — agent perspective."""

    @pytest.fixture()
    def agent(self, tmp_path):
        ws = tmp_path / "workspace"
        pdir = tmp_path / "platform"

        (pdir / "skills" / "code-review").mkdir(parents=True)
        (pdir / "skills" / "code-review" / "SKILL.md").write_text("# Code Review")
        (pdir / "skills" / "code-review" / "scripts").mkdir()
        script = pdir / "skills" / "code-review" / "scripts" / "lint.sh"
        script.write_text("#!/bin/bash\necho 'linting'")
        script.chmod(script.stat().st_mode | stat.S_IXUSR)

        return FilesystemBackend(root_dir=ws, platform_dir=pdir)

    def test_read_skill_md(self, agent):
        content = agent.read_file(".stigmer/skills/code-review/SKILL.md")
        assert "Code Review" in content

    def test_list_skills(self, agent):
        entries = agent.list_files(".stigmer/skills")
        assert "code-review" in entries

    def test_execute_skill_script(self, agent):
        result = agent.execute(
            "bash $STIGMER_PLATFORM_DIR/skills/code-review/scripts/lint.sh",
        )
        assert result.exit_code == 0
        assert "linting" in result.stdout

    def test_write_regular_file(self, agent, tmp_path):
        agent.write_file("output/report.md", "# Report")
        ws = tmp_path / "workspace"
        assert (ws / "output" / "report.md").read_text() == "# Report"
