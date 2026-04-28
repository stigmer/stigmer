"""Integration tests for multi-workspace provisioning pipeline.

These tests exercise the *composed* pipeline: WorkspaceProvisioner ->
file-tree enrichment -> build_workspace_prompt_section(), using real
LocalWorkspaceBackend instances backed by temporary directories.

Unlike the unit tests (which mock backends, sources, and protos
independently), these tests verify that the modules work correctly
when wired together — catching composition bugs that unit tests miss.

Git sources still require a patched execute() since we cannot perform
real git clones in a test environment, but the backend itself, the
file-tree walker, and the prompt builder are all production code.
"""

from __future__ import annotations

import pytest

from stigmer_runner.worker.activities.execute_graphton import build_workspace_prompt_section
from stigmer_runner.worker.workspace.backend import ExecuteResult
from stigmer_runner.worker.workspace.local import LocalWorkspaceBackend
from stigmer_runner.worker.workspace.provisioner import WorkspaceProvisioner

# ---------------------------------------------------------------------------
# Proto mocks — minimal duck-typed stand-ins for WorkspaceEntry / Source
# ---------------------------------------------------------------------------


class _Source:
    """Duck-typed ``WorkspaceSource`` proto."""

    def __init__(
        self,
        *,
        git_repo: object | None = None,
        local_path: object | None = None,
    ) -> None:
        self.git_repo = git_repo
        self.local_path = local_path

    def HasField(self, name: str) -> bool:
        if name == "git_repo":
            return self.git_repo is not None
        if name == "local_path":
            return self.local_path is not None
        return False


class _GitRepo:
    def __init__(self, url: str) -> None:
        self.url = url
        self.branch = ""
        self.commit = ""
        self.depth = 0

    def HasField(self, name: str) -> bool:
        return False


class _LocalPath:
    def __init__(self, path: str) -> None:
        self.path = path


class _Entry:
    """Duck-typed ``WorkspaceEntry`` proto."""

    def __init__(self, name: str, source: _Source) -> None:
        self.name = name
        self.source = source


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _populate_dir(root, layout: dict[str, str | dict]) -> None:
    """Recursively create files and directories under *root*.

    *layout* maps relative names to either file content (str) or nested
    dicts (subdirectories).
    """
    for name, content in layout.items():
        child = root / name
        if isinstance(content, dict):
            child.mkdir(parents=True, exist_ok=True)
            _populate_dir(child, content)
        else:
            child.parent.mkdir(parents=True, exist_ok=True)
            child.write_text(content)


def _make_local_entry(name: str, path) -> _Entry:
    return _Entry(name, _Source(local_path=_LocalPath(str(path))))


def _make_git_entry(name: str, url: str) -> _Entry:
    return _Entry(name, _Source(git_repo=_GitRepo(url)))


def _patch_git_backend(backend: LocalWorkspaceBackend) -> LocalWorkspaceBackend:
    """Patch execute() to simulate successful git clone + metadata queries."""
    original = backend.execute

    def _patched(command, *, cwd=None, timeout=30):
        if "test -d .git" in command:
            return ExecuteResult(exit_code=0, stdout="no\n", stderr="")
        if command.startswith("ls -A"):
            return ExecuteResult(exit_code=0, stdout="", stderr="")
        if command.startswith("git clone"):
            return ExecuteResult(exit_code=0, stdout="", stderr="")
        if "rev-parse --abbrev-ref HEAD" in command:
            return ExecuteResult(exit_code=0, stdout="main\n", stderr="")
        if "rev-parse HEAD" in command:
            return ExecuteResult(
                exit_code=0, stdout="abc1234def5678\n", stderr="",
            )
        if command.startswith("git checkout"):
            return ExecuteResult(exit_code=0, stdout="", stderr="")
        return original(command, cwd=cwd, timeout=timeout)

    backend.execute = _patched  # type: ignore[assignment]
    return backend


# =============================================================================
# Multi-local integration: provision_all -> tree -> prompt
# =============================================================================


