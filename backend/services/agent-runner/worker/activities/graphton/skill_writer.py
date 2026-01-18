"""Utilities for writing skills to Daytona sandbox."""

from ai.stigmer.agentic.skill.v1.api_pb2 import Skill
import logging

logger = logging.getLogger(__name__)


class SkillWriter:
    """Writes skills as markdown files to remote Daytona sandbox."""
    
    SKILLS_DIR = "/workspace/skills"
    
    def __init__(self, sandbox):
        """Initialize SkillWriter.
        
        Args:
            sandbox: Daytona Sandbox instance from SandboxManager
        """
        self.sandbox = sandbox
        self.skills_dir = self.SKILLS_DIR
    
    def write_skills(self, skills: list[Skill]) -> dict[str, str]:
        """Write skills as markdown files to remote Daytona sandbox.
        
        Uses Daytona SDK's fs.upload_files() API for batch upload.
        Creates /workspace/skills/ directory and writes each skill as:
        /workspace/skills/<skill-name>.md
        
        Args:
            skills: List of Skill proto messages
            
        Returns:
            Dictionary mapping skill ID to file path in sandbox:
            {"skill-uuid-1": "/workspace/skills/aws-troubleshooting.md", ...}
            
        Raises:
            RuntimeError: If directory creation or file upload fails
        """
        if not skills:
            logger.info("No skills to write")
            return {}
        
        # Step 1: Create /workspace/skills directory via shell command
        mkdir_cmd = f"mkdir -p {self.skills_dir}"
        try:
            result = self.sandbox.process.exec(mkdir_cmd, timeout=5)
            if result.exit_code != 0:
                raise RuntimeError(
                    f"Failed to create skills directory: {result.output}"
                )
            logger.info(f"Created skills directory: {self.skills_dir}")
        except Exception as e:
            raise RuntimeError(f"Failed to create skills directory: {e}") from e
        
        # Step 2: Prepare file uploads (batch operation)
        from daytona import FileUpload
        
        file_uploads = []
        skill_paths = {}
        
        for skill in skills:
            skill_id = skill.metadata.id
            skill_name = skill.metadata.name
            description = skill.spec.description
            content = skill.spec.markdown_content
            
            # Build file content with metadata header
            file_content = f"# {skill_name}\n\n"
            file_content += f"**Description**: {description}\n\n"
            file_content += "---\n\n"
            file_content += content
            
            # Sanitize filename
            filename = f"{skill_name}.md"
            filepath = f"{self.skills_dir}/{filename}"
            
            # Prepare upload (content as bytes)
            file_uploads.append(
                FileUpload(
                    source=file_content.encode('utf-8'),
                    destination=filepath
                )
            )
            
            skill_paths[skill_id] = filepath
        
        # Step 3: Batch upload all skills
        try:
            self.sandbox.fs.upload_files(file_uploads)
            logger.info(
                f"Successfully uploaded {len(skills)} skills: "
                f"{[s.metadata.name for s in skills]}"
            )
        except Exception as e:
            raise RuntimeError(
                f"Failed to upload skills to Daytona sandbox: {e}"
            ) from e
        
        return skill_paths
    
    @staticmethod
    def generate_prompt_section(skills: list[Skill], skill_paths: dict[str, str]) -> str:
        """Generate system prompt section describing available skills.
        
        Args:
            skills: List of Skill proto messages
            skill_paths: Dictionary mapping skill ID to file path
            
        Returns:
            Markdown section to append to system prompt
        """
        if not skills:
            return ""
        
        prompt = "\n\n## Available Skills\n\n"
        prompt += "You have access to the following skills (reusable workflows and best practices). "
        prompt += "Use the `read_file` tool to read full skill content when needed.\n\n"
        
        for skill in skills:
            skill_id = skill.metadata.id
            skill_name = skill.metadata.name
            description = skill.spec.description
            filepath = skill_paths.get(skill_id, f"/workspace/skills/{skill_name}.md")
            
            prompt += f"### {skill_name}\n"
            prompt += f"**Description**: {description}\n"
            prompt += f"**File**: `{filepath}`\n\n"
        
        prompt += "**Usage**: When you need guidance on these topics, use `read_file` to read the skill content.\n"
        
        return prompt
