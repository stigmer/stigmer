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
    
    def write_skills(self, skills: list[Skill]) -> dict[str, str]:
        """Write skills to sandbox.
        
        Creates /bin/skills/{version_hash}/ for each skill and writes SKILL.md.
        
        Args:
            skills: List of Skill proto messages
            
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
            skill_paths = self._write_skills_local(skills)
        elif self.sandbox:
            # Cloud mode - upload to Daytona sandbox
            skill_paths = self._write_skills_daytona(skills)
        else:
            raise RuntimeError("No sandbox or local_root configured")
        
        return skill_paths
    
    def _write_skills_local(self, skills: list[Skill]) -> dict[str, str]:
        """Write skills to local filesystem.
        
        Args:
            skills: List of Skill proto messages
            
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
                
                # Write SKILL.md
                skill_md_path = f"{local_skill_dir}/SKILL.md"
                with open(skill_md_path, 'w', encoding='utf-8') as f:
                    f.write(skill.spec.skill_md)
                
                skill_paths[skill_id] = skill_dir
                logger.info(f"Wrote skill to local filesystem: {skill_md_path}")
                
            except Exception as e:
                raise RuntimeError(
                    f"Failed to write skill {skill.metadata.name} to local filesystem: {e}"
                ) from e
        
        logger.info(
            f"Successfully wrote {len(skills)} skills to local filesystem: "
            f"{[s.metadata.name for s in skills]}"
        )
        
        return skill_paths
    
    def _write_skills_daytona(self, skills: list[Skill]) -> dict[str, str]:
        """Write skills to Daytona sandbox.
        
        Args:
            skills: List of Skill proto messages
            
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
        
        # Step 2: Prepare file uploads (batch operation)
        file_uploads = []
        skill_paths = {}
        skill_dirs = set()
        
        for skill in skills:
            skill_id = skill.metadata.id
            skill_dir = self._get_skill_dir(skill)
            skill_dirs.add(skill_dir)
            
            # Write SKILL.md to {skill_dir}/SKILL.md
            skill_md_path = f"{skill_dir}/SKILL.md"
            
            file_uploads.append(
                FileUpload(
                    source=skill.spec.skill_md.encode('utf-8'),
                    destination=skill_md_path
                )
            )
            
            skill_paths[skill_id] = skill_dir
        
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
        
        # Step 4: Batch upload all skill files
        try:
            self.sandbox.fs.upload_files(file_uploads)
            logger.info(
                f"Successfully uploaded {len(skills)} skills to Daytona: "
                f"{[s.metadata.name for s in skills]}"
            )
        except Exception as e:
            raise RuntimeError(
                f"Failed to upload skills to Daytona sandbox: {e}"
            ) from e
        
        return skill_paths
    
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
