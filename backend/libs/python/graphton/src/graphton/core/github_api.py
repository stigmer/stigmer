"""Shared GitHub API utilities for git write-back operations.

Extracted from ``git_tools.py`` so both the agent-facing
``create_pull_request`` tool and the platform-owned write-back
workflow in ``writeback.py`` can reuse the same logic without
duplicating URL parsing, credential extraction, or REST API calls.

All functions are stateless and independently testable.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

import httpx

_GITHUB_API_BASE = "https://api.github.com"

_GITHUB_HTTPS_RE = re.compile(
    r"^https?://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/.]+?)(?:\.git)?/?$"
)

_GITHUB_SSH_RE = re.compile(
    r"^git@github\.com:(?P<owner>[^/]+)/(?P<repo>[^/.]+?)(?:\.git)?$"
)


def parse_github_repo(remote_url: str) -> tuple[str, str]:
    """Extract ``(owner, repo)`` from a GitHub remote URL.

    Supports both HTTPS and SSH URL formats.  Raises ``ValueError`` for
    non-GitHub or unparseable URLs.

    >>> parse_github_repo("https://github.com/acme/widgets.git")
    ('acme', 'widgets')
    >>> parse_github_repo("git@github.com:acme/widgets.git")
    ('acme', 'widgets')
    """
    url = remote_url.strip()

    match = _GITHUB_HTTPS_RE.match(url) or _GITHUB_SSH_RE.match(url)
    if match:
        return match.group("owner"), match.group("repo")

    raise ValueError(
        f"Cannot parse GitHub owner/repo from remote URL: {url!r}. "
        "Only github.com repositories are supported."
    )


def parse_token_from_credentials(credential_content: str) -> str:
    """Extract the GitHub token from git-credential-store file content.

    The credential store uses one URL per line in the format::

        https://x-access-token:{token}@github.com

    Returns the first token found for ``github.com``.  Raises
    ``ValueError`` if no matching entry exists.
    """
    for line in credential_content.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = urlparse(line)
        except Exception:
            continue
        if parsed.hostname and parsed.hostname.lower() == "github.com" and parsed.password:
            return parsed.password

    raise ValueError(
        "No GitHub token found in credential store. "
        "Git credentials may not have been configured during workspace provisioning."
    )


async def github_create_pr(
    token: str,
    owner: str,
    repo: str,
    title: str,
    body: str,
    head: str,
    base: str,
) -> dict[str, Any]:
    """Call the GitHub REST API to create a pull request.

    Returns the parsed JSON response on success.  Raises
    ``httpx.HTTPStatusError`` on non-2xx responses.
    """
    url = f"{_GITHUB_API_BASE}/repos/{owner}/{repo}/pulls"

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            json={
                "title": title,
                "body": body,
                "head": head,
                "base": base,
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()
