"""Utilities for writing skills to sandbox.

Skill Injection Strategy (from ADR 001):
- Skills are written to /bin/skills/{version_hash}/ in the sandbox
- The SKILL.md content is injected directly into the system prompt
- The LOCATION header tells the agent where executable files are located
- This allows agents to access skill implementations without reading files

Directory Structure:
- /bin/skills/{version_hash}/SKILL.md - Interface definition
- /bin/skills/{version_hash}/* - Executable implementation files (from artifact ZIP)
"""

from ai.stigmer.agentic.skill.v1.api_pb2 import Skill
import logging
import os
import zipfile
import io

logger = logging.getLogger(__name__)


class SkillWriter:
    """Writes skills to sandbox (Daytona or local filesystem).
    
    Following ADR 001: Skill Injection & Sandbox Mounting Strategy:
    - Skills are mounted at /bin/skills/{version_hash}/
    - SKILL.md content is injected into the system prompt with LOCATION header
    - Skills directory is read-only to prevent accidental modification
    """
    
    SKILLS_BASE_DIR = "/bin/skills"
    
    def __init__(self, sandbox=None, local_root: str | None = None):
        """Initialize SkillWriter.
        
        Args:
            sandbox: Daytona Sandbox instance (for cloud mode)
            local_root: Local filesystem root (for local mode, e.g., /tmp/stigmer-sandbox)
        """
        self.sandbox = sandbox
        self.local_root = local_root
        self.skills_base = self.SKILLS_BASE_DIR
    
    def _get_skill_dir(self, skill: Skill) -> str:
        """Get the directory path for a skill based on its version hash.
        
        Args:
            skill: Skill proto message
            
        Returns:
            Path like /bin/skills/{version_hash}/
        """
        version_hash = skill.status.version_hash
        if not version_hash:
            # Fallback to slug if no hash (shouldn't happen in production)
            version_hash = skill.metadata.slug.replace("/", "_")
            logger.warning(f"Skill {skill.metadata.name} has no version_hash, using slug: {version_hash}")
        
        return f"{self.skills_base}/{version_hash}"
    
    def write_skills(self, skills: list[Skill], artifacts: dict[str, bytes] | None = None) -> dict[str, str]:
        """Write skills to sandbox.
        
        Creates /bin/skills/{version_hash}/ for each skill, writes SKILL.md,
        and optionally extracts artifact ZIP files.
        
        Args:
            skills: List of Skill proto messages
            artifacts: Optional dict mapping skill ID to artifact ZIP bytes
            
        Returns:
            Dictionary mapping skill ID to directory path in sandbox:
            {"skill-uuid-1": "/bin/skills/abc123.../", ...}
            
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
        
        Args:
            skills: List of Skill proto messages
            artifacts: Optional dict mapping skill ID to artifact ZIP bytes
            
        Returns:
            Dictionary mapping skill ID to directory path
        """
        skill_paths = {}
        
        for skill in skills:
            skill_id = skill.metadata.id
            skill_dir = self._get_skill_dir(skill)
            
            # Local path: {local_root}/bin/skills/{version_hash}/
            local_skill_dir = f"{self.local_root}{skill_dir}"
            
            try:
                # Create directory
                os.makedirs(local_skill_dir, exist_ok=True)
                
                # Extract artifact if provided
                if artifacts and skill_id in artifacts:
                    logger.info(f"Extracting artifact for skill {skill.metadata.name}")
                    self._extract_artifact_local(artifacts[skill_id], local_skill_dir)
                else:
                    # Write SKILL.md only if no artifact (backward compatibility)
                    skill_md_path = f"{local_skill_dir}/SKILL.md"
                    with open(skill_md_path, 'w', encoding='utf-8') as f:
                        f.write(skill.spec.skill_md)
                    logger.info(f"Wrote SKILL.md to local filesystem: {skill_md_path}")
                
                skill_paths[skill_id] = skill_dir
                
            except Exception as e:
                raise RuntimeError(
                    f"Failed to write skill {skill.metadata.name} to local filesystem: {e}"
                ) from e
        
        logger.info(
            f"Successfully wrote {len(skills)} skills to local filesystem: "
            f"{[s.metadata.name for s in skills]}"
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
    
    def _write_skills_daytona(self, skills: list[Skill], artifacts: dict[str, bytes] | None = None) -> dict[str, str]:
        """Write skills to Daytona sandbox.
        
        Args:
            skills: List of Skill proto messages
            artifacts: Optional dict mapping skill ID to artifact ZIP bytes
            
        Returns:
            Dictionary mapping skill ID to directory path
        """
        from daytona import FileUpload
        
        # Step 1: Create base skills directory
        mkdir_cmd = f"mkdir -p {self.skills_base}"
        try:
            result = self.sandbox.process.exec(mkdir_cmd, timeout=5)
            if result.exit_code != 0:
                raise RuntimeError(
                    f"Failed to create skills base directory: {result.output}"
                )
            logger.info(f"Created skills base directory: {self.skills_base}")
        except Exception as e:
            raise RuntimeError(f"Failed to create skills base directory: {e}") from e
        
        # Step 2: Prepare file uploads and artifacts
        file_uploads = []
        skill_paths = {}
        skill_dirs = set()
        
        for skill in skills:
            skill_id = skill.metadata.id
            skill_dir = self._get_skill_dir(skill)
            skill_dirs.add(skill_dir)
            skill_paths[skill_id] = skill_dir
            
            # If artifact provided, upload ZIP and extract it
            # Otherwise, just upload SKILL.md (backward compatibility)
            if artifacts and skill_id in artifacts:
                # Upload artifact ZIP for extraction
                artifact_zip_path = f"{skill_dir}/artifact.zip"
                file_uploads.append(
                    FileUpload(
                        source=artifacts[skill_id],
                        destination=artifact_zip_path
                    )
                )
            else:
                # Upload SKILL.md only (no artifact)
                skill_md_path = f"{skill_dir}/SKILL.md"
                file_uploads.append(
                    FileUpload(
                        source=skill.spec.skill_md.encode('utf-8'),
                        destination=skill_md_path
                    )
                )
        
        # Step 3: Create skill directories
        for skill_dir in skill_dirs:
            mkdir_cmd = f"mkdir -p {skill_dir}"
            try:
                result = self.sandbox.process.exec(mkdir_cmd, timeout=5)
                if result.exit_code != 0:
                    raise RuntimeError(
                        f"Failed to create skill directory {skill_dir}: {result.output}"
                    )
            except Exception as e:
                raise RuntimeError(f"Failed to create skill directory {skill_dir}: {e}") from e
        
        # Step 4: Batch upload all files
        try:
            self.sandbox.fs.upload_files(file_uploads)
            logger.info(
                f"Successfully uploaded files for {len(skills)} skills to Daytona: "
                f"{[s.metadata.name for s in skills]}"
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
                    skill_dir = self._get_skill_dir(skill)
                    logger.info(f"Extracting artifact for skill {skill.metadata.name}")
                    self._extract_artifact_daytona(skill_dir)
        
        return skill_paths
    
    def _extract_artifact_daytona(self, skill_dir: str) -> None:
        """Extract skill artifact ZIP in Daytona sandbox.
        
        Args:
            skill_dir: Skill directory path (e.g., /bin/skills/abc123/)
            
        Raises:
            RuntimeError: If extraction fails
        """
        artifact_zip_path = f"{skill_dir}/artifact.zip"
        
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
        
        Args:
            skills: List of Skill proto messages
            skill_paths: Dictionary mapping skill ID to directory path
            
        Returns:
            Markdown section to append to system prompt
        """
        if not skills:
            return ""
        
        prompt = "\n\n## Available Skills\n\n"
        prompt += "The following skills provide specialized capabilities. "
        prompt += "Each skill includes instructions and executable tools.\n"
        
        for skill in skills:
            skill_id = skill.metadata.id
            skill_name = skill.metadata.name
            skill_dir = skill_paths.get(skill_id, f"/bin/skills/{skill.status.version_hash}")
            
            # ADR format: LOCATION header + full SKILL.md content
            prompt += f"\n### SKILL: {skill_name}\n"
            prompt += f"LOCATION: {skill_dir}/\n\n"
            prompt += skill.spec.skill_md
            prompt += "\n"
        
        return prompt
