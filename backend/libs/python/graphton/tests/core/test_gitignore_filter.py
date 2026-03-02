"""Unit tests for GitIgnoreFilter value object.

Covers:
- from_file: existing, missing, empty, unreadable files
- from_content: various patterns, empty input
- is_ignored: file patterns, directory-only patterns, negation,
  path-prefix patterns, is_dir=True/False/None semantics
"""

from __future__ import annotations

from pathlib import Path

import pytest

from graphton.core.backends.gitignore_filter import GitIgnoreFilter


# =============================================================================
# from_content
# =============================================================================


class TestFromContent:
    """GitIgnoreFilter.from_content() parsing."""

    def test_returns_filter_for_valid_patterns(self) -> None:
        f = GitIgnoreFilter.from_content("*.pyc\nvenv/\n")
        assert f is not None

    def test_returns_none_for_empty_string(self) -> None:
        assert GitIgnoreFilter.from_content("") is None

    def test_returns_none_for_comments_only(self) -> None:
        assert GitIgnoreFilter.from_content("# comment\n# another\n") is None

    def test_returns_none_for_blank_lines_only(self) -> None:
        assert GitIgnoreFilter.from_content("\n\n  \n") is None

    def test_strips_comments_and_blanks(self) -> None:
        f = GitIgnoreFilter.from_content("# header\n\n*.log\n# footer\n")
        assert f is not None
        assert f.is_ignored("debug.log") is True
        assert f.is_ignored("main.py") is False


# =============================================================================
# from_file
# =============================================================================


class TestFromFile:
    """GitIgnoreFilter.from_file() filesystem integration."""

    def test_parses_existing_file(self, tmp_path: Path) -> None:
        gi = tmp_path / ".gitignore"
        gi.write_text("*.pyc\n__pycache__/\n")
        f = GitIgnoreFilter.from_file(gi)
        assert f is not None
        assert f.is_ignored("module.pyc") is True

    def test_returns_none_for_missing_file(self, tmp_path: Path) -> None:
        assert GitIgnoreFilter.from_file(tmp_path / ".gitignore") is None

    def test_returns_none_for_empty_file(self, tmp_path: Path) -> None:
        gi = tmp_path / ".gitignore"
        gi.write_text("")
        assert GitIgnoreFilter.from_file(gi) is None

    def test_returns_none_for_directory(self, tmp_path: Path) -> None:
        d = tmp_path / ".gitignore"
        d.mkdir()
        assert GitIgnoreFilter.from_file(d) is None


# =============================================================================
# is_ignored — basic patterns
# =============================================================================


class TestIsIgnoredBasic:
    """Fundamental pattern matching."""

    @pytest.fixture
    def f(self) -> GitIgnoreFilter:
        content = "\n".join([
            "*.pyc",
            "*.log",
            "__pycache__/",
            "dist",
            "eggs-info/",
        ])
        result = GitIgnoreFilter.from_content(content)
        assert result is not None
        return result

    def test_wildcard_file_match(self, f: GitIgnoreFilter) -> None:
        assert f.is_ignored("module.pyc", is_dir=False) is True
        assert f.is_ignored("src/deep/module.pyc", is_dir=False) is True

    def test_wildcard_file_no_match(self, f: GitIgnoreFilter) -> None:
        assert f.is_ignored("module.py", is_dir=False) is False

    def test_bare_name_matches_file_and_dir(self, f: GitIgnoreFilter) -> None:
        assert f.is_ignored("dist", is_dir=False) is True
        assert f.is_ignored("dist", is_dir=True) is True

    def test_dir_only_pattern_matches_dir(self, f: GitIgnoreFilter) -> None:
        assert f.is_ignored("__pycache__", is_dir=True) is True
        assert f.is_ignored("eggs-info", is_dir=True) is True

    def test_dir_only_pattern_does_not_match_file(self, f: GitIgnoreFilter) -> None:
        assert f.is_ignored("__pycache__", is_dir=False) is False
        assert f.is_ignored("eggs-info", is_dir=False) is False

    def test_nested_path_matched(self, f: GitIgnoreFilter) -> None:
        assert f.is_ignored("src/utils/__pycache__", is_dir=True) is True
        assert f.is_ignored("a/b/c/debug.log", is_dir=False) is True


# =============================================================================
# is_ignored — is_dir=None (conservative / Daytona mode)
# =============================================================================


class TestIsIgnoredDirUnknown:
    """When is_dir is None, both file and directory patterns should match."""

    @pytest.fixture
    def f(self) -> GitIgnoreFilter:
        result = GitIgnoreFilter.from_content("venv/\n*.pyc\ndist\n")
        assert result is not None
        return result

    def test_file_pattern_matched(self, f: GitIgnoreFilter) -> None:
        assert f.is_ignored("cache.pyc", is_dir=None) is True

    def test_dir_only_pattern_matched_conservatively(self, f: GitIgnoreFilter) -> None:
        assert f.is_ignored("venv", is_dir=None) is True

    def test_bare_name_matched(self, f: GitIgnoreFilter) -> None:
        assert f.is_ignored("dist", is_dir=None) is True

    def test_non_matching_path(self, f: GitIgnoreFilter) -> None:
        assert f.is_ignored("src", is_dir=None) is False
        assert f.is_ignored("main.py", is_dir=None) is False


# =============================================================================
# is_ignored — negation patterns
# =============================================================================


class TestIsIgnoredNegation:
    """Negation (!) re-includes previously ignored paths."""

    def test_negation_re_includes(self) -> None:
        f = GitIgnoreFilter.from_content("*.log\n!important.log\n")
        assert f is not None
        assert f.is_ignored("debug.log", is_dir=False) is True
        assert f.is_ignored("important.log", is_dir=False) is False

    def test_negation_with_path_prefix(self) -> None:
        f = GitIgnoreFilter.from_content("logs/\n!logs/keep.txt\n")
        assert f is not None
        assert f.is_ignored("logs", is_dir=True) is True
        assert f.is_ignored("logs/keep.txt", is_dir=False) is False


# =============================================================================
# is_ignored — path-prefix patterns
# =============================================================================


class TestIsIgnoredPathPrefix:
    """Patterns with path separators match specific locations."""

    def test_rooted_pattern(self) -> None:
        f = GitIgnoreFilter.from_content("/build\n")
        assert f is not None
        assert f.is_ignored("build", is_dir=True) is True
        assert f.is_ignored("src/build", is_dir=True) is False

    def test_subdir_pattern(self) -> None:
        f = GitIgnoreFilter.from_content("docs/*.pdf\n")
        assert f is not None
        assert f.is_ignored("docs/manual.pdf", is_dir=False) is True
        assert f.is_ignored("src/manual.pdf", is_dir=False) is False
