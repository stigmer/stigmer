"""System-prompt construction for Graphton agent execution.

All functions are pure: no side effects, no state, no I/O beyond
``os.path`` calls for workspace-relative file metadata.

Extracted from ``execute_graphton.py`` to keep prompt logic focused
and independently testable.
"""

from __future__ import annotations

import os
from typing import Any

from stigmer_runner.worker.workspace import GitMetadata, ProvisionResult, SourceType
from stigmer_runner.worker.workspace.tree import (
    TREE_DEFAULT_MAX_ENTRIES as _TREE_MAX_ENTRIES,
)
from stigmer_runner.worker.workspace.tree import (
    build_directory_tree as _build_directory_tree,
)
from stigmer_runner.worker.workspace.tree import (
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
    """Return a prompt section telling the agent about git write-back.

    Previously injected instructions for the agent to manually create
    branches and PRs.  Now that the platform owns the write-back
    workflow (post-execution branch + commit + push + PR), the agent
    no longer needs these instructions.  Returns an empty string
    unconditionally.
    """
    return ""


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

    Workspace paths are presented as relative to the workspace root so the
    LLM naturally generates relative-path commands.  The execute tool
    already enforces CWD at the workspace root, so relative paths resolve
    correctly without the agent needing the absolute sandbox path.

    The tree heading level is controlled at provisioning time via
    ``tree_heading_level``, so no post-hoc replacement is needed.
    """
    first_label = results[0].entry_name or "entry-1"

    section = (
        f"\n\n## Workspace\n\n"
        f"This session has {len(results)} workspace entries.\n\n"
        f"**Path resolution**: All tools resolve paths relative to the "
        f"workspace root. Use entry-relative paths "
        f"(e.g., `{first_label}/src/main.py`). "
        f"Do not use absolute filesystem paths.\n"
    )

    for idx, result in enumerate(results):
        label = result.entry_name or f"entry-{idx + 1}"
        rel_path = _workspace_relative_path(result.root_dir, container_root)
        section += f"\n### {label} (`{rel_path}`)\n\n"
        section += _format_entry_description(result)

        if result.file_tree:
            section += "\n\n" + result.file_tree

    return section


def _workspace_relative_path(root_dir: str, container_root: str) -> str:
    """Compute a workspace-relative display path.

    Returns ``os.path.relpath(root_dir, container_root)`` so the LLM sees
    entry paths like ``plantonhq/agent-fleet`` instead of the absolute
    sandbox path ``/home/daytona/workspace/plantonhq/agent-fleet``.

    Falls back to ``root_dir`` unchanged when *container_root* is empty
    (local mode) or when ``relpath`` produces a ``..``-rooted result.
    """
    if not container_root:
        return root_dir
    try:
        rel = os.path.relpath(root_dir, container_root)
    except ValueError:
        return root_dir
    if rel.startswith(".."):
        return root_dir
    return rel


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
    "- Use backticks for file paths, function names, variable names, "
    "and shell commands (e.g., `src/main.py`, `handleRequest()`, "
    "`npm install`).\n"
    "- When referencing code, cite the file path — do not re-print "
    "code blocks that the user can see in tool results.\n"
    "- Structure complex answers with headings and bullet points.\n"
    "- If you encounter something unexpected that changes the scope, "
    "explain the issue and propose options before proceeding.\n"
)

_SUB_AGENT_RULES = (
    "\n\n## Sub-agent delegation rules\n\n"
    "### Concurrency limit\n\n"
    "Do NOT spawn more than 3 sub-agents concurrently. If you need to "
    "explore more than 3 areas, batch them: launch the first 3, wait for "
    "results, then launch more if needed. The runtime enforces this limit — "
    "excess sub-agents will be rejected.\n\n"
    "### When NOT to delegate\n\n"
    "- **Reading files.** Use the `read` tool yourself. You need raw file "
    "contents in your own context to reason about them accurately.\n"
    "- **Single-step lookups.** Use `grep`, `glob`, `search`, or `read` "
    "directly for simple searches across 1-2 files. Only delegate when "
    "the task requires multi-step exploration.\n"
    "- **Data you will process yourself.** If you need the output in your "
    "own context (e.g., to answer a question, write code, compare files), "
    "do the work directly — do not delegate it.\n"
    "- **Small tasks (fewer than 3 steps).** The overhead of spawning a "
    "sub-agent outweighs the benefit for trivial operations.\n\n"
    "### When TO delegate\n\n"
    "- Multi-step, independent tasks that produce a deliverable (analysis, "
    "synthesis, generated content) you will incorporate into your response.\n"
    "- Parallel exploration of genuinely different areas of a codebase or "
    "knowledge base when context isolation helps.\n"
    "- Tasks that benefit from a separate context window (e.g., long "
    "document summarization that would crowd your own context).\n\n"
    "### Delegation best practices\n\n"
    "- When delegating, specify the **deliverable** you need — not "
    '"read these files and give me the contents."\n'
    "- You MUST reference and synthesize sub-agent results in your "
    "response. If you spawn a sub-agent, its output must visibly "
    "influence your answer.\n"
    "- Each sub-agent consumes tokens and time. Prefer doing work "
    "directly over delegating. Only delegate when context isolation "
    "or parallelism genuinely helps the user.\n"
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
