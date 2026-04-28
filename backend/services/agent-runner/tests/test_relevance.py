"""Unit tests for task-aware relevance signaling (Phase A).

Tests cover:
- extract_file_path_candidates: token-based file path extraction
- resolve_workspace_paths: filesystem existence checks (single + multi root)
- build_relevance_prompt_section: end-to-end orchestration + formatting
"""

from __future__ import annotations

from pathlib import Path

import pytest

from stigmer_runner.worker.activities.relevance import (
    _MAX_RESULTS,
    ResolvedPath,
    WorkspaceRoot,
    build_relevance_prompt_section,
    extract_file_path_candidates,
    resolve_workspace_paths,
)


def _single_root(path: Path | str) -> list[WorkspaceRoot]:
    """Wrap a path as a single unnamed workspace root (backward-compat helper)."""
    return [WorkspaceRoot(name="", root_dir=str(path))]

# =============================================================================
# extract_file_path_candidates
# =============================================================================


class TestExtractFilePathCandidates:
    """Tests for the pure text-extraction step."""

    # -- Positive cases: paths with slashes ----------------------------------

    def test_simple_slash_path(self):
        result = extract_file_path_candidates("Fix the bug in src/auth/login.go")
        assert "src/auth/login.go" in result

    def test_multiple_slash_paths(self):
        msg = "Compare src/api/v1/handler.go with src/api/v2/handler.go"
        result = extract_file_path_candidates(msg)
        assert "src/api/v1/handler.go" in result
        assert "src/api/v2/handler.go" in result

    def test_path_with_leading_dot_slash(self):
        result = extract_file_path_candidates("Read ./src/main.py first")
        assert "./src/main.py" in result

    def test_directory_path_with_trailing_slash(self):
        result = extract_file_path_candidates("Check the backend/api/ directory")
        assert "backend/api/" in result

    # -- Positive cases: file extensions -------------------------------------

    def test_filename_with_python_extension(self):
        result = extract_file_path_candidates("Update requirements.txt and config.yaml")
        assert "requirements.txt" in result
        assert "config.yaml" in result

    def test_filename_with_go_extension(self):
        result = extract_file_path_candidates("See main.go for details")
        assert "main.go" in result

    def test_filename_with_typescript_extension(self):
        result = extract_file_path_candidates("The component is in App.tsx")
        assert "App.tsx" in result

    def test_filename_with_proto_extension(self):
        result = extract_file_path_candidates("Update the schema in api.proto")
        assert "api.proto" in result

    # -- Positive cases: known filenames -------------------------------------

    def test_dockerfile(self):
        result = extract_file_path_candidates("Check the Dockerfile")
        assert "Dockerfile" in result

    def test_makefile(self):
        result = extract_file_path_candidates("Run targets from Makefile")
        assert "Makefile" in result

    # -- Backticks and quotes ------------------------------------------------

    def test_backtick_wrapped_path(self):
        result = extract_file_path_candidates("Edit `src/auth/login.go` please")
        assert "src/auth/login.go" in result

    def test_double_quoted_path(self):
        result = extract_file_path_candidates('Open "config.yaml" next')
        assert "config.yaml" in result

    def test_single_quoted_path(self):
        result = extract_file_path_candidates("Read 'src/utils.py' first")
        assert "src/utils.py" in result

    def test_parenthesized_path(self):
        result = extract_file_path_candidates("(see backend/api/handler.go)")
        assert "backend/api/handler.go" in result

    # -- Trailing sentence punctuation ---------------------------------------

    def test_path_followed_by_period(self):
        result = extract_file_path_candidates("The issue is in src/auth.")
        assert "src/auth" in result

    def test_extension_file_followed_by_period(self):
        """A file like main.go followed by a sentence period should still resolve."""
        result = extract_file_path_candidates("Check main.go.")
        assert "main.go" in result

    # -- Exclusions ----------------------------------------------------------

    def test_url_excluded(self):
        result = extract_file_path_candidates(
            "See https://github.com/acme/repo/blob/main/src/auth.go"
        )
        assert not any("github.com" in c for c in result)

    def test_http_url_excluded(self):
        result = extract_file_path_candidates(
            "Visit http://localhost:3000/api/health"
        )
        assert not any("localhost" in c for c in result)

    def test_email_excluded(self):
        result = extract_file_path_candidates("Contact admin@example.com for help")
        assert not any("example.com" in c for c in result)

    def test_at_prefixed_token_excluded(self):
        result = extract_file_path_candidates("Ask @john about config.yaml")
        assert "config.yaml" in result
        assert not any(c.startswith("@") for c in result)

    # -- Deduplication -------------------------------------------------------

    def test_duplicate_paths_deduplicated(self):
        msg = "Read src/main.py then re-read src/main.py"
        result = extract_file_path_candidates(msg)
        assert result.count("src/main.py") == 1

    def test_preserves_first_seen_order(self):
        msg = "Check config.yaml then src/main.py then README.md"
        result = extract_file_path_candidates(msg)
        assert result.index("config.yaml") < result.index("src/main.py")
        assert result.index("src/main.py") < result.index("README.md")

    # -- Edge cases ----------------------------------------------------------

    def test_empty_message_returns_empty(self):
        assert extract_file_path_candidates("") == []

    def test_whitespace_only_returns_empty(self):
        assert extract_file_path_candidates("   \n\t  ") == []

    def test_no_paths_in_message(self):
        result = extract_file_path_candidates(
            "Please refactor the authentication module to use JWT tokens"
        )
        assert result == []

    def test_plain_word_not_extracted(self):
        """Words without slashes or known extensions should not match."""
        result = extract_file_path_candidates("Fix the UserService class")
        assert result == []


