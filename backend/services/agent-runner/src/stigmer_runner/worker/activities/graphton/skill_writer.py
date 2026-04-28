"""Utilities for writing skills to a workspace.

Follows the Agent Skills specification (https://agentskills.io/specification)
progressive disclosure model:

1. **Metadata (startup)** -- skill ``name`` + ``description`` are injected
   into the system prompt so the agent knows which skills are available.
2. **Instructions (activation)** -- the agent reads ``SKILL.md`` from the
   filesystem when it decides to activate a skill.
3. **Resources (on demand)** -- scripts, references, and assets are loaded
   by the agent only when required.

Path Convention:
- Skills live under ``.stigmer/skills/{name}/`` relative to the workspace root.
- When the virtual platform mount (AD-01 v3) is active, the backend routes
  ``.stigmer/*`` to an external platform directory — skills physically live
  outside the workspace, but the agent sees them at ``.stigmer/skills/``.
- Returned paths are always **workspace-relative** (e.g. ``.stigmer/skills/my-skill``)
  so that the agent's sandbox backend resolves them correctly regardless of
  whether it uses chroot-like semantics or the Daytona SDK working directory.

Directory Structure:
- .stigmer/skills/{name}/SKILL.md - Interface definition (required)
- .stigmer/skills/{name}/scripts/ - Executable scripts (optional)
- .stigmer/skills/{name}/references/ - Reference documentation (optional)
- .stigmer/skills/{name}/assets/ - Static resources (optional)
"""

from __future__ import annotations

import io
import logging
import zipfile
from typing import TYPE_CHECKING

from ai.stigmer.agentic.skill.v1.api_pb2 import Skill

if TYPE_CHECKING:
    from stigmer_runner.worker.workspace.backend import WorkspaceBackend

logger = logging.getLogger(__name__)

_SKILLS_RELATIVE_BASE = ".stigmer/skills"

_SCRIPT_EXTENSIONS = frozenset((".sh", ".py", ".js", ".ts", ".rb", ".pl"))