class TestMultiLocalIntegration:
    """Two local-path entries provisioned through the full pipeline."""

    @pytest.fixture()
    def workspace(self, tmp_path):
        front = tmp_path / "frontend"
        back = tmp_path / "backend"

        _populate_dir(front, {
            "src": {"App.tsx": "export default App;", "index.ts": "main()"},
            "package.json": '{"name": "frontend"}',
        })
        _populate_dir(back, {
            "cmd": {"main.go": "package main"},
            "go.mod": "module backend",
        })

        entries = [
            _make_local_entry("frontend", front),
            _make_local_entry("backend", back),
        ]
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        return entries, backend, front, back

    def test_both_entries_provisioned(self, workspace):
        entries, backend, front, back = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        assert len(results) == 2
        assert results[0].entry_name == "frontend"
        assert results[0].root_dir == str(front)
        assert results[1].entry_name == "backend"
        assert results[1].root_dir == str(back)

    def test_each_entry_has_file_tree(self, workspace):
        entries, backend, _, _ = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        for r in results:
            assert r.file_tree is not None, f"{r.entry_name} should have a tree"
            assert "### Project Structure" in r.file_tree

    def test_trees_are_scoped_to_entry(self, workspace):
        entries, backend, _, _ = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        front_tree = results[0].file_tree
        back_tree = results[1].file_tree

        assert "App.tsx" in front_tree
        assert "package.json" in front_tree
        assert "main.go" not in front_tree

        assert "main.go" in back_tree
        assert "go.mod" in back_tree
        assert "App.tsx" not in back_tree

    def test_prompt_section_includes_both_entries(self, workspace):
        entries, backend, front, back = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )
        section = build_workspace_prompt_section(results)

        assert "## Workspace" in section
        assert "### frontend" in section
        assert "### backend" in section
        assert str(front) in section
        assert str(back) in section

    def test_prompt_heading_hierarchy(self, workspace):
        entries, backend, _, _ = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )
        section = build_workspace_prompt_section(results)

        lines = section.split("\n")
        h2 = [line for line in lines if line.startswith("## ")]
        h3 = [line for line in lines if line.startswith("### ") and not line.startswith("#### ")]
        h4 = [line for line in lines if line.startswith("#### ")]

        assert any("Workspace" in h for h in h2)
        assert any("frontend" in h for h in h3)
        assert any("backend" in h for h in h3)
        assert all("Project Structure" in h for h in h4)

    def test_prompt_preamble_names_primary(self, workspace):
        entries, backend, front, _ = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )
        section = build_workspace_prompt_section(results)

        assert "2 workspace entries" in section
        assert "**frontend**" in section
        assert f"`{front}`" in section


# =============================================================================
# Single-local backward compatibility
# =============================================================================


class TestSingleLocalBackwardCompat:
    """A single local-path entry must produce the legacy format."""

    @pytest.fixture()
    def workspace(self, tmp_path):
        project = tmp_path / "my-project"
        _populate_dir(project, {
            "src": {"main.py": "print('hello')"},
            "README.md": "# My Project",
        })
        entry = _make_local_entry("my-project", project)
        backend = LocalWorkspaceBackend(root_dir=tmp_path / "unused")
        return [entry], backend

    def test_single_entry_legacy_format(self, workspace):
        entries, backend = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )
        section = build_workspace_prompt_section(results)

        assert section.startswith("\n\n## Workspace\n\n")
        assert "workspace entries" not in section.lower()
        assert "starting directory" not in section.lower()
        assert "### my-project" not in section

    def test_single_entry_has_tree(self, workspace):
        entries, backend = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        assert results[0].file_tree is not None
        assert "### Project Structure" in results[0].file_tree
        assert "main.py" in results[0].file_tree

    def test_single_entry_no_subdir(self, workspace):
        """Single entry must NOT receive target_subdir (clone into root)."""
        entries, backend = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        assert len(results) == 1
        assert results[0].entry_name == "my-project"


# =============================================================================
# Multi-git integration (mocked clone, real backend + tree + prompt)
# =============================================================================


