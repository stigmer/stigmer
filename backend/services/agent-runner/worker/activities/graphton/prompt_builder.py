"""System-prompt construction for Graphton agent execution.

All functions are pure: no side effects, no state, no I/O beyond
``os.path`` calls for workspace-relative file metadata.

Extracted from ``execute_graphton.py`` to keep prompt logic focused
and independently testable.
"""

from __future__ import annotations

import os
from typing import Any

from worker.workspace import GitMetadata, ProvisionResult, SourceType
from worker.workspace.tree import (
    TREE_DEFAULT_MAX_ENTRIES as _TREE_MAX_ENTRIES,
)
from worker.workspace.tree import (
    build_directory_tree as _build_directory_tree,
)
from worker.workspace.tree import (
    human_size as _human_size,
)


def build_workspace_prompt_section(
    provision_results: list[ProvisionResult],
    *,
    container_root: str = "",
) -> str:
    """Build the ``## Workspace`` system prompt section from provision results.

    Returns an empty string when there are no provisions — safe to
    unconditionally append.

    For a single entry the output uses the legacy single-workspace format.
    For multiple entries each gets a ``### {name}`` sub-heading.

    *container_root* is the backend's root directory — used only in the
    multi-entry path to tell the agent its current working directory.
    """
    if not provision_results:
        return ""

    if len(provision_results) == 1:
        return _build_single_workspace_section(provision_results[0])

    return _build_multi_workspace_section(provision_results, container_root)


def _git_writeback_guidance(
    meta: GitMetadata | None,
    *,
    heading_level: int = 3,
) -> str:
    """Return a prompt section telling the agent it can push changes.

    Returns an empty string when *meta* is ``None`` or credentials
    were not configured.
    """
    if meta is None or not meta.git_credentials_configured:
        return ""

    heading = "#" * heading_level
    return (
        f"\n\n{heading} Git Write-Back\n\n"
        "Git credentials are configured — you can push changes to "
        "the remote repository.\n\n"
        "**Rules:**\n"
        "- Create a new branch for your changes (never push directly "
        "to the default branch).\n"
        "- Write clear, meaningful commit messages.\n"
        "- Push your branch and report the branch name when done.\n"
        "- After pushing, use `create_pull_request` to open a PR. "
        "It reads credentials and repo info automatically.\n"
        "- Do NOT read, echo, or reference credential files "
        "(e.g. `~/.git-credentials`)."
    )


def _build_single_workspace_section(result: ProvisionResult) -> str:
    """Format the workspace section for a single entry (legacy compat)."""
    if not result.workspace_description:
        return ""

    section = "\n\n## Workspace\n\n" + result.workspace_description

    if result.file_tree:
        section += "\n\n" + result.file_tree

    section += _git_writeback_guidance(result.git_metadata)

    return section


def _build_multi_workspace_section(
    results: list[ProvisionResult],
    container_root: str,
) -> str:
    """Format the workspace section for multiple entries.

    The tree heading level is controlled at provisioning time via
    ``tree_heading_level``, so no post-hoc replacement is needed.
    """
    first_label = results[0].entry_name or "entry-1"

    section = (
        f"\n\n## Workspace\n\n"
        f"This session has {len(results)} workspace entries.\n\n"
        f"**Current working directory**: `{container_root}`\n"
        f"**Path resolution**: All file tools (read, write, edit, ls, "
        f"glob, grep) resolve paths relative to the current working "
        f"directory. Use entry-relative paths "
        f"(e.g., `{first_label}/src/main.py`) or absolute paths.\n"
    )

    for idx, result in enumerate(results):
        label = result.entry_name or f"entry-{idx + 1}"
        section += f"\n### {label} (`{result.root_dir}`)\n\n"
        section += _format_entry_description(result)

        if result.file_tree:
            section += "\n\n" + result.file_tree

    return section


def _format_entry_description(result: ProvisionResult) -> str:
    """Generate a multi-workspace-appropriate description for one entry.

    Uses structured fields rather than the generic ``workspace_description``
    so the phrasing fits a multi-entry context.
    """
    name = result.entry_name or "this entry"

    if result.source_type == SourceType.LOCAL_PATH:
        return (
            f"Workspace entry **{name}** is the user's project directory "
            f"at `{result.root_dir}`.\n"
            "You are operating directly on the user's files — changes are "
            "immediate and persistent. Use git to track and verify your "
            "changes."
        )

    if result.source_type == SourceType.GIT_REPO and result.git_metadata:
        meta = result.git_metadata
        short_sha = (
            meta.base_commit[:7]
            if len(meta.base_commit) >= 7
            else meta.base_commit
        )
        desc = (
            f"Workspace entry **{name}** was initialized from "
            f"{meta.repo_url} (branch: {meta.branch}, "
            f"commit: {short_sha}).\n"
            "Changes you make will be captured as artifacts when "
            "execution completes."
        )
        desc += _git_writeback_guidance(meta, heading_level=4)
        return desc

    if result.source_type == SourceType.EMPTY:
        return (
            f"Workspace entry **{name}** is an empty workspace.\n"
            "Create files and directories as needed for your task."
        )

    return result.workspace_description


