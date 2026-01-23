#!/usr/bin/env python3
"""
Bootstrap a new project following the Next Project Framework.
This script creates the folder structure and populates initial documentation.
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional


class ProjectBootstrapper:
    """Handles creation of new project structure and documentation."""
    
    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self.projects_dir = repo_root / "_projects"
        self.templates_dir = self.projects_dir / "tools" / "projects" / "templates"
        
    def create_project(self, config: Dict[str, str]) -> Path:
        """Create a new project with the given configuration."""
        # Prefix the project name with today's date in YYYYMMDD format
        date_prefix = datetime.now().strftime("%Y%m%d")
        original_name = config["name"]
        
        # Create month folder (YYYY-MM format)
        month_folder = datetime.now().strftime("%Y-%m")
        month_path = self.projects_dir / month_folder
        month_path.mkdir(parents=True, exist_ok=True)
        
        # Determine the next sequence number for projects created today
        sequence_num = self._get_next_sequence_number(month_path, date_prefix)
        
        # Build project name with date prefix and sequence number
        project_name = f"{date_prefix}.{sequence_num:02d}.{original_name}"
        
        # Update config with the prefixed name
        config["name"] = project_name
        
        # Project goes inside the month folder
        project_path = month_path / project_name
        
        # Check if project already exists (should not happen with sequence numbers)
        if project_path.exists():
            print(f"Error: Project '{project_name}' already exists at {project_path}", file=sys.stderr)
            sys.exit(1)
            
        # Create project structure
        self._create_folder_structure(project_path)
        
        # Generate documentation files
        self._create_readme(project_path, config)
        self._create_initial_task(project_path, config)
        self._create_next_task_prompt(project_path, config)
        
        print(f"✅ Successfully created project: {project_path}")
        return project_path
    
    def _get_next_sequence_number(self, month_path: Path, date_prefix: str) -> int:
        """Determine the next sequence number for projects created today."""
        if not month_path.exists():
            return 1
        
        # Find all projects with today's date prefix
        existing_projects = []
        for item in month_path.iterdir():
            if item.is_dir() and item.name.startswith(date_prefix):
                # Extract sequence number if present
                # Expected format: YYYYMMDD.NN.project-name
                parts = item.name.split('.')
                if len(parts) >= 3 and parts[1].isdigit():
                    existing_projects.append(int(parts[1]))
        
        # Return next sequence number
        if existing_projects:
            return max(existing_projects) + 1
        return 1
    
    def _create_folder_structure(self, project_path: Path) -> None:
        """Create the standard folder structure for a project."""
        folders = [
            "tasks",
            "checkpoints",
            "design-decisions",
            "coding-guidelines",
            "wrong-assumptions",
            "dont-dos"
        ]
        
        project_path.mkdir(parents=True, exist_ok=True)
        
        for folder in folders:
            (project_path / folder).mkdir(exist_ok=True)
            # Create .gitkeep files to ensure empty folders are tracked
            gitkeep = project_path / folder / ".gitkeep"
            gitkeep.touch()
            
    def _create_readme(self, project_path: Path, config: Dict[str, str]) -> None:
        """Create the project README with project information."""
        template = self._load_template("project_readme.md")
        
        # Format dependencies and risks for display
        dependencies = config.get("dependencies", "None identified")
        if dependencies.lower() in ["none", "n/a", ""]:
            dependencies = "None identified"
            
        risks = config.get("risks", "None identified") 
        if risks.lower() in ["none", "n/a", ""]:
            risks = "None identified"
            
        # Prepare success criteria as bullet points
        success_criteria = config.get("success_criteria", "")
        if success_criteria:
            success_lines = [f"- {line.strip()}" for line in success_criteria.split(",")]
            success_criteria = "\n".join(success_lines)
        else:
            success_criteria = "- Project goals achieved\n- All tests passing\n- Documentation updated"
        
        content = template.format(
            project_name=config["name"],
            project_description=config["description"],
            created_date=datetime.now().strftime("%Y-%m-%d"),
            project_goal=config["goal"],
            project_timeline=config["timeline"],
            project_tech=config["tech"],
            project_type=config["type"].replace("-", " ").title(),
            project_components=config["components"],
            dependencies=dependencies,
            success_criteria=success_criteria,
            risks=risks
        )
        
        (project_path / "README.md").write_text(content)
        
        
    def _create_initial_task(self, project_path: Path, config: Dict[str, str]) -> None:
        """Create the initial task plan based on project type."""
        template = self._load_template(f"initial_task_{config['type']}.md")
        
        # Fall back to generic template if specific one doesn't exist
        if not template:
            template = self._load_template("initial_task_generic.md")
            
        content = template.format(
            project_name=config["name"],
            project_goal=config["goal"],
            project_tech=config["tech"],
            project_components=config["components"],
            created_date=datetime.now().strftime("%Y-%m-%d %H:%M")
        )
        
        (project_path / "tasks" / "T01_0_plan.md").write_text(content)
    
    def _create_next_task_prompt(self, project_path: Path, config: Dict[str, str]) -> None:
        """Create the next-task.md file with actual project paths."""
        
        # Get absolute paths for all project folders
        abs_project_path = project_path.absolute()
        
        content = f"""# Next Task: {config["name"]}

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: {config["name"]}