class TestMultiGitIntegration:
    """Two git entries provisioned with mocked clone but real tree/prompt."""

    @pytest.fixture()
    def workspace(self, tmp_path):
        backend = _patch_git_backend(
            LocalWorkspaceBackend(root_dir=tmp_path),
        )
        entry_a = _make_git_entry("svc-api", "https://github.com/org/svc-api.git")
        entry_b = _make_git_entry("svc-web", "https://github.com/org/svc-web.git")

        (tmp_path / "svc-api").mkdir()
        _populate_dir(tmp_path / "svc-api", {
            "cmd": {"server.go": "package main"},
            "go.mod": "module svc-api",
        })
        (tmp_path / "svc-web").mkdir()
        _populate_dir(tmp_path / "svc-web", {
            "src": {"App.vue": "<template></template>"},
            "package.json": '{"name": "svc-web"}',
        })

        return [entry_a, entry_b], backend, tmp_path

    def test_both_cloned_into_subdirs(self, workspace):
        entries, backend, root = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        assert len(results) == 2
        assert results[0].root_dir == str(root / "svc-api")
        assert results[1].root_dir == str(root / "svc-web")

    def test_git_metadata_per_entry(self, workspace):
        entries, backend, _ = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        assert results[0].git_metadata is not None
        assert results[0].git_metadata.repo_url == "https://github.com/org/svc-api.git"
        assert results[1].git_metadata is not None
        assert results[1].git_metadata.repo_url == "https://github.com/org/svc-web.git"

    def test_trees_scoped_per_entry(self, workspace):
        entries, backend, _ = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        api_tree = results[0].file_tree
        web_tree = results[1].file_tree

        assert api_tree is not None
        assert "server.go" in api_tree
        assert "App.vue" not in api_tree

        assert web_tree is not None
        assert "App.vue" in web_tree
        assert "server.go" not in web_tree

    def test_prompt_section_multi_git(self, workspace):
        entries, backend, root = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )
        section = build_workspace_prompt_section(results)

        assert "## Workspace" in section
        assert "### svc-api" in section
        assert "### svc-web" in section
        assert "2 workspace entries" in section
        assert "#### Project Structure" in section


# =============================================================================
# Single-git backward compatibility
# =============================================================================


class TestSingleGitBackwardCompat:
    """A single git entry must clone into root and produce legacy format."""

    @pytest.fixture()
    def workspace(self, tmp_path):
        backend = _patch_git_backend(
            LocalWorkspaceBackend(root_dir=tmp_path),
        )
        _populate_dir(tmp_path, {
            "src": {"main.py": "import flask"},
            "requirements.txt": "flask==3.0",
        })
        entry = _make_git_entry("my-app", "https://github.com/org/my-app.git")
        return [entry], backend, tmp_path

    def test_cloned_into_root(self, workspace):
        entries, backend, root = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        assert len(results) == 1
        assert results[0].root_dir == str(root)

    def test_legacy_prompt_format(self, workspace):
        entries, backend, _ = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )
        section = build_workspace_prompt_section(results)

        assert section.startswith("\n\n## Workspace\n\n")
        assert "workspace entries" not in section.lower()
        assert "### my-app" not in section

    def test_tree_includes_files(self, workspace):
        entries, backend, _ = workspace
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        assert results[0].file_tree is not None
        assert "main.py" in results[0].file_tree
        assert "requirements.txt" in results[0].file_tree


# =============================================================================
# Guard-rail: backend replacement — Decision D2
# =============================================================================