# =============================================================================
# resolve_workspace_paths
# =============================================================================


class TestResolveWorkspacePaths:
    """Tests for filesystem resolution against a real tmp_path workspace."""

    @pytest.fixture()
    def workspace(self, tmp_path: Path) -> Path:
        """Create a small workspace layout for testing."""
        (tmp_path / "src" / "auth").mkdir(parents=True)
        (tmp_path / "src" / "auth" / "login.go").write_text("package auth\n")
        (tmp_path / "README.md").write_text("# Project\n")
        (tmp_path / "config.yaml").write_text("key: value\n")
        (tmp_path / "empty_dir").mkdir()
        return tmp_path

    def test_existing_file_resolved(self, workspace: Path):
        result = resolve_workspace_paths(["README.md"], _single_root(workspace))
        assert len(result) == 1
        assert result[0].path == "README.md"
        assert result[0].is_directory is False
        assert result[0].size_bytes is not None
        assert result[0].size_bytes > 0

    def test_existing_directory_resolved(self, workspace: Path):
        result = resolve_workspace_paths(["src/auth"], _single_root(workspace))
        assert len(result) == 1
        assert result[0].path == "src/auth/"
        assert result[0].is_directory is True
        assert result[0].size_bytes is None

    def test_directory_with_trailing_slash(self, workspace: Path):
        result = resolve_workspace_paths(["src/auth/"], _single_root(workspace))
        assert len(result) == 1
        assert result[0].path == "src/auth/"
        assert result[0].is_directory is True

    def test_nonexistent_path_dropped(self, workspace: Path):
        result = resolve_workspace_paths(["does/not/exist.py"], _single_root(workspace))
        assert result == []

    def test_mixed_valid_and_invalid(self, workspace: Path):
        candidates = ["README.md", "nope.go", "src/auth/login.go", "ghost.py"]
        result = resolve_workspace_paths(candidates, _single_root(workspace))
        paths = [r.path for r in result]
        assert "README.md" in paths
        assert "src/auth/login.go" in paths
        assert len(result) == 2

    def test_empty_candidates_returns_empty(self, workspace: Path):
        assert resolve_workspace_paths([], _single_root(workspace)) == []

    def test_nested_file_with_size(self, workspace: Path):
        result = resolve_workspace_paths(["src/auth/login.go"], _single_root(workspace))
        assert len(result) == 1
        assert result[0].size_bytes == len("package auth\n")

    def test_empty_directory_resolved(self, workspace: Path):
        result = resolve_workspace_paths(["empty_dir"], _single_root(workspace))
        assert len(result) == 1
        assert result[0].is_directory is True

    def test_single_root_stamps_empty_entry_name(self, workspace: Path):
        result = resolve_workspace_paths(["README.md"], _single_root(workspace))
        assert result[0].entry_name == ""


