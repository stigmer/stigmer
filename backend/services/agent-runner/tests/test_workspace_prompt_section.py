"""Unit tests for workspace prompt section injection.

Tests cover:
- build_workspace_prompt_section: section builder for the ``## Workspace``
  system prompt section derived from provisioning results.
- build_referenced_files_prompt_section: section builder for the
  ``## Referenced Files`` section (workspace-aware file referencing).
- Section ordering within the assembled enhanced prompt.
"""

from __future__ import annotations

from worker.activities.execute_graphton import (
    build_referenced_files_prompt_section,
    build_workspace_prompt_section,
)
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


# =============================================================================
# TestBuildReferencedFilesPromptSection
# =============================================================================


class TestBuildReferencedFilesPromptSection:
    """Tests for build_referenced_files_prompt_section()."""

    def test_returns_empty_string_when_no_refs(self):
        assert build_referenced_files_prompt_section([], "/workspace") == ""

    def test_section_header(self):
        section = build_referenced_files_prompt_section(
            ["src/main.py"], "/workspace",
        )
        assert "## Referenced Files" in section

    def test_contains_workspace_relative_path(self):
        section = build_referenced_files_prompt_section(
            ["src/config.yaml"], "/workspace",
        )
        assert "`src/config.yaml`" in section

    def test_multiple_refs_all_listed(self):
        refs = ["README.md", "src/app.py", "tests/test_app.py"]
        section = build_referenced_files_prompt_section(refs, "/workspace")
        for ref in refs:
            assert f"`{ref}`" in section, f"Missing ref: {ref}"

    def test_includes_file_size_when_file_exists(self, tmp_path):
        test_file = tmp_path / "data.csv"
        test_file.write_text("a,b,c\n1,2,3\n")

        section = build_referenced_files_prompt_section(
            ["data.csv"], str(tmp_path),
        )
        assert "bytes" in section

    def test_graceful_when_file_not_found(self):
        section = build_referenced_files_prompt_section(
            ["nonexistent.txt"], "/does/not/exist",
        )
        assert "`nonexistent.txt`" in section
        assert "bytes" not in section

    def test_starts_with_double_newline_for_concatenation(self):
        section = build_referenced_files_prompt_section(
            ["file.txt"], "/workspace",
        )
        assert section.startswith("\n\n")

    def test_instructs_agent_to_use_read_tool(self):
        section = build_referenced_files_prompt_section(
            ["file.txt"], "/workspace",
        )
        assert "read" in section.lower()

    def test_mixed_existing_and_missing_files(self, tmp_path):
        existing = tmp_path / "exists.txt"
        existing.write_text("hello")

        section = build_referenced_files_prompt_section(
            ["exists.txt", "missing.txt"], str(tmp_path),
        )
        assert "`exists.txt`" in section
        assert "`missing.txt`" in section
        # Only the existing file should show size
        lines = section.strip().split("\n")
        exists_line = [line for line in lines if "exists.txt" in line][0]
        missing_line = [line for line in lines if "missing.txt" in line][0]
        assert "bytes" in exists_line
        assert "bytes" not in missing_line


# =============================================================================
# TestReferencedFilesPromptOrdering
# =============================================================================


class TestReferencedFilesPromptOrdering:
    """Verify ``## Referenced Files`` appears in the correct position
    relative to other prompt sections."""

    @staticmethod
    def _assemble_with_refs(
        instructions: str = "You are a helpful agent.",
        provision_result: ProvisionResult | None = None,
        skills_prompt_section: str = "",
        workspace_file_refs: list[str] | None = None,
        workspace_root: str = "/workspace",
        injected_files: list[dict] | None = None,
    ) -> str:
        """Mirror the updated prompt assembly logic with referenced files."""
        enhanced = instructions

        workspace_section = build_workspace_prompt_section(provision_result)
        if workspace_section:
            enhanced += workspace_section

        if skills_prompt_section:
            enhanced += skills_prompt_section

        if workspace_file_refs:
            ref_section = build_referenced_files_prompt_section(
                workspace_file_refs, workspace_root,
            )
            if ref_section:
                enhanced += ref_section

        if injected_files:
            section = "\n\n## Input Files\n\n"
            for f in injected_files:
                section += f"- `{f['path']}`\n"
            enhanced += section

        enhanced += "\n\n## Response rules\n\nBe concise."
        return enhanced

    def test_referenced_files_before_input_files(self):
        prompt = self._assemble_with_refs(
            provision_result=_local_path_provision(),
            workspace_file_refs=["src/config.yaml"],
            injected_files=[{"path": ".stigmer/inputs/external.csv"}],
        )
        rf_pos = prompt.find("## Referenced Files")
        if_pos = prompt.find("## Input Files")
        assert rf_pos < if_pos, "Referenced Files must appear before Input Files"

    def test_workspace_before_referenced_files(self):
        prompt = self._assemble_with_refs(
            provision_result=_local_path_provision(),
            workspace_file_refs=["README.md"],
        )
        ws_pos = prompt.find("## Workspace")
        rf_pos = prompt.find("## Referenced Files")
        assert ws_pos < rf_pos, "Workspace must appear before Referenced Files"

    def test_referenced_files_before_response_rules(self):
        prompt = self._assemble_with_refs(
            workspace_file_refs=["file.txt"],
        )
        rf_pos = prompt.find("## Referenced Files")
        rr_pos = prompt.find("## Response rules")
        assert rf_pos < rr_pos, "Referenced Files must appear before Response rules"

    def test_no_referenced_files_when_empty(self):
        prompt = self._assemble_with_refs(
            workspace_file_refs=[],
        )
        assert "## Referenced Files" not in prompt