class SkillWriter:
    """Writes skills to a workspace via :class:`WorkspaceBackend`.

    Following the Agent Skills specification:
    - Skills are written to ``.stigmer/skills/{name}/`` within the workspace
    - Only skill metadata (name + description + location) is injected into
      the system prompt; the agent reads SKILL.md on demand
    - Skills directory is read-only to prevent accidental modification
    """

    SKILLS_BASE_DIR = "/.stigmer/skills"

    def __init__(self, *, backend: WorkspaceBackend) -> None:
        self._backend = backend

    # ------------------------------------------------------------------
    # Skill directory naming
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_skill_dir_name(skill: Skill) -> str:
        """Return a human-readable directory name for the skill.

        Uses ``skill.metadata.name`` (the Agent Skills spec ``name``
        field, e.g. ``skill-creator``) because it is short, unique
        within scope, and meaningful to both humans and LLMs.

        Falls back to ``version_hash`` and then ``slug`` when the name
        is absent.
        """
        name = skill.metadata.name
        if name:
            return name

        if skill.status.version_hash:
            logger.warning(
                "Skill has no metadata.name; falling back to version_hash: %s",
                skill.status.version_hash,
            )
            return skill.status.version_hash

        slug_key = skill.metadata.slug.replace("/", "_")
        logger.warning(
            "Skill has neither metadata.name nor version_hash; "
            "falling back to slug: %s",
            slug_key,
        )
        return slug_key

    def _get_skill_relative_dir(self, skill: Skill) -> str:
        """Return the **workspace-relative** skill directory.

        Example return value: ``bin/skills/skill-creator``
        """
        return f"{_SKILLS_RELATIVE_BASE}/{self._resolve_skill_dir_name(skill)}"

    # ------------------------------------------------------------------
    # Path computation (no I/O)
    # ------------------------------------------------------------------

    @staticmethod
    def compute_skill_paths(skills: list[Skill]) -> dict[str, str]:
        """Compute workspace-relative skill paths without writing anything.

        Produces the same ``{skill_id: workspace_relative_dir}`` mapping
        as :meth:`write_skills` but without I/O.  Used on the
        resume-after-approval fast path.
        """
        paths: dict[str, str] = {}
        for skill in skills:
            name = skill.metadata.name
            if not name:
                name = skill.status.version_hash or skill.metadata.slug.replace("/", "_")
            paths[skill.metadata.id] = f"{_SKILLS_RELATIVE_BASE}/{name}"
        return paths

    # ------------------------------------------------------------------
    # Write skills (unified — all I/O through WorkspaceBackend)
    # ------------------------------------------------------------------

    def write_skills(
        self,
        skills: list[Skill],
        artifacts: dict[str, bytes] | None = None,
    ) -> dict[str, str]:
        """Write skills to the workspace.

        Creates ``bin/skills/{name}/`` for each skill, writes
        ``SKILL.md``, and optionally extracts artifact ZIP files.

        Args:
            skills: List of Skill proto messages.
            artifacts: Optional dict mapping skill ID to artifact ZIP
                bytes.

        Returns:
            Dictionary mapping skill ID to **workspace-relative**
            directory path.

        Raises:
            RuntimeError: If directory creation or file write fails.
        """
        if not skills:
            logger.info("No skills to write")
            return {}

        skill_paths: dict[str, str] = {}
        all_files: list[tuple[str, bytes]] = []
        dirs_to_make_executable: list[str] = []

        for skill in skills:
            skill_id = skill.metadata.id
            relative_dir = self._get_skill_relative_dir(skill)
            skill_paths[skill_id] = relative_dir

            if artifacts and skill_id in artifacts:
                extracted = self._extract_zip_in_memory(
                    artifacts[skill_id], relative_dir, skill.metadata.name,
                )
                all_files.extend(extracted)
                dirs_to_make_executable.append(relative_dir)
            else:
                all_files.append(
                    (f"{relative_dir}/SKILL.md", skill.spec.skill_md.encode("utf-8"))
                )

        try:
            self._backend.mkdir(_SKILLS_RELATIVE_BASE)
            for rel_dir in skill_paths.values():
                self._backend.mkdir(rel_dir)

            self._backend.write_files(all_files)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to write skills to workspace: {exc}"
            ) from exc

        for rel_dir in dirs_to_make_executable:
            self._make_scripts_executable(rel_dir)

        logger.info(
            "Successfully wrote %d skills: %s",
            len(skills),
            [s.metadata.name for s in skills],
        )
        return skill_paths

    # ------------------------------------------------------------------
    # Artifact extraction (in-memory)
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_zip_in_memory(
        artifact_bytes: bytes,
        relative_dir: str,
        skill_name: str,
    ) -> list[tuple[str, bytes]]:
        """Extract a skill artifact ZIP in memory.

        Returns a list of ``(rel_path, content)`` tuples ready for
        ``backend.write_files()``.

        Raises:
            RuntimeError: If the ZIP is invalid.
        """
        try:
            with zipfile.ZipFile(io.BytesIO(artifact_bytes)) as zf:
                files: list[tuple[str, bytes]] = []
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    rel_path = f"{relative_dir}/{info.filename}"
                    files.append((rel_path, zf.read(info)))
                logger.info(
                    "Extracted %d files from artifact for skill %s",
                    len(files),
                    skill_name,
                )
                return files
        except zipfile.BadZipFile as exc:
            raise RuntimeError(
                f"Invalid ZIP artifact for skill {skill_name}: {exc}"
            ) from exc
        except Exception as exc:
            raise RuntimeError(
                f"Failed to extract artifact for skill {skill_name}: {exc}"
            ) from exc

    def _make_scripts_executable(self, relative_dir: str) -> None:
        """``chmod +x`` script files within a skill directory."""
        extensions = " -o ".join(
            f"-name '*{ext}'" for ext in sorted(_SCRIPT_EXTENSIONS)
        )
        cmd = (
            f"find {relative_dir} -type f "
            f"\\( {extensions} \\) "
            f"-exec chmod +x {{}} \\;"
        )
        result = self._backend.execute(cmd, timeout=10)
        if result.exit_code != 0:
            logger.warning(
                "Failed to make scripts executable in %s: %s",
                relative_dir,
                result.stdout or result.stderr,
            )

    # ------------------------------------------------------------------
    # Prompt generation (static — no backend dependency)
    # ------------------------------------------------------------------

    @staticmethod
    def generate_prompt_section(
        skills: list[Skill], skill_paths: dict[str, str],
    ) -> str:
        """Generate system-prompt section following the Agent Skills spec.

        Implements the *progressive disclosure* model: only metadata
        (name + description + location) is injected.  The agent reads
        SKILL.md on demand.

        Args:
            skills: List of Skill proto messages.
            skill_paths: Dictionary mapping skill ID to workspace-relative
                directory path.

        Returns:
            Markdown section to append to the system prompt, or ``""``
            when *skills* is empty.
        """
        if not skills:
            return ""

        def _dir_for(skill: Skill) -> str:
            return skill_paths.get(
                skill.metadata.id,
                f"{_SKILLS_RELATIVE_BASE}/{skill.metadata.name}",
            )

        lines: list[str] = [
            "",
            "",
            "## Available Skills",
            "",
            "The following skills are pre-installed in your workspace.",
            "To use a skill, read its SKILL.md file at the listed location.",
            "After reading skill files, do not reprint their contents "
            "-- use them to guide your actions.",
            "",
            "**CRITICAL**: If you cannot read the skill files at the listed "
            "paths, you MUST stop execution immediately and report the error. "
            "Do NOT attempt to create, recreate, or improvise skill "
            "implementations on your own. Missing skill files indicate a "
            "platform issue that must be resolved before execution can "
            "proceed.",
            "",
            f"**Workspace rule**: The `{_SKILLS_RELATIVE_BASE}/` directory "
            "is read-only platform infrastructure managed by the Stigmer "
            "runtime. Do not write, modify, or create files inside it. "
            "When creating new files, write them relative to the workspace "
            "root (e.g. `my-output/file.md`, not "
            f"`{_SKILLS_RELATIVE_BASE}/my-output/file.md`).",
            "",
            "### Working with Skill Files",
            "",
            "Skills reference their own files using relative paths "
            "(e.g. `scripts/run.py`, `references/schema.md`). "
            "Resolve them from the skill's **Location** directory for all "
            "operations:",
            "",
            "`read {location}/references/schema.md`",
            '`execute("python3 {location}/scripts/run.py")`',
            "",
        ]

        for skill in skills:
            skill_dir = _dir_for(skill)
            description = skill.spec.description or "(no description)"

            lines.append(f"### {skill.metadata.name}")
            lines.append(f"**Description**: {description}")
            lines.append(f"**Location**: `{skill_dir}/`")
            lines.append(f"**Activate**: `read {skill_dir}/SKILL.md`")
            lines.append("")

        return "\n".join(lines)

    @staticmethod
    def generate_also_available_section(
        excluded_names: list[str],
    ) -> str:
        """Generate a brief note listing skills excluded by relevance filtering.

        The agent can still request these skills by name if it
        determines they are needed mid-conversation.

        Args:
            excluded_names: Alphabetically sorted names of excluded skills.

        Returns:
            Markdown fragment to append after the main skills section,
            or ``""`` when *excluded_names* is empty.
        """
        if not excluded_names:
            return ""

        names_str = ", ".join(f"`{n}`" for n in excluded_names)
        return (
            "\n### Also Available\n\n"
            f"These skills are installed but were not highlighted above: {names_str}. "
            "If you determine one of them is relevant to your task, "
            "read its SKILL.md at `.stigmer/skills/<name>/SKILL.md` to activate it.\n"
        )
