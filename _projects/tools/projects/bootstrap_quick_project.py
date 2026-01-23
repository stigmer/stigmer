#!/usr/bin/env python3
"""
Bootstrap a new quick project following the Next Quick Project Framework.
This script creates a minimal structure (4 files) for focused, 1-2 session projects.
"""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional


class QuickProjectBootstrapper:
    """Handles creation of quick project structure and documentation."""
    
    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self.projects_dir = repo_root / "_projects"
        self.templates_dir = self.projects_dir / "tools" / "projects" / "templates" / "quick"
        
    def create_project(self, config: Dict[str, str]) -> Path:
        """Create a new quick project with the given configuration."""
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
            
        # Create project directory (no subfolders for quick projects!)
        project_path.mkdir(parents=True, exist_ok=True)
        
        # Generate the 4 core files
        self._create_readme(project_path, config)
        self._create_tasks(project_path, config)
        self._create_notes(project_path, config)
        self._create_next_task(project_path, config)
        
        print(f"✅ Successfully created quick project: {project_path}")
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
    
    def _create_readme(self, project_path: Path, config: Dict[str, str]) -> None:
        """Create the project README with project information."""
        template = self._load_template("quick_project_readme.md")
        
        # Parse estimated time
        estimated_time = config.get("estimated_time", "1-4 hours")
        
        # Prepare success criteria
        success_criteria = config.get("success_criteria", "")
        if success_criteria:
            success_lines = [f"- {line.strip()}" for line in success_criteria.split(";")]
            success_criteria = "\n".join(success_lines)
        else:
            success_criteria = "- Goal achieved\n- Tests passing\n- Changes validated"
        
        content = template.format(
            project_name=config["name"],
            project_description=config["description"],
            created_date=datetime.now().strftime("%Y-%m-%d"),
            estimated_time=estimated_time,
            project_goal=config["goal"],
            project_tech=config["tech"],
            project_components=config["components"],
            success_criteria=success_criteria
        )
        
        (project_path / "README.md").write_text(content)
    
    def _create_tasks(self, project_path: Path, config: Dict[str, str]) -> None:
        """Create the tasks.md file with task breakdown."""
        template = self._load_template("quick_tasks.md")
        
        # Parse tasks if provided
        tasks_input = config.get("tasks", "")
        if tasks_input:
            task_list = [t.strip() for t in tasks_input.split(";") if t.strip()]
        else:
            # Generate default tasks based on common patterns
            task_list = self._suggest_tasks(config)
        
        # Build task sections
        task_sections = []
        for i, task in enumerate(task_list, 1):
            status = "🚧 IN PROGRESS" if i == 1 else "⏸️ TODO"
            task_sections.append(f"""## Task {i}: {task}

**Status**: {status}
**Created**: {datetime.now().strftime("%Y-%m-%d %H:%M")}

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]
""")
        
        tasks_content = "\n".join(task_sections)
        
        content = template.format(
            project_name=config["name"],
            created_date=datetime.now().strftime("%Y-%m-%d"),
            tasks=tasks_content
        )
        
        (project_path / "tasks.md").write_text(content)
    
    def _create_notes(self, project_path: Path, config: Dict[str, str]) -> None:
        """Create the notes.md file for quick learnings."""
        template = self._load_template("quick_notes.md")
        
        content = template.format(
            project_name=config["name"],
            created_date=datetime.now().strftime("%Y-%m-%d")
        )
        
        (project_path / "notes.md").write_text(content)
    
    def _create_next_task(self, project_path: Path, config: Dict[str, str]) -> None:
        """Create the next-task.md file with absolute paths."""
        template = self._load_template("quick_next_task.md")
        
        # Get absolute paths
        abs_project_path = project_path.absolute()
        abs_tasks = abs_project_path / "tasks.md"
        abs_readme = abs_project_path / "README.md"
        abs_notes = abs_project_path / "notes.md"
        
        content = template.format(
            project_name=config["name"],
            project_description=config["description"],
            project_goal=config["goal"],
            project_tech=config["tech"],
            project_components=config["components"],
            created_date=datetime.now().strftime("%Y-%m-%d"),
            abs_project_path=abs_project_path,
            abs_tasks=abs_tasks,
            abs_readme=abs_readme,
            abs_notes=abs_notes
        )
        
        (project_path / "next-task.md").write_text(content)
    
    def _suggest_tasks(self, config: Dict[str, str]) -> List[str]:
        """Suggest default tasks based on tech stack and goal."""
        tech = config.get("tech", "").lower()
        goal = config.get("goal", "").lower()
        
        # Pattern matching for common project types
        if "proto" in tech or "buf" in tech or "api" in goal:
            return [
                "Define proto messages and services",
                "Generate stubs for all languages",
                "Update backend handlers",
                "Test with sample requests"
            ]
        elif "bug" in goal or "fix" in goal:
            return [
                "Reproduce and identify root cause",
                "Implement fix",
                "Test and validate"
            ]
        elif "bazel" in tech or "build" in goal:
            return [
                "Identify dependency issue",
                "Update BUILD.bazel files",
                "Validate build succeeds"
            ]
        elif "cli" in tech or "command" in goal:
            return [
                "Design command and flags",
                "Implement with cobra",
                "Add help documentation",
                "Test various scenarios"
            ]
        elif "refactor" in goal:
            return [
                "Analyze current implementation",
                "Refactor with tests",
                "Validate no regressions"
            ]
        elif "ui" in tech or "flutter" in tech or "react" in tech:
            return [
                "Design UI components",
                "Implement core functionality",
                "Add styling",
                "Test user interactions"
            ]
        else:
            # Generic task breakdown
            return [
                "Analysis and design",
                "Core implementation",
                "Testing and validation"
            ]
    
    def _load_template(self, template_name: str) -> str:
        """Load a template file."""
        template_path = self.templates_dir / template_name
        
        if not template_path.exists():
            print(f"Warning: Template {template_name} not found at {template_path}", file=sys.stderr)
            return self._get_fallback_template(template_name)
            
        return template_path.read_text()
    
    def _get_fallback_template(self, template_name: str) -> str:
        """Provide fallback templates if files are missing."""
        if template_name == "quick_project_readme.md":
            return """# {project_name}

## Overview
{project_description}

**Created**: {created_date}  
**Estimated Time**: {estimated_time}  
**Status**: 🚧 In Progress

## Goal
{project_goal}

## Technology Stack
{project_tech}

## Affected Components
{project_components}

## Success Criteria
{success_criteria}

## Quick Links
- [Tasks](tasks.md) - Task breakdown and progress
- [Notes](notes.md) - Quick notes and learnings
- [Resume](next-task.md) - **Drag this into chat to resume!**

## Project Type
⚡ **Quick Project** - Designed to complete in 1-2 sessions with minimal overhead.

## Status Summary

Update this as you make progress:
- Current phase: [Analysis/Implementation/Testing/Complete]
- Blockers: [None/List any blockers]
- Next up: [What's next]

---

*This project follows the Next Quick Project Framework for fast, focused development.*
"""
        elif template_name == "quick_tasks.md":
            return """# Tasks: {project_name}

**Created**: {created_date}

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

{tasks}

## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!
"""
        elif template_name == "quick_notes.md":
            return """# Notes: {project_name}

**Created**: {created_date}

---

## Quick Notes

Add timestamped notes as you work. Capture:
- Important decisions and rationale
- Gotchas discovered
- Useful commands or snippets
- Things to remember

---

### Example Note Format

#### {created_date} HH:MM - Topic

Quick description of what happened or what you learned.

---

## Notes

[Add your notes below with timestamps]

"""
        elif template_name == "quick_next_task.md":
            return """# Next Task: {project_name}

## 🎯 Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

---

## Project Overview

**Name**: {project_name}  
**Description**: {project_description}  
**Goal**: {project_goal}  
**Tech Stack**: {project_tech}  
**Components**: {project_components}

**Created**: {created_date}  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
{abs_project_path}
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
{abs_tasks}
```

### 📖 Project README
```
{abs_readme}
```

### 📝 Quick Notes
```
{abs_notes}
```

---

## Resume Checklist

1. [ ] Open tasks.md and check current task status
2. [ ] Review any recent notes in notes.md
3. [ ] Continue with the current task or move to next

---

## Quick Commands

After loading this file:
- "Show current status" - Get overview of all tasks
- "Continue with current task" - Resume work
- "What's next?" - Move to next task
- "Add a note" - Capture a learning
- "Complete project" - Final wrap-up

---

*Quick Project Framework: Minimal overhead, maximum focus.*
"""
        return ""