# =============================================================================
# ResolvedPath value object
# =============================================================================


class TestResolvedPath:
    """Tests for the frozen dataclass."""

    def test_frozen(self):
        rp = ResolvedPath(path="a.py", is_directory=False, size_bytes=100)
        with pytest.raises(AttributeError):
            rp.path = "b.py"  # type: ignore[misc]

    def test_equality(self):
        a = ResolvedPath(path="a.py", is_directory=False, size_bytes=100)
        b = ResolvedPath(path="a.py", is_directory=False, size_bytes=100)
        assert a == b

    def test_directory_defaults_no_size(self):
        rp = ResolvedPath(path="src/", is_directory=True)
        assert rp.size_bytes is None


# =============================================================================
# build_relevance_prompt_section (end-to-end)
# =============================================================================


class TestBuildRelevancePromptSection:
    """Integration tests for the public API."""

    @pytest.fixture()
    def workspace(self, tmp_path: Path) -> Path:
        (tmp_path / "src" / "auth").mkdir(parents=True)
        (tmp_path / "src" / "auth" / "login.go").write_text("package auth\n")
        (tmp_path / "README.md").write_text("# Hello\n")
        (tmp_path / "config.yaml").write_text("key: val\n")
        return tmp_path

    def test_returns_empty_when_no_paths_in_message(self, workspace: Path):
        result = build_relevance_prompt_section(
            "Refactor the auth module", _single_root(workspace),
        )
        assert result == ""

    def test_returns_empty_when_no_paths_resolve(self, workspace: Path):
        result = build_relevance_prompt_section(
            "Fix ghost.rb and phantom.rs", _single_root(workspace),
        )
        assert result == ""

    def test_section_header(self, workspace: Path):
        result = build_relevance_prompt_section(
            "Update README.md", _single_root(workspace),
        )
        assert "## Potentially Relevant Files" in result

    def test_section_starts_with_double_newline(self, workspace: Path):
        result = build_relevance_prompt_section(
            "Update README.md", _single_root(workspace),
        )
        assert result.startswith("\n\n")

    def test_resolved_file_in_output(self, workspace: Path):
        result = build_relevance_prompt_section(
            "Check src/auth/login.go for the bug", _single_root(workspace),
        )
        assert "`src/auth/login.go`" in result

    def test_resolved_directory_in_output(self, workspace: Path):
        result = build_relevance_prompt_section(
            "Look in src/auth/ for the handlers", _single_root(workspace),
        )
        assert "`src/auth/`" in result
        assert "(directory)" in result

    def test_file_size_displayed(self, workspace: Path):
        result = build_relevance_prompt_section(
            "Read config.yaml", _single_root(workspace),
        )
        assert "bytes" in result or "KB" in result

    def test_multiple_files_resolved(self, workspace: Path):
        result = build_relevance_prompt_section(
            "Compare README.md with config.yaml", _single_root(workspace),
        )
        assert "`README.md`" in result
        assert "`config.yaml`" in result

    def test_cap_enforced(self, tmp_path: Path):
        for i in range(_MAX_RESULTS + 5):
            (tmp_path / f"file_{i:03d}.py").write_text(f"# file {i}\n")

        message = " ".join(f"file_{i:03d}.py" for i in range(_MAX_RESULTS + 5))
        result = build_relevance_prompt_section(message, _single_root(tmp_path))

        listed_count = result.count("- `file_")
        assert listed_count == _MAX_RESULTS
        assert "omitted" in result

    def test_no_omission_notice_when_under_cap(self, workspace: Path):
        result = build_relevance_prompt_section(
            "Check README.md", _single_root(workspace),
        )
        assert "omitted" not in result

    def test_empty_message_returns_empty(self, workspace: Path):
        assert build_relevance_prompt_section("", _single_root(workspace)) == ""

    def test_whitespace_message_returns_empty(self, workspace: Path):
        assert build_relevance_prompt_section("  \n  ", _single_root(workspace)) == ""