**Description**: {config["description"]}
**Goal**: {config["goal"]}
**Tech Stack**: {config["tech"]}
**Components**: {config["components"]}

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
{abs_project_path}/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
{abs_project_path}/tasks/
```

### 3. Project Documentation
- **README**: `{abs_project_path}/README.md`

## Knowledge Folders to Check

### Design Decisions
```
{abs_project_path}/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
{abs_project_path}/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
{abs_project_path}/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
{abs_project_path}/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `{abs_project_path}/checkpoints/`
2. [ ] Check current task status in `{abs_project_path}/tasks/`
3. [ ] Review any new design decisions in `{abs_project_path}/design-decisions/`
4. [ ] Check coding guidelines in `{abs_project_path}/coding-guidelines/`
5. [ ] Review lessons learned in `{abs_project_path}/wrong-assumptions/` and `{abs_project_path}/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: {datetime.now().strftime("%Y-%m-%d %H:%M")}
**Current Task**: T01 (Initial Setup)
**Status**: Planning

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
"""
        
        (project_path / "next-task.md").write_text(content)
        
    def _load_template(self, template_name: str) -> Optional[str]:
        """Load a template file, returning None if it doesn't exist."""
        template_path = self.templates_dir / template_name
        
        if not template_path.exists():
            # Return a basic fallback for essential templates
            if template_name == "project_readme.md":
                return self._get_fallback_readme_template()
            elif template_name.startswith("initial_task"):
                return self._get_fallback_task_template()
            return None
            
        return template_path.read_text()
    
    def _get_fallback_readme_template(self) -> str:
        """Provide a fallback README template."""
        return """# Project: {project_name}

## Overview
{project_description}

**Created**: {created_date}

## Project Information

### Goal
{project_goal}

### Timeline
{project_timeline}

### Technology Stack
{project_tech}

### Project Type
{project_type}

### Affected Components
{project_components}

## Dependencies
{dependencies}

## Success Criteria
{success_criteria}

## Known Risks
{risks}

## Status

### Current Phase
Planning and Setup

### Last Updated
{created_date}

## Quick Links
- [Next Task](next-task.md) - Drop this file into chat to resume
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Notes
This project follows the Next Project Framework for structured multi-day development.

To resume work: Simply drag and drop the `next-task.md` file into your conversation.
"""

    def _get_fallback_task_template(self) -> str:
        """Provide a generic task template."""
        return """# Task T01: Initial Setup and Analysis

**Created**: {created_date}
**Status**: Planning

## Objective
Begin work on {project_goal}

## Approach

### Phase 1: Analysis
1. Examine the current state of {project_components}
2. Identify key areas that need attention
3. Map dependencies and constraints

### Phase 2: Planning
1. Break down the work into manageable subtasks
2. Identify critical path items
3. Establish success metrics

### Phase 3: Implementation Strategy
1. Determine the order of operations
2. Identify potential risks and mitigations
3. Plan for testing and validation

## Technology Considerations
- Stack: {project_tech}
- Components: {project_components}

## Next Steps
1. [ ] Complete initial analysis
2. [ ] Create detailed implementation plan
3. [ ] Set up development environment if needed
4. [ ] Begin first implementation task

## Notes
- This is the initial task plan
- Will be refined based on analysis results
- Feedback will be captured in T01_1_feedback.md
- Execution details will be logged in T01_2_execution.md
"""


def main():
    parser = argparse.ArgumentParser(description="Bootstrap a new Next Project Framework project")
    
    # Required arguments
    parser.add_argument("--name", required=True, help="Project name (kebab-case)")
    parser.add_argument("--description", required=True, help="Brief project description")
    parser.add_argument("--goal", required=True, help="Primary project goal")
    parser.add_argument("--timeline", required=True, help="Target timeline")
    parser.add_argument("--tech", required=True, help="Technology stack")
    parser.add_argument("--type", required=True, 
                       choices=["feature-development", "refactoring", "migration", 
                               "bug-fix", "optimization", "research", "other"],
                       help="Project type")
    parser.add_argument("--components", required=True, help="Affected components")
    
    # Optional arguments
    parser.add_argument("--dependencies", default="None", help="External dependencies")
    parser.add_argument("--success-criteria", required=True, help="Success criteria")
    parser.add_argument("--risks", default="None", help="Known risks")
    
    args = parser.parse_args()
    
    # Find repo root
    try:
        repo_root = Path(os.popen("git rev-parse --show-toplevel").read().strip())
    except:
        repo_root = Path.cwd()
        
    # Create configuration dictionary
    config = {
        "name": args.name,
        "description": args.description,
        "goal": args.goal,
        "timeline": args.timeline,
        "tech": args.tech,
        "type": args.type,
        "components": args.components,
        "dependencies": args.dependencies,
        "success_criteria": args.success_criteria,
        "risks": args.risks
    }
    
    # Bootstrap the project
    bootstrapper = ProjectBootstrapper(repo_root)
    project_path = bootstrapper.create_project(config)
    
    # Output summary
    print(f"\n📁 Project structure created at: {project_path}")
    print(f"📅 Project name: {config['name']} (automatically prefixed with date)")
    print("\n📝 Created files:")
    print("  - README.md (project overview and goals)")
    print("  - next-task.md (quick resume file - drag into chat)")
    print("  - tasks/T01_0_plan.md (initial task plan)")
    print("\n📂 Created folders:")
    print("  - checkpoints/ (for milestone summaries)")
    print("  - design-decisions/ (for architectural choices)")
    print("  - coding-guidelines/ (for project standards)")
    print("  - wrong-assumptions/ (for corrected misconceptions)")
    print("  - dont-dos/ (for anti-patterns to avoid)")
    print("\n✨ Project is ready! Next steps:")
    print(f"  1. Review the task plan at {project_path}/tasks/T01_0_plan.md")
    print(f"  2. To resume in a new session: Drag {project_path}/next-task.md into chat")
    print(f"  3. Or continue working in the current session")


if __name__ == "__main__":
    main()