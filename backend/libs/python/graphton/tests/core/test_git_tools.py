"""Tests for git_tools — create_pull_request platform tool.

Covers:
- URL parsing: HTTPS, SSH, with/without .git suffix, non-GitHub
- Credential parsing: valid entries, missing entries, malformed files
- PR creation: success, GitHub API errors, same-branch guard
- Sandbox command failures: no remote, no branch, no credentials
- Approval flow integration
"""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from graphton.core.git_tools import (
    _create_create_pull_request_tool,
    _parse_github_repo,
    _parse_token_from_credentials,
)


def _tc(name: str, args: dict, tc_id: str = "call_test_001") -> dict:
    """Build a ToolCall-format input dict for tool.ainvoke()."""
    return {"name": name, "args": args, "id": tc_id, "type": "tool_call"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@dataclass
class _ExecResult:
    stdout: str
    stderr: str
    exit_code: int


def _backend(
    remote_url: str = "https://github.com/acme/widgets.git",
    branch: str = "feat/cool-thing",
    default_branch: str = "main",
    cred_content: str = "https://x-access-token:ghp_abc123@github.com\n",
    *,
    remote_ok: bool = True,
    branch_ok: bool = True,
    default_branch_ok: bool = True,
    cred_ok: bool = True,
) -> MagicMock:
    """Build a mock sandbox backend with configurable execute responses."""
    mock = MagicMock()

    def _execute(cmd: str, timeout: int = 120):
        if "git remote get-url" in cmd:
            if not remote_ok:
                return _ExecResult("", "fatal: not a git repository", 128)
            return _ExecResult(remote_url, "", 0)
        if "git rev-parse --abbrev-ref HEAD" in cmd:
            if not branch_ok:
                return _ExecResult("", "fatal: HEAD detached", 128)
            return _ExecResult(branch, "", 0)
        if "git remote show origin" in cmd:
            if not default_branch_ok:
                return _ExecResult("", "error", 1)
            return _ExecResult(default_branch, "", 0)
        if "cat" in cmd and ".git-credentials" in cmd:
            if not cred_ok:
                return _ExecResult("", "No such file", 1)
            return _ExecResult(cred_content, "", 0)
        return _ExecResult("", "unknown command", 1)

    mock.execute = _execute
    return mock


_MOCK_CONFIG = {"run_id": "test-run-123"}

_PR_RESPONSE = {
    "number": 42,
    "html_url": "https://github.com/acme/widgets/pull/42",
    "title": "Add feature X",
}


# ===========================================================================
# _parse_github_repo
# ===========================================================================


class TestParseGithubRepo:

    def test_https_with_git_suffix(self):
        assert _parse_github_repo("https://github.com/acme/widgets.git") == ("acme", "widgets")

    def test_https_without_git_suffix(self):
        assert _parse_github_repo("https://github.com/acme/widgets") == ("acme", "widgets")

    def test_https_with_trailing_slash(self):
        assert _parse_github_repo("https://github.com/acme/widgets/") == ("acme", "widgets")

    def test_ssh_with_git_suffix(self):
        assert _parse_github_repo("git@github.com:acme/widgets.git") == ("acme", "widgets")

    def test_ssh_without_git_suffix(self):
        assert _parse_github_repo("git@github.com:acme/widgets") == ("acme", "widgets")

    def test_http_scheme(self):
        assert _parse_github_repo("http://github.com/acme/widgets.git") == ("acme", "widgets")

    def test_non_github_raises(self):
        with pytest.raises(ValueError, match="Only github.com"):
            _parse_github_repo("https://gitlab.com/acme/widgets.git")

    def test_malformed_url_raises(self):
        with pytest.raises(ValueError, match="Cannot parse"):
            _parse_github_repo("not-a-url")

    def test_whitespace_stripped(self):
        assert _parse_github_repo("  https://github.com/acme/widgets.git  \n") == (
            "acme",
            "widgets",
        )


# ===========================================================================
# _parse_token_from_credentials
# ===========================================================================


class TestParseTokenFromCredentials:

    def test_standard_entry(self):
        content = "https://x-access-token:ghp_abc123@github.com\n"
        assert _parse_token_from_credentials(content) == "ghp_abc123"

    def test_multiple_entries_picks_github(self):
        content = (
            "https://user:token1@gitlab.com\n"
            "https://x-access-token:ghp_real@github.com\n"
        )
        assert _parse_token_from_credentials(content) == "ghp_real"

    def test_empty_file_raises(self):
        with pytest.raises(ValueError, match="No GitHub token found"):
            _parse_token_from_credentials("")

    def test_no_github_entry_raises(self):
        with pytest.raises(ValueError, match="No GitHub token found"):
            _parse_token_from_credentials("https://user:token@gitlab.com\n")

    def test_no_password_raises(self):
        with pytest.raises(ValueError, match="No GitHub token found"):
            _parse_token_from_credentials("https://github.com\n")

    def test_blank_lines_ignored(self):
        content = "\n\nhttps://x-access-token:ghp_xyz@github.com\n\n"
        assert _parse_token_from_credentials(content) == "ghp_xyz"


# ===========================================================================
# create_pull_request tool — end-to-end (mocked GitHub API)
# ===========================================================================


class TestCreatePullRequest:

    @pytest.fixture
    def tool(self):
        return _create_create_pull_request_tool(_backend())

    @pytest.mark.asyncio
    async def test_successful_pr_creation(self, tool):
        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_response.json.return_value = _PR_RESPONSE
        mock_response.raise_for_status = MagicMock()

        with patch("graphton.core.git_tools.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post.return_value = mock_response
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            result = await tool.ainvoke(
                _tc(
                    "create_pull_request",
                    {"title": "Add feature X", "body": "Does cool stuff"},
                ),
                config=_MOCK_CONFIG,
            )

        assert "Pull request created successfully" in result.content
        assert "#42" in result.content
        assert "https://github.com/acme/widgets/pull/42" in result.content
        assert "feat/cool-thing -> main" in result.content

    @pytest.mark.asyncio
    async def test_explicit_base_and_head_branches(self):
        mock_be = _backend()
        tool = _create_create_pull_request_tool(mock_be)

        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_response.json.return_value = _PR_RESPONSE
        mock_response.raise_for_status = MagicMock()

        with patch("graphton.core.git_tools.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post.return_value = mock_response
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            result = await tool.ainvoke(
                _tc(
                    "create_pull_request",
                    {
                        "title": "Fix bug",
                        "body": "Fixes it",
                        "base_branch": "develop",
                        "head_branch": "fix/bug-123",
                    },
                ),
                config=_MOCK_CONFIG,
            )

        assert "fix/bug-123 -> develop" in result.content

    # -- Sandbox command failures -------------------------------------------

    @pytest.mark.asyncio
    async def test_no_git_remote(self):
        tool = _create_create_pull_request_tool(_backend(remote_ok=False))
        result = await tool.ainvoke(
            _tc("create_pull_request", {"title": "T", "body": "B"}),
            config=_MOCK_CONFIG,
        )
        assert "Failed to determine the git remote URL" in result.content

    @pytest.mark.asyncio
    async def test_non_github_remote(self):
        tool = _create_create_pull_request_tool(
            _backend(remote_url="https://gitlab.com/acme/widgets.git")
        )
        result = await tool.ainvoke(
            _tc("create_pull_request", {"title": "T", "body": "B"}),
            config=_MOCK_CONFIG,
        )
        assert "Only github.com" in result.content

    @pytest.mark.asyncio
    async def test_detached_head(self):
        tool = _create_create_pull_request_tool(_backend(branch_ok=False))
        result = await tool.ainvoke(
            _tc("create_pull_request", {"title": "T", "body": "B"}),
            config=_MOCK_CONFIG,
        )
        assert "Failed to determine the current branch" in result.content

    @pytest.mark.asyncio
    async def test_no_credentials(self):
        tool = _create_create_pull_request_tool(_backend(cred_ok=False))
        result = await tool.ainvoke(
            _tc("create_pull_request", {"title": "T", "body": "B"}),
            config=_MOCK_CONFIG,
        )
        assert "Git credentials are not configured" in result.content

    @pytest.mark.asyncio
    async def test_same_branch_guard(self):
        tool = _create_create_pull_request_tool(_backend(branch="main"))
        result = await tool.ainvoke(
            _tc("create_pull_request", {"title": "T", "body": "B"}),
            config=_MOCK_CONFIG,
        )
        assert "same as the base branch" in result.content

    @pytest.mark.asyncio
    async def test_default_branch_fallback_to_main(self):
        """When `git remote show origin` fails, base defaults to 'main'."""
        mock_be = _backend(default_branch_ok=False, branch="feat/x")
        tool = _create_create_pull_request_tool(mock_be)

        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_response.json.return_value = _PR_RESPONSE
        mock_response.raise_for_status = MagicMock()

        with patch("graphton.core.git_tools.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post.return_value = mock_response
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            result = await tool.ainvoke(
                _tc("create_pull_request", {"title": "T", "body": "B"}),
                config=_MOCK_CONFIG,
            )

        assert "feat/x -> main" in result.content

    # -- GitHub API errors --------------------------------------------------

    @pytest.mark.asyncio
    async def test_github_422_no_commits(self):
        tool = _create_create_pull_request_tool(_backend())

        error_resp = MagicMock()
        error_resp.status_code = 422
        error_resp.json.return_value = {
            "message": "No commits between main and feat/cool-thing",
            "errors": [],
        }
        exc = httpx.HTTPStatusError(
            "422", request=MagicMock(), response=error_resp,
        )

        with patch("graphton.core.git_tools.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post.side_effect = exc
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            result = await tool.ainvoke(
                _tc("create_pull_request", {"title": "T", "body": "B"}),
                config=_MOCK_CONFIG,
            )

        assert "pushed your branch" in result.content

    @pytest.mark.asyncio
    async def test_github_422_pr_already_exists(self):
        tool = _create_create_pull_request_tool(_backend())

        error_resp = MagicMock()
        error_resp.status_code = 422
        error_resp.json.return_value = {
            "message": "A pull request already exists for acme:feat/cool-thing",
            "errors": [],
        }
        exc = httpx.HTTPStatusError(
            "422", request=MagicMock(), response=error_resp,
        )

        with patch("graphton.core.git_tools.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post.side_effect = exc
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            result = await tool.ainvoke(
                _tc("create_pull_request", {"title": "T", "body": "B"}),
                config=_MOCK_CONFIG,
            )

        assert "already exists" in result.content

    @pytest.mark.asyncio
    async def test_github_api_timeout(self):
        tool = _create_create_pull_request_tool(_backend())

        with patch("graphton.core.git_tools.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post.side_effect = httpx.TimeoutException("timed out")
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            result = await tool.ainvoke(
                _tc("create_pull_request", {"title": "T", "body": "B"}),
                config=_MOCK_CONFIG,
            )

        assert "timed out" in result.content

    @pytest.mark.asyncio
    async def test_github_generic_http_error(self):
        tool = _create_create_pull_request_tool(_backend())

        error_resp = MagicMock()
        error_resp.status_code = 403
        error_resp.json.return_value = {
            "message": "Resource not accessible by integration",
            "errors": [],
        }
        exc = httpx.HTTPStatusError(
            "403", request=MagicMock(), response=error_resp,
        )

        with patch("graphton.core.git_tools.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post.side_effect = exc
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            result = await tool.ainvoke(
                _tc("create_pull_request", {"title": "T", "body": "B"}),
                config=_MOCK_CONFIG,
            )

        assert "HTTP 403" in result.content
        assert "Resource not accessible" in result.content


# ===========================================================================
# Repo dir parameter
# ===========================================================================


class TestRepoDirParameter:

    @pytest.mark.asyncio
    async def test_repo_dir_prefixed_to_commands(self):
        calls: list[str] = []
        mock = MagicMock()

        def _execute(cmd: str, timeout: int = 120):
            calls.append(cmd)
            if "git remote get-url" in cmd:
                return _ExecResult("https://github.com/a/b.git", "", 0)
            if "git rev-parse" in cmd:
                return _ExecResult("feat", "", 0)
            if "git remote show" in cmd:
                return _ExecResult("  HEAD branch: main", "", 0)
            if ".git-credentials" in cmd:
                return _ExecResult("https://x-access-token:tok@github.com\n", "", 0)
            return _ExecResult("", "", 0)

        mock.execute = _execute
        tool = _create_create_pull_request_tool(mock)

        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_response.json.return_value = _PR_RESPONSE
        mock_response.raise_for_status = MagicMock()

        with patch("graphton.core.git_tools.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post.return_value = mock_response
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            await tool.ainvoke(
                _tc(
                    "create_pull_request",
                    {"title": "T", "body": "B", "repo_dir": "/workspace/my-app"},
                ),
                config=_MOCK_CONFIG,
            )

        git_commands = [c for c in calls if "git" in c and ".git-credentials" not in c]
        for cmd in git_commands:
            assert cmd.startswith("cd /workspace/my-app && ")


# ===========================================================================
# Approval checker integration
# ===========================================================================


class TestApprovalIntegration:

    def test_tool_name_is_create_pull_request(self):
        tool = _create_create_pull_request_tool(_backend())
        assert getattr(tool, "name", None) == "create_pull_request"

    def test_tool_has_ainvoke(self):
        tool = _create_create_pull_request_tool(_backend())
        assert hasattr(tool, "ainvoke")