def build_referenced_files_prompt_section(
    workspace_file_refs: list[str],
    workspace_root: str,
) -> str:
    """Build the ``## Referenced Files`` system prompt section.

    When the user attaches workspace files, this lists them with structural
    metadata so the agent can navigate efficiently.
    """
    if not workspace_file_refs:
        return ""

    section = (
        "\n\n## Referenced Files\n\n"
        "The user has highlighted the following workspace paths for your "
        "attention. Use `read` to access file contents.\n\n"
    )

    for ref_path in workspace_file_refs:
        full_path = os.path.join(workspace_root, ref_path)
        try:
            if os.path.isdir(full_path):
                tree_lines, total = _build_directory_tree(
                    full_path,
                    ref_path.rstrip("/") + "/",
                )
                label = "entry" if total == 1 else "entries"
                section += f"- `{ref_path}/` (directory, {total} {label})\n"
                for line in tree_lines:
                    section += line + "\n"
                if total > len(tree_lines):
                    section += (
                        f"    - ... and {total - len(tree_lines)} more "
                        f"(truncated at {_TREE_MAX_ENTRIES} entries)\n"
                    )
            else:
                size = os.path.getsize(full_path)
                section += f"- `{ref_path}` ({_human_size(size)})\n"
        except OSError:
            section += f"- `{ref_path}`\n"

    return section


_RESPONSE_RULES = (
    "\n\n## Response rules\n\n"
    "- After using the read tool, NEVER reprint, echo, list, or summarize "
    "file contents in your response. Tool results are already in your "
    "context. Proceed directly to analysis or the task.\n"
    "- Do not begin responses with phrases like "
    '"Below is the complete content", '
    '"Here are the contents of the files", or similar. '
    "The user did not ask you to display file contents.\n"
)

_SUB_AGENT_RULES = (
    "\n\n## Sub-agent delegation rules\n\n"
    "- **Read files directly.** When you need the contents of a file, "
    "use the `read` tool yourself. Do not delegate file reading to "
    "sub-agents via the `task` tool. You need raw file contents in "
    "your own context to reason about them accurately.\n"
    "- Sub-agents are for **multi-step, independent tasks** that "
    "produce a deliverable (analysis, synthesis, generated content). "
    "They are not for fetching data that you will process yourself.\n"
    "- When delegating to a sub-agent, specify the analysis or "
    'deliverable you need — not "read these files and give me the '
    'contents."\n'
)


def enhance_system_prompt(
    *,
    instructions: str,
    provision_results: list[ProvisionResult],
    container_root: str,
    user_message: str,
    build_relevance: Any,
    workspace_roots: list[Any],
    skills_prompt_section: str,
    workspace_file_refs: list[str],
    workspace_root: str,
    injected_files: list[dict[str, Any]],
) -> str:
    """Assemble the full system prompt from base instructions and contextual sections.

    Pure function: collects all prompt parts and returns the final string.
    """
    prompt = instructions

    workspace_section = build_workspace_prompt_section(
        provision_results, container_root=container_root,
    )
    if workspace_section:
        prompt += workspace_section

    relevance_section = build_relevance(user_message, workspace_roots)
    if relevance_section:
        prompt += relevance_section

    if skills_prompt_section:
        prompt += skills_prompt_section

    if workspace_file_refs:
        ref_section = build_referenced_files_prompt_section(
            workspace_file_refs, workspace_root,
        )
        if ref_section:
            prompt += ref_section

    if injected_files:
        input_files_section = "\n\n## Input Files\n\n"
        input_files_section += (
            "The following files have been provided as read-only reference "
            "material for your task. They live under `.stigmer/inputs/` and "
            "are NOT part of the project source tree.\n\n"
            "Read them using the `read` tool when you need their contents. "
            "Do NOT echo, reprint, or summarize file contents in your response "
            "-- they are reference material, not output. "
            "Do NOT modify or delete these files.\n\n"
        )
        for f in injected_files:
            size_info = f" ({f['size']} bytes)" if f.get('size') is not None else ""
            input_files_section += f"- `{f['path']}`{size_info}\n"
        prompt += input_files_section

    prompt += _RESPONSE_RULES
    prompt += _SUB_AGENT_RULES

    return prompt
