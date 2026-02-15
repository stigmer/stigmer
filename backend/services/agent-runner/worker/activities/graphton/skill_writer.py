"""Utilities for writing skills to sandbox.

Skill Injection Strategy (from ADR 001):
- Skills are written to {workspace_root}/bin/skills/{version_hash}/ in the sandbox
- The SKILL.md content is injected directly into the system prompt
- The LOCATION header tells the agent where executable files are located
- This allows agents to access skill implementations without reading files

Path Convention:
- Skills live under ``bin/skills/{version_hash}/`` relative to the workspace root.
- In Daytona mode the workspace root is queried from the sandbox via
  ``sandbox.get_work_dir()`` (typically ``/workspace``).  All shell commands
  and SDK file operations use the fully-qualified path
  ``{workspace_root}/bin/skills/{version_hash}/``.
- In local mode the workspace root is the ``local_root`` passed to the
  constructor (e.g. ``/tmp/stigmer-sandbox``).
- Returned paths are always **workspace-relative** (e.g. ``bin/skills/abc…``)
  so that the agent's sandbox backend resolves them correctly regardless of
  whether it uses chroot-like semantics or the Daytona SDK working directory.

Directory Structure:
- bin/skills/{version_hash}/SKILL.md - Interface definition
- bin/skills/{version_hash}/* - Executable implementation files (from artifact ZIP)
"""

import io
import logging
import os
import zipfile

from ai.stigmer.agentic.skill.v1.api_pb2 import Skill

logger = logging.getLogger(__name__)

# Workspace-relative base directory for skills (no leading slash).
_SKILLS_RELATIVE_BASE = "bin/skills"