def main():
    parser = argparse.ArgumentParser(
        description="Bootstrap a new Quick Project (1-2 sessions, minimal overhead)"
    )
    
    # Required arguments
    parser.add_argument("--name", required=True, 
                       help="Project name (kebab-case, e.g., 'fix-auth-bug')")
    parser.add_argument("--description", required=True, 
                       help="Brief project description (1-2 sentences)")
    parser.add_argument("--goal", required=True, 
                       help="Primary project goal")
    parser.add_argument("--tech", required=True, 
                       help="Technology stack (e.g., 'Go/Bazel', 'Proto/Buf')")
    parser.add_argument("--components", required=True, 
                       help="Affected components or areas")
    
    # Optional arguments
    parser.add_argument("--tasks", default="", 
                       help="Semicolon-separated task list (e.g., 'Task 1;Task 2;Task 3')")
    parser.add_argument("--estimated-time", default="1-4 hours", 
                       help="Estimated completion time")
    parser.add_argument("--success-criteria", default="", 
                       help="Semicolon-separated success criteria")
    
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
        "tech": args.tech,
        "components": args.components,
        "tasks": args.tasks,
        "estimated_time": args.estimated_time,
        "success_criteria": args.success_criteria
    }
    
    # Bootstrap the project
    bootstrapper = QuickProjectBootstrapper(repo_root)
    project_path = bootstrapper.create_project(config)
    
    # Output summary
    print(f"\n📁 Quick project structure created at: {project_path}")
    print(f"📅 Project name: {config['name']} (automatically prefixed with date)")
    print("\n⚡ Created files (just 4!):")
    print("  - README.md (project overview)")
    print("  - next-task.md (quick resume file - drag into chat!)")
    print("  - tasks.md (all tasks in one file)")
    print("  - notes.md (quick notes)")
    print("\n✨ Quick project is ready! Next steps:")
    print(f"  1. Review the task breakdown at {project_path}/tasks.md")
    print(f"  2. To resume later: Drag {project_path}/next-task.md into chat")
    print(f"  3. Start working immediately!")
    print("\n💡 Quick Project = Fast structure, not heavy process")


if __name__ == "__main__":
    main()