# =============================================================================
# Multi-root resolution
# =============================================================================


class TestMultiRootResolution:
    """Tests for resolve_workspace_paths and build_relevance_prompt_section
    with multiple workspace entry roots."""

    @pytest.fixture()
    def entry_a(self, tmp_path: Path) -> Path:
        root = tmp_path / "entry-a"
        (root / "src" / "api").mkdir(parents=True)
        (root / "src" / "api" / "handler.go").write_text("package api\n")
        (root / "README.md").write_text("# Entry A\n")
        return root

    @pytest.fixture()
    def entry_b(self, tmp_path: Path) -> Path:
        root = tmp_path / "entry-b"
        (root / "src" / "web").mkdir(parents=True)
        (root / "src" / "web" / "app.tsx").write_text("export default App;\n")
        (root / "README.md").write_text("# Entry B\n")
        (root / "config.yaml").write_text("port: 3000\n")
        return root

    @pytest.fixture()
    def roots(self, entry_a: Path, entry_b: Path) -> list[WorkspaceRoot]:
        return [
            WorkspaceRoot(name="svc-api", root_dir=str(entry_a)),
            WorkspaceRoot(name="svc-web", root_dir=str(entry_b)),
        ]

    # -- resolve_workspace_paths -----------------------------------------------

    def test_candidate_found_in_second_root(self, roots: list[WorkspaceRoot]):
        result = resolve_workspace_paths(["config.yaml"], roots)
        assert len(result) == 1
        assert result[0].path == "config.yaml"
        assert result[0].entry_name == "svc-web"

    def test_first_match_wins(self, roots: list[WorkspaceRoot]):
        """README.md exists in both entries; the first root should win."""
        result = resolve_workspace_paths(["README.md"], roots)
        assert len(result) == 1
        assert result[0].entry_name == "svc-api"

    def test_entry_name_stamped(self, roots: list[WorkspaceRoot]):
        result = resolve_workspace_paths(["src/web/app.tsx"], roots)
        assert len(result) == 1
        assert result[0].entry_name == "svc-web"

    def test_candidates_from_different_entries(self, roots: list[WorkspaceRoot]):
        candidates = ["src/api/handler.go", "src/web/app.tsx", "config.yaml"]
        result = resolve_workspace_paths(candidates, roots)
        paths = [(r.path, r.entry_name) for r in result]
        assert ("src/api/handler.go", "svc-api") in paths
        assert ("src/web/app.tsx", "svc-web") in paths
        assert ("config.yaml", "svc-web") in paths

    def test_nonexistent_in_all_roots_dropped(self, roots: list[WorkspaceRoot]):
        result = resolve_workspace_paths(["ghost.py"], roots)
        assert result == []

    def test_empty_roots_returns_empty(self):
        result = resolve_workspace_paths(["README.md"], [])
        assert result == []

    def test_directory_resolved_from_second_root(self, roots: list[WorkspaceRoot]):
        result = resolve_workspace_paths(["src/web"], roots)
        assert len(result) == 1
        assert result[0].path == "src/web/"
        assert result[0].is_directory is True
        assert result[0].entry_name == "svc-web"

    # -- build_relevance_prompt_section ----------------------------------------

    def test_multi_root_prompt_contains_entry_annotation(
        self, roots: list[WorkspaceRoot],
    ):
        result = build_relevance_prompt_section(
            "Check src/web/app.tsx", roots,
        )
        assert "in **svc-web**" in result

    def test_single_root_prompt_has_no_annotation(self, entry_a: Path):
        result = build_relevance_prompt_section(
            "Check README.md", _single_root(entry_a),
        )
        assert "in **" not in result

    def test_multi_root_prompt_mixed_entries(self, roots: list[WorkspaceRoot]):
        result = build_relevance_prompt_section(
            "Compare src/api/handler.go with config.yaml", roots,
        )
        assert "in **svc-api**" in result
        assert "in **svc-web**" in result