class TestBackendReplacementGuardRail:
    """Document Decision D2: multi-entry keeps workspace root backend.

    When ``len(provision_results) > 1``, the workspace backend is NOT
    replaced even if the primary entry's ``root_dir`` differs from the
    backend's ``root_dir``.  This ensures all entry subdirectories
    remain reachable from a single backend.

    For single entries, the backend IS replaced when root_dir diverges
    (backward compatibility).

    The replacement logic lives in ``execute_graphton.py``, not the
    provisioner.  These tests verify the provisioner's output is
    structured correctly for the caller to make the right decision.
    """

    def test_multi_entry_roots_differ_from_backend(self, tmp_path):
        """Multi-entry: each root differs from backend root — caller must
        NOT replace the backend."""
        front = tmp_path / "frontend"
        back = tmp_path / "backend"
        front.mkdir()
        back.mkdir()
        (front / "index.ts").write_text("main()")
        (back / "main.go").write_text("package main")

        entries = [
            _make_local_entry("frontend", front),
            _make_local_entry("backend", back),
        ]
        ws_root = tmp_path / "workspace-root"
        backend = LocalWorkspaceBackend(root_dir=ws_root)
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        assert len(results) == 2
        assert results[0].root_dir != backend.root_dir
        assert results[1].root_dir != backend.root_dir

    def test_single_entry_root_differs_from_backend(self, tmp_path):
        """Single entry: root differs from backend root — caller SHOULD
        replace the backend (backward compat)."""
        project = tmp_path / "project"
        project.mkdir()
        (project / "main.py").write_text("hello")

        entries = [_make_local_entry("project", project)]
        ws_root = tmp_path / "workspace-root"
        backend = LocalWorkspaceBackend(root_dir=ws_root)
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            entries, backend, {}, is_local_mode=True,
        )

        assert len(results) == 1
        assert results[0].root_dir == str(project)
        assert results[0].root_dir != backend.root_dir

    def test_single_git_root_equals_backend(self, tmp_path):
        """Single git entry: root_dir == backend.root_dir — no replacement
        needed."""
        _populate_dir(tmp_path, {"src": {"app.py": "run()"}})
        entry = _make_git_entry("app", "https://github.com/org/app.git")
        backend = _patch_git_backend(LocalWorkspaceBackend(root_dir=tmp_path))
        provisioner = WorkspaceProvisioner()

        results = provisioner.provision_all(
            [entry], backend, {}, is_local_mode=True,
        )

        assert results[0].root_dir == backend.root_dir


# =============================================================================
# Guard-rail: referenced files uses primary root (MVP limitation)
# =============================================================================


class TestReferencedFilesPrimaryRootGuardRail:
    """Document MVP limitation: referenced-file resolution uses a single root.

    ``build_referenced_files_prompt_section(refs, workspace_root)`` takes
    a single ``workspace_root``.  For multi-entry sessions, the caller
    passes ``provision_results[0].root_dir`` (the primary entry).  Files
    from other entries are not resolvable — they appear without metadata.

    This is intentional for MVP.  Multi-root file referencing is deferred.
    """

    def test_refs_resolved_against_primary_root(self, tmp_path):
        from stigmer_runner.worker.activities.execute_graphton import (
            build_referenced_files_prompt_section,
        )

        primary = tmp_path / "frontend"
        secondary = tmp_path / "backend"
        primary.mkdir()
        secondary.mkdir()
        (primary / "src" / "App.tsx").parent.mkdir(parents=True)
        (primary / "src" / "App.tsx").write_text("export default App;")
        (secondary / "cmd" / "main.go").parent.mkdir(parents=True)
        (secondary / "cmd" / "main.go").write_text("package main")

        section = build_referenced_files_prompt_section(
            ["src/App.tsx", "cmd/main.go"],
            str(primary),
        )

        assert "`src/App.tsx`" in section
        assert "bytes" in section.split("src/App.tsx")[1].split("\n")[0]

        assert "`cmd/main.go`" in section
        go_line = [line for line in section.split("\n") if "cmd/main.go" in line][0]
        assert "bytes" not in go_line

    def test_all_refs_listed_even_when_unresolvable(self, tmp_path):
        from stigmer_runner.worker.activities.execute_graphton import (
            build_referenced_files_prompt_section,
        )

        primary = tmp_path / "frontend"
        primary.mkdir()

        section = build_referenced_files_prompt_section(
            ["README.md", "backend/main.go", "docs/guide.md"],
            str(primary),
        )

        assert "`README.md`" in section
        assert "`backend/main.go`" in section
        assert "`docs/guide.md`" in section
