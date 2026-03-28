"""Platform tool for creating GitHub pull requests from within a sandbox.

The ``create_pull_request`` tool is a *platform tool* — it sits alongside
``read``, ``write``, ``execute``, etc.  Unlike those tools, it also makes
an outbound HTTP call to the GitHub REST API, using credentials that were
persisted in the sandbox's git credential store during workspace
provisioning (Phase 1).

Architecture
~~~~~~~~~~~~

At invocation time the tool:

1. Discovers the repository by running ``git remote get-url origin`` in
   the sandbox via ``backend.execute()``.
2. Discovers the current branch via ``git rev-parse --abbrev-ref HEAD``.
3. Reads the GitHub token from ``~/.git-credentials`` (the standard
   git-credential-store file written during provisioning).
4. Calls ``POST /repos/{owner}/{repo}/pulls`` on the GitHub REST API
   from the **worker** process (not from inside the sandbox).

The tool is stateless — it does not receive repository metadata or
tokens at creation time.  This keeps the factory simple and works
correctly when multiple git workspaces are provisioned.

Security
~~~~~~~~

The token is read from the sandbox filesystem at invocation time and
held in worker memory only for the duration of the HTTP call.  It is
never stored on the tool object, never logged, and never returned to
the LLM.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Annotated, Any

import httpx
from langchain_core.callbacks import dispatch_custom_event
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId, tool

from graphton.core.error_hints import enrich_error_message
from graphton.core.github_api import (
    github_create_pr as _github_create_pr,
)
from graphton.core.github_api import (
    parse_github_repo as _parse_github_repo,
)
from graphton.core.github_api import (
    parse_token_from_credentials as _parse_token_from_credentials,
)
from graphton.core.tool_wrappers import ApprovalRequirement, _check_and_handle_approval

logger = logging.getLogger(__name__)

_CREDENTIAL_FILE = "/home/daytona/.git-credentials"
"""Path to the git-credential-store file inside the Daytona sandbox."""


# ---------------------------------------------------------------------------
# Tool factory
# ---------------------------------------------------------------------------


def _create_create_pull_request_tool(
    backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None = None,
    sub_agent_name: str = "",
) -> Callable[..., Any]:
    """Create the ``create_pull_request`` platform tool.

    The returned LangChain ``@tool`` function is wired into the agent's
    tool list alongside ``read``, ``write``, ``execute``, etc.

    Args:
        backend: Sandbox backend with an ``execute()`` method.
        approval_checker: Optional HITL approval checker.
        sub_agent_name: Retained for factory signature compatibility. Not used
            in interrupt payloads (display fields come from the ToolCall proto).

    Returns:
        A ``@tool``-decorated async function.
    """

    @tool
    async def create_pull_request(
        config: RunnableConfig,
        tool_call_id: Annotated[str, InjectedToolCallId],
        title: str,
        body: str,
        base_branch: str = "",
        head_branch: str = "",
        repo_dir: str = "",
    ) -> str:
        """Create a GitHub pull request for the current branch.

        Use this after you have committed and pushed your changes to a
        branch.  The tool reads repository info and credentials from the
        workspace automatically.

        Args:
            title: PR title (required).
            body: PR description in Markdown (required).
            base_branch: Target branch for the PR.  Defaults to the
                repository's default branch if not specified.
            head_branch: Source branch containing your changes.  Defaults
                to the currently checked-out branch if not specified.
            repo_dir: Path to the git repository within the workspace.
                Only needed in multi-repo workspaces.  Defaults to the
                workspace root.

        Returns:
            A summary with the PR number and URL, or an error message.
        """
        tool_args = {
            "title": title,
            "body": body,
            "base_branch": base_branch,
            "head_branch": head_branch,
            "repo_dir": repo_dir,
        }

        skip_result = _check_and_handle_approval(
            "create_pull_request",
            tool_args,
            approval_checker,
            tool_call_id=tool_call_id,
        )
        if skip_result is not None:
            return skip_result

        try:
            dispatch_custom_event(
                "tool_progress",
                {"chunk": f"Creating pull request: {title}\n"},
            )

            # ── 1. Discover repo ──────────────────────────────────────
            cd_prefix = f"cd {repo_dir} && " if repo_dir else ""

            remote_result = backend.execute(
                f"{cd_prefix}git remote get-url origin", timeout=10,
            )
            if remote_result.exit_code != 0:
                return (
                    "Failed to determine the git remote URL. "
                    "Make sure you are in a git repository.\n"
                    f"stderr: {remote_result.stderr}"
                )
            remote_url = remote_result.stdout.strip()

            try:
                owner, repo = _parse_github_repo(remote_url)
            except ValueError as exc:
                return str(exc)

            # ── 2. Discover head branch ───────────────────────────────
            if head_branch:
                head = head_branch
            else:
                branch_result = backend.execute(
                    f"{cd_prefix}git rev-parse --abbrev-ref HEAD", timeout=10,
                )
                if branch_result.exit_code != 0:
                    return (
                        "Failed to determine the current branch.\n"
                        f"stderr: {branch_result.stderr}"
                    )
                head = branch_result.stdout.strip()

            # ── 3. Resolve base branch ────────────────────────────────
            if base_branch:
                base = base_branch
            else:
                # Ask the GitHub API for the repo's default branch.
                base_result = backend.execute(
                    f"{cd_prefix}git remote show origin "
                    "| grep 'HEAD branch' | awk '{print $NF}'",
                    timeout=15,
                )
                if base_result.exit_code != 0 or not base_result.stdout.strip():
                    base = "main"
                    logger.info(
                        "Could not determine default branch from remote; "
                        "falling back to 'main'."
                    )
                else:
                    base = base_result.stdout.strip()

            if head == base:
                return (
                    f"The head branch ({head!r}) is the same as the base "
                    f"branch ({base!r}). Create a new branch with your "
                    "changes before creating a pull request."
                )

            # ── 4. Read credentials ───────────────────────────────────
            cred_result = backend.execute(f"cat {_CREDENTIAL_FILE}", timeout=5)
            if cred_result.exit_code != 0:
                return (
                    "Git credentials are not configured in this workspace. "
                    "Cannot create pull requests without a GitHub token."
                )

            try:
                token = _parse_token_from_credentials(cred_result.stdout)
            except ValueError as exc:
                return str(exc)

            # ── 5. Create PR via GitHub API ───────────────────────────
            logger.info(
                "Creating PR: %s/%s  %s -> %s  title=%r",
                owner, repo, head, base, title,
            )

            pr_data = await _github_create_pr(
                token=token,
                owner=owner,
                repo=repo,
                title=title,
                body=body,
                head=head,
                base=base,
            )

            pr_number = pr_data.get("number", "?")
            pr_url = pr_data.get("html_url", "")

            dispatch_custom_event(
                "tool_progress",
                {"chunk": f"PR #{pr_number}: {pr_url}\n"},
            )

            return (
                f"Pull request created successfully.\n"
                f"  Number: #{pr_number}\n"
                f"  URL:    {pr_url}\n"
                f"  Title:  {title}\n"
                f"  Branch: {head} -> {base}"
            )

        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            try:
                error_body = exc.response.json()
                message = error_body.get("message", str(exc))
                errors = error_body.get("errors", [])
                detail = "; ".join(
                    e.get("message", "") for e in errors if e.get("message")
                )
            except Exception:
                message = str(exc)
                detail = ""

            if status == 422 and "No commits between" in message:
                return (
                    f"GitHub rejected the pull request: {message}. "
                    "Make sure you have pushed your branch to the remote."
                )
            if status == 422 and "A pull request already exists" in message:
                return (
                    f"A pull request already exists for branch {head!r}. "
                    f"GitHub message: {message}"
                )

            error_msg = f"GitHub API error (HTTP {status}): {message}"
            if detail:
                error_msg += f"\nDetails: {detail}"
            logger.warning("create_pull_request failed: %s", error_msg)
            return error_msg

        except httpx.TimeoutException:
            return (
                "The GitHub API request timed out. "
                "Please try again — this may be a transient network issue."
            )
        except Exception as exc:
            logger.warning("create_pull_request failed: %s", exc)
            return enrich_error_message("create_pull_request", str(exc))

    create_pull_request.name = "create_pull_request"  # type: ignore[attr-defined]
    return create_pull_request  # type: ignore[return-value]