class SkillWriter:
    """Writes skills to sandbox (Daytona or local filesystem).
    
    Following ADR 001: Skill Injection & Sandbox Mounting Strategy:
    - Skills are mounted at bin/skills/{version_hash}/ within the workspace
    - SKILL.md content is injected into the system prompt with LOCATION header
    - Skills directory is read-only to prevent accidental modification
    """
    
    # Kept for backward-compatibility references; new code should use
    # ``_SKILLS_RELATIVE_BASE`` instead.
    SKILLS_BASE_DIR = "/bin/skills"
    
    def __init__(self, sandbox=None, local_root: str | None = None):
        """Initialize SkillWriter.
        
        Args:
            sandbox: Daytona Sandbox instance (for cloud mode).  The workspace
                root is resolved automatically via ``sandbox.get_work_dir()``.
            local_root: Local filesystem root (for local mode, e.g.,
                ``/tmp/stigmer-sandbox``).
        """
        self.sandbox = sandbox
        self.local_root = local_root
        self.skills_base = self.SKILLS_BASE_DIR
    
    @staticmethod
    def _resolve_version_hash(skill: Skill) -> str:
        """Return the version hash for a skill, falling back to a slug-based key."""
        version_hash = skill.status.version_hash
        if not version_hash:
            version_hash = skill.metadata.slug.replace("/", "_")
            logger.warning(
                "Skill %s has no version_hash, using slug: %s",
                skill.metadata.name,
                version_hash,
            )
        return version_hash

    def _get_skill_relative_dir(self, skill: Skill) -> str:
        """Return the **workspace-relative** skill directory.

        Example return value: ``bin/skills/abc123…``  (no leading ``/``).

        This is the canonical path that will be handed to the agent in the
        prompt LOCATION header and used for post-write verification through
        the agent's sandbox backend.
        """
        return f"{_SKILLS_RELATIVE_BASE}/{self._resolve_version_hash(skill)}"
    
    def write_skills(self, skills: list[Skill], artifacts: dict[str, bytes] | None = None) -> dict[str, str]:
        """Write skills to sandbox.
        
        Creates ``bin/skills/{version_hash}/`` for each skill (relative to
        the workspace root), writes ``SKILL.md``, and optionally extracts
        artifact ZIP files.
        
        Args:
            skills: List of Skill proto messages
            artifacts: Optional dict mapping skill ID to artifact ZIP bytes
            
        Returns:
            Dictionary mapping skill ID to **workspace-relative** directory
            path (e.g. ``{"skill-uuid-1": "bin/skills/abc123…"}``).
            
        Raises:
            RuntimeError: If directory creation or file upload fails
        """
        if not skills:
            logger.info("No skills to write")
            return {}
        
        skill_paths = {}
        
        if self.local_root:
            # Local mode - write to filesystem
            skill_paths = self._write_skills_local(skills, artifacts)
        elif self.sandbox:
            # Cloud mode - upload to Daytona sandbox
            skill_paths = self._write_skills_daytona(skills, artifacts)
        else:
            raise RuntimeError("No sandbox or local_root configured")
        
        return skill_paths
    
    def _write_skills_local(self, skills: list[Skill], artifacts: dict[str, bytes] | None = None) -> dict[str, str]:
        """Write skills to local filesystem.
        
        Returns workspace-relative paths (no leading ``/``) so they work
        correctly with ``FilesystemBackend._resolve_sandbox_path()`` and
        with the ``execute`` tool where ``cwd=root_dir``.
        
        Args:
            skills: List of Skill proto messages
            artifacts: Optional dict mapping skill ID to artifact ZIP bytes
            
        Returns:
            Dictionary mapping skill ID to workspace-relative directory path
            (e.g. ``{"skill-uuid": "bin/skills/abc123..."}``)
        """
        skill_paths: dict[str, str] = {}
        
        for skill in skills:
            skill_id = skill.metadata.id
            relative_dir = self._get_skill_relative_dir(skill)
            
            # Absolute path on the host: {local_root}/bin/skills/{version_hash}/
            local_skill_dir = os.path.join(self.local_root, relative_dir)  # type: ignore[arg-type]
            
            try:
                os.makedirs(local_skill_dir, exist_ok=True)
                
                if artifacts and skill_id in artifacts:
                    logger.info("Extracting artifact for skill %s", skill.metadata.name)
                    self._extract_artifact_local(artifacts[skill_id], local_skill_dir)
                else:
                    # Write SKILL.md only if no artifact (backward compatibility)
                    skill_md_path = os.path.join(local_skill_dir, "SKILL.md")
                    with open(skill_md_path, "w", encoding="utf-8") as f:
                        f.write(skill.spec.skill_md)
                    logger.info("Wrote SKILL.md to local filesystem: %s", skill_md_path)
                
                # Workspace-relative path for the agent
                skill_paths[skill_id] = relative_dir
                
            except Exception as e:
                raise RuntimeError(
                    f"Failed to write skill {skill.metadata.name} to local filesystem: {e}"
                ) from e
        
        logger.info(
            "Successfully wrote %d skills to local filesystem: %s",
            len(skills),
            [s.metadata.name for s in skills],
        )
        
        return skill_paths
    
    def _extract_artifact_local(self, artifact_bytes: bytes, target_dir: str) -> None:
        """Extract skill artifact ZIP to local filesystem.
        
        Args:
            artifact_bytes: ZIP file content as bytes
            target_dir: Target directory path (e.g., /tmp/stigmer-sandbox/bin/skills/abc123/)
            
        Raises:
            RuntimeError: If extraction fails
        """
        try:
            with zipfile.ZipFile(io.BytesIO(artifact_bytes)) as zf:
                # Extract all files
                zf.extractall(target_dir)
                
                # Make scripts executable
                for root, dirs, files in os.walk(target_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        # Make files executable if they have a shebang or known script extension
                        if file_path.endswith(('.sh', '.py', '.js', '.ts', '.rb', '.pl')):
                            os.chmod(file_path, 0o755)
                
                logger.info(f"Extracted artifact to {target_dir}")
                
        except zipfile.BadZipFile as e:
            raise RuntimeError(f"Invalid ZIP file: {e}") from e
        except Exception as e:
            raise RuntimeError(f"Failed to extract artifact: {e}") from e
    
    # ------------------------------------------------------------------
    # Daytona helpers
    # ------------------------------------------------------------------

    def _resolve_workspace_root(self) -> str:
        """Return the absolute workspace root inside the Daytona sandbox.

        The value is obtained from ``sandbox.get_work_dir()`` and cached on
        the instance.  A trailing ``/`` is stripped so callers can safely
        concatenate with ``/{relative_path}``.

        Falls back to ``/home/daytona`` (standard Daytona user home) if
        ``get_work_dir()`` is not available on older SDK versions.
        """
        cached = getattr(self, "_workspace_root", None)
        if cached is not None:
            return cached  # type: ignore[return-value]

        try:
            root = self.sandbox.get_work_dir().rstrip("/")
            logger.info("Daytona workspace root resolved: %s", root)
        except Exception as exc:
            root = "/home/daytona"
            logger.warning(
                "sandbox.get_work_dir() failed (%s); falling back to %s",
                exc,
                root,
            )
        self._workspace_root: str = root
        return root

    def _write_skills_daytona(
        self,
        skills: list[Skill],
        artifacts: dict[str, bytes] | None = None,
    ) -> dict[str, str]:
        """Write skills to Daytona sandbox.

        All paths use the workspace root obtained from
        ``sandbox.get_work_dir()`` so that the agent's backend (which
        resolves paths relative to the same workspace root) can find them.

        Returns workspace-relative paths (e.g. ``bin/skills/abc…``) that
        the agent can use directly with its ``read`` / ``ls`` / ``execute``
        tools.

        Args:
            skills: List of Skill proto messages
            artifacts: Optional dict mapping skill ID to artifact ZIP bytes

        Returns:
            Dictionary mapping skill ID to workspace-relative directory path
        """
        from daytona import FileUpload

        ws_root = self._resolve_workspace_root()

        # Absolute base for skills inside the sandbox:
        # e.g. /workspace/bin/skills
        abs_skills_base = f"{ws_root}/{_SKILLS_RELATIVE_BASE}"

        # Step 1: Create base skills directory
        mkdir_cmd = f"mkdir -p {abs_skills_base}"
        try:
            result = self.sandbox.process.exec(mkdir_cmd, timeout=5)
            if result.exit_code != 0:
                raise RuntimeError(
                    f"Failed to create skills base directory: {result.output}"
                )
            logger.info("Created skills base directory: %s", abs_skills_base)
        except Exception as e:
            raise RuntimeError(f"Failed to create skills base directory: {e}") from e

        # Step 2: Prepare file uploads and per-skill state
        file_uploads: list = []
        skill_paths: dict[str, str] = {}
        # Collect absolute skill dirs that need to be created
        abs_skill_dirs: set[str] = set()

        for skill in skills:
            skill_id = skill.metadata.id
            relative_dir = self._get_skill_relative_dir(skill)
            abs_dir = f"{ws_root}/{relative_dir}"
            abs_skill_dirs.add(abs_dir)

            # Agent-facing path is workspace-relative
            skill_paths[skill_id] = relative_dir

            if artifacts and skill_id in artifacts:
                # Upload artifact ZIP for later extraction
                file_uploads.append(
                    FileUpload(
                        source=artifacts[skill_id],
                        destination=f"{abs_dir}/artifact.zip",
                    )
                )
            else:
                # Upload SKILL.md only (backward compatibility / no artifact)
                file_uploads.append(
                    FileUpload(
                        source=skill.spec.skill_md.encode("utf-8"),
                        destination=f"{abs_dir}/SKILL.md",
                    )
                )

        # Step 3: Create per-skill directories
        for abs_dir in abs_skill_dirs:
            mkdir_cmd = f"mkdir -p {abs_dir}"
            try:
                result = self.sandbox.process.exec(mkdir_cmd, timeout=5)
                if result.exit_code != 0:
                    raise RuntimeError(
                        f"Failed to create skill directory {abs_dir}: {result.output}"
                    )
            except Exception as e:
                raise RuntimeError(
                    f"Failed to create skill directory {abs_dir}: {e}"
                ) from e

        # Step 4: Batch upload all files
        try:
            self.sandbox.fs.upload_files(file_uploads)
            logger.info(
                "Successfully uploaded files for %d skills to Daytona: %s",
                len(skills),
                [s.metadata.name for s in skills],
            )
        except Exception as e:
            raise RuntimeError(
                f"Failed to upload skills to Daytona sandbox: {e}"
            ) from e

        # Step 5: Extract artifacts if provided
        if artifacts:
            for skill in skills:
                skill_id = skill.metadata.id
                if skill_id in artifacts:
                    relative_dir = self._get_skill_relative_dir(skill)
                    abs_dir = f"{ws_root}/{relative_dir}"
                    logger.info("Extracting artifact for skill %s", skill.metadata.name)
                    self._extract_artifact_daytona(abs_dir)

        return skill_paths
    
    def _extract_artifact_daytona(self, skill_dir: str) -> None:
        """Extract skill artifact ZIP in Daytona sandbox.
        
        Args:
            skill_dir: Absolute skill directory path inside the sandbox
                (e.g. ``/workspace/bin/skills/abc123…``).
            
        Raises:
            RuntimeError: If extraction fails
        """
        # Extract using unzip command in sandbox
        extract_cmd = f"cd {skill_dir} && unzip -o artifact.zip && rm artifact.zip"
        
        try:
            result = self.sandbox.process.exec(extract_cmd, timeout=30)
            if result.exit_code != 0:
                raise RuntimeError(
                    f"Failed to extract artifact in {skill_dir}: {result.output}"
                )
            
            # Make scripts executable
            chmod_cmd = f"find {skill_dir} -type f \\( -name '*.sh' -o -name '*.py' -o -name '*.js' -o -name '*.ts' -o -name '*.rb' -o -name '*.pl' \\) -exec chmod +x {{}} \\;"
            result = self.sandbox.process.exec(chmod_cmd, timeout=10)
            if result.exit_code != 0:
                logger.warning(f"Failed to make scripts executable in {skill_dir}: {result.output}")
            
            logger.info(f"Extracted artifact in Daytona sandbox: {skill_dir}")
            
        except Exception as e:
            raise RuntimeError(f"Failed to extract artifact in sandbox: {e}") from e
    
    @staticmethod
    def generate_prompt_section(skills: list[Skill], skill_paths: dict[str, str]) -> str:
        """Generate system prompt section with full skill content.
        
        Following ADR 001: Skill Injection Strategy
        - Injects full SKILL.md content into the prompt
        - Includes LOCATION header for each skill (path to executable files)
        - Provides clear access instructions so the agent uses paths directly
          instead of exploring the filesystem
        
        Args:
            skills: List of Skill proto messages
            skill_paths: Dictionary mapping skill ID to directory path
            
        Returns:
            Markdown section to append to system prompt
        """
        if not skills:
            return ""
        
        # -----------------------------------------------------------------
        # Preamble: teach the agent how to access skills
        # -----------------------------------------------------------------
        prompt = "\n\n## Available Skills\n\n"
        prompt += (
            "Skills are pre-installed in your workspace. "
            "Each skill section below lists its LOCATION (directory path). "
            "Use that path directly to read files, run scripts, or reference "
            "resources. Do NOT explore the filesystem to discover skill files; "
            "the paths below are authoritative.\n\n"
            "**CRITICAL**: If you cannot read the skill files at the LOCATION "
            "paths listed below, you MUST stop execution immediately and "
            "report the error. Do NOT attempt to create, recreate, or "
            "improvise skill implementations on your own. Missing skill "
            "files indicate a platform issue that must be resolved before "
            "execution can proceed.\n"
        )
        
        # -----------------------------------------------------------------
        # Quick-reference table (concise, at the top for scanability)
        # -----------------------------------------------------------------
        def _dir_for(skill: Skill) -> str:
            """Return the skill directory from ``skill_paths`` or a fallback."""
            return skill_paths.get(
                skill.metadata.id,
                f"{_SKILLS_RELATIVE_BASE}/{skill.status.version_hash}",
            )

        if len(skills) == 1:
            skill = skills[0]
            skill_dir = _dir_for(skill)
            prompt += (
                f"\n**Skill directory**: `{skill_dir}/`\n"
                f"  - Read a file:  `read {skill_dir}/SKILL.md`\n"
                f"  - Run a script: `execute python3 {skill_dir}/scripts/<name>.py`\n"
                f"  - List contents: `ls {skill_dir}/`\n"
            )
        else:
            prompt += "\n| Skill | Directory |\n|---|---|\n"
            for skill in skills:
                prompt += f"| {skill.metadata.name} | `{_dir_for(skill)}/` |\n"
            prompt += "\n"
        
        # -----------------------------------------------------------------
        # Per-skill sections: access block + full SKILL.md body
        # -----------------------------------------------------------------
        for skill in skills:
            skill_dir = _dir_for(skill)
            
            prompt += f"\n### SKILL: {skill.metadata.name}\n"
            prompt += f"LOCATION: `{skill_dir}/`\n\n"
            prompt += skill.spec.skill_md
            prompt += "\n"
        
        return prompt
