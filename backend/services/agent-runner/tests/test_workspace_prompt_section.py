"""Unit tests for workspace prompt section injection.

Tests cover:
- build_workspace_prompt_section: section builder for the ``## Workspace``
  system prompt section derived from provisioning results.
- Section ordering within the assembled enhanced prompt.
"""

from __future__ import annotations

from worker.activities.execute_graphton import build_workspace_prompt_section
from worker.workspace.provisioner import (
    GitMetadata,
    ProvisionResult,
    SourceType,
)

# =============================================================================
# Helpers
# =============================================================================


def _git_provision(
    url: str = "https://github.com/acme/my-app",
    branch: str = "main",
    commit: str = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
) -> ProvisionResult:
    """Build a ``ProvisionResult`` for a git-repo workspace."""
    short_sha = commit[:7]
    return ProvisionResult(
        root_dir="/workspace",
        source_type=SourceType.GIT_REPO,
        consumed_keys=("GITHUB_TOKEN",),
        workspace_description=(
            f"Your workspace has been initialized from: {url} "
            f"(branch: {branch}, commit: {short_sha})\n"
            "Use your file system tools (ls, read, glob, grep) to explore the codebase.\n"
            "Start by listing the root directory to understand the project structure.\n\n"
            "Changes you make will be captured as artifacts when execution completes."
        ),
        git_metadata=GitMetadata(
            repo_url=url,
            branch=branch,
            base_commit=commit,
        ),
    )


def _local_path_provision(path: str = "/Users/dev/my-project") -> ProvisionResult:
    """Build a ``ProvisionResult`` for a local-path workspace."""
    return ProvisionResult(
        root_dir=path,
        source_type=SourceType.LOCAL_PATH,
        consumed_keys=(),
        workspace_description=(
            f"Your workspace is the user's project directory: {path}\n"
            "IMPORTANT: You are operating directly on the user's files. "
            "Changes are immediate and persistent.\n"
            "Use git to track and verify your changes before finalizing."
        ),
    )


def _empty_provision() -> ProvisionResult:
    """Build a ``ProvisionResult`` for an empty workspace."""
    return ProvisionResult(
        root_dir="/workspace",
        source_type=SourceType.EMPTY,
        consumed_keys=(),
        workspace_description=(
            "Your workspace is empty. "
            "Create files and directories as needed for your task."
        ),
    )


# =============================================================================
# TestBuildWorkspacePromptSection — core function tests
# =============================================================================


class TestBuildWorkspacePromptSection:
    """Tests for build_workspace_prompt_section()."""

    def test_returns_empty_string_when_provision_result_is_none(self):
        assert build_workspace_prompt_section(None) == ""

    def test_returns_empty_string_when_description_is_empty(self):
        result = ProvisionResult(
            root_dir="/workspace",
            source_type=SourceType.EMPTY,
            consumed_keys=(),
            workspace_description="",
        )
        assert build_workspace_prompt_section(result) == ""

    def test_section_header_for_git_repo(self):
        section = build_workspace_prompt_section(_git_provision())
        assert section.startswith("\n\n## Workspace\n\n")

    def test_git_repo_includes_repo_url(self):
        url = "https://github.com/acme/my-app"
        section = build_workspace_prompt_section(_git_provision(url=url))
        assert url in section

    def test_git_repo_includes_branch(self):
        section = build_workspace_prompt_section(_git_provision(branch="develop"))
        assert "develop" in section

    def test_git_repo_includes_short_commit(self):
        section = build_workspace_prompt_section(
            _git_provision(commit="deadbeef1234567890abcdef1234567890abcdef")
        )
        assert "deadbee" in section

    def test_local_path_includes_directory(self):
        path = "/Users/dev/my-project"
        section = build_workspace_prompt_section(_local_path_provision(path))
        assert path in section

    def test_local_path_includes_persistence_warning(self):
        section = build_workspace_prompt_section(_local_path_provision())
        assert "immediate and persistent" in section

    def test_empty_workspace_content(self):
        section = build_workspace_prompt_section(_empty_provision())
        assert "workspace is empty" in section.lower()

    def test_section_starts_with_double_newline_for_concatenation(self):
        """The section must start with \\n\\n so it concatenates cleanly
        after the base instructions string."""
        for factory in (_git_provision, _local_path_provision, _empty_provision):
            section = build_workspace_prompt_section(factory())
            assert section.startswith("\n\n"), (
                f"Section from {factory.__name__} must start with \\n\\n"
            )


# =============================================================================
# TestPromptAssemblyOrdering — section ordering within the enhanced prompt
# =============================================================================


class TestPromptAssemblyOrdering:
    """Verify ``## Workspace`` appears before skills and input files
    when the prompt is assembled using the same pattern as
    execute_graphton._execute_graphton_impl."""

    @staticmethod
    def _assemble(
        instructions: str = "You are a helpful agent.",
        provision_result: ProvisionResult | None = None,
        skills_prompt_section: str = "",
        injected_files: list[dict] | None = None,
    ) -> str:
        """Mirror the prompt assembly logic from execute_graphton.py."""
        enhanced = instructions

        workspace_section = build_workspace_prompt_section(provision_result)
        if workspace_section:
            enhanced += workspace_section

        if skills_prompt_section:
            enhanced += skills_prompt_section

        if injected_files:
            section = "\n\n## Input Files\n\n"
            for f in injected_files:
                section += f"- `{f['path']}`\n"
            enhanced += section

        enhanced += "\n\n## Response rules\n\nBe concise."
        return enhanced

    def test_workspace_before_skills(self):
        prompt = self._assemble(
            provision_result=_git_provision(),
            skills_prompt_section="\n\n## Available Skills\n\n- skill-a",
        )
        ws_pos = prompt.find("## Workspace")
        sk_pos = prompt.find("## Available Skills")
        assert ws_pos < sk_pos, "Workspace must appear before skills"

    def test_workspace_before_input_files(self):
        prompt = self._assemble(
            provision_result=_git_provision(),
            injected_files=[{"path": ".stigmer/inputs/data.csv"}],
        )
        ws_pos = prompt.find("## Workspace")
        if_pos = prompt.find("## Input Files")
        assert ws_pos < if_pos, "Workspace must appear before input files"

    def test_workspace_before_response_rules(self):
        prompt = self._assemble(provision_result=_git_provision())
        ws_pos = prompt.find("## Workspace")
        rr_pos = prompt.find("## Response rules")
        assert ws_pos < rr_pos, "Workspace must appear before response rules"

    def test_no_workspace_when_provision_result_is_none(self):
        prompt = self._assemble(provision_result=None)
        assert "## Workspace" not in prompt

    def test_instructions_preserved_when_no_provisioning(self):
        instructions = "You are a helpful agent."
        prompt = self._assemble(
            instructions=instructions,
            provision_result=None,
        )
        assert prompt.startswith(instructions)

    def test_instructions_precede_workspace(self):
        instructions = "You are a helpful agent."
        prompt = self._assemble(
            instructions=instructions,
            provision_result=_git_provision(),
        )
        instr_pos = prompt.find(instructions)
        ws_pos = prompt.find("## Workspace")
        assert instr_pos < ws_pos, "Instructions must precede workspace"
