#!/usr/bin/env python3
"""
Bootstrap a sub-project linked to a parent project following the Next Project Framework.
Creates the sub-project under _projects/YYYY-MM/ with an "sp." marker in the name,
generates bidirectional links between parent and sub-project, and inherits context
from the parent's README.md.
"""

import argparse
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Tuple


class SubProjectBootstrapper:
    """Handles creation of sub-project structure and bidirectional parent linking."""

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self.projects_dir = repo_root / "_projects"

    def create_sub_project(self, config: Dict[str, str]) -> Path:
        """Create a new sub-project linked to a parent project."""
        parent_path = Path(config["parent_path"])
        if not parent_path.exists():
            print(f"Error: Parent project not found at {parent_path}", file=sys.stderr)
            sys.exit(1)

        parent_name = parent_path.name
        original_name = config["name"]

        # Create month folder (YYYY-MM format)
        month_folder = datetime.now().strftime("%Y-%m")
        month_path = self.projects_dir / month_folder
        month_path.mkdir(parents=True, exist_ok=True)

        # Determine date prefix and next sequence number
        date_prefix = datetime.now().strftime("%Y%m%d")
        sequence_num = self._get_next_sequence_number(month_path, date_prefix)

        # Build sub-project name with sp. marker
        sub_project_name = f"{date_prefix}.{sequence_num:02d}.sp.{original_name}"
        sub_project_path = month_path / sub_project_name

        if sub_project_path.exists():
            print(f"Error: Sub-project '{sub_project_name}' already exists at {sub_project_path}", file=sys.stderr)
            sys.exit(1)

        # Inherit fields from parent README
        inherited = self._inherit_from_parent(parent_path)

        # Merge config with inherited fields
        full_config = {
            **config,
            "sub_project_name": sub_project_name,
            "parent_name": parent_name,
            "tech": inherited.get("tech", "Inherited from parent"),
            "project_type": inherited.get("project_type", "Feature Development"),
            "components": inherited.get("components", "Inherited from parent"),
        }

        # Compute portable paths
        parent_portable = self._to_portable_path(parent_path)
        sub_portable = self._to_portable_path(sub_project_path)
        full_config["parent_portable_path"] = parent_portable
        full_config["sub_portable_path"] = sub_portable

        # Create sub-project structure
        self._create_folder_structure(sub_project_path)
        self._create_readme(sub_project_path, full_config)
        self._create_next_task(sub_project_path, full_config)
        self._create_initial_task(sub_project_path, full_config)

        # Update parent with sub-project link
        self._update_parent_readme(parent_path, full_config)
        self._update_parent_next_task(parent_path, full_config)

        print(f"Successfully created sub-project: {sub_project_path}")
        return sub_project_path

    def _get_next_sequence_number(self, month_path: Path, date_prefix: str) -> int:
        """Determine the next sequence number across ALL projects for today within the month folder."""
        if not month_path.exists():
            return 1

        existing = []
        for item in month_path.iterdir():
            if item.is_dir() and item.name.startswith(date_prefix):
                parts = item.name.split(".")
                if len(parts) >= 3 and parts[1].isdigit():
                    existing.append(int(parts[1]))

        if existing:
            return max(existing) + 1
        return 1

    def _to_portable_path(self, path: Path) -> str:
        """Convert an absolute path to ~/scm/... format for portability."""
        try:
            path_str = str(path)
            scm_parts = path_str.split("/scm/")
            if len(scm_parts) == 2:
                return f"~/scm/{scm_parts[1]}"
        except Exception:
            pass
        return str(path)

    def _inherit_from_parent(self, parent_path: Path) -> Dict[str, str]:
        """Read parent's README.md and extract inheritable fields."""
        readme_path = parent_path / "README.md"
        inherited: Dict[str, str] = {}

        if not readme_path.exists():
            return inherited

        content = readme_path.read_text()

        tech_match = re.search(
            r"###?\s*Technology Stack\s*\n(.+?)(?=\n###?\s|\n## |\Z)",
            content,
            re.DOTALL,
        )
        if tech_match:
            inherited["tech"] = tech_match.group(1).strip()

        type_match = re.search(
            r"###?\s*Project Type\s*\n(.+?)(?=\n###?\s|\n## |\Z)",
            content,
            re.DOTALL,
        )
        if type_match:
            inherited["project_type"] = type_match.group(1).strip()

        comp_match = re.search(
            r"###?\s*Affected Components\s*\n(.+?)(?=\n###?\s|\n## |\Z)",
            content,
            re.DOTALL,
        )
        if comp_match:
            inherited["components"] = comp_match.group(1).strip()

        return inherited

    def _create_folder_structure(self, project_path: Path) -> None:
        """Create the standard folder structure."""
        folders = [
            "tasks",
            "checkpoints",
            "design-decisions",
            "coding-guidelines",
            "wrong-assumptions",
            "dont-dos",
        ]

        project_path.mkdir(parents=True, exist_ok=True)
        for folder in folders:
            (project_path / folder).mkdir(exist_ok=True)
            (project_path / folder / ".gitkeep").touch()

    def _create_readme(self, project_path: Path, config: Dict[str, str]) -> None:
        """Create the sub-project README with parent link."""
        parent_task = config.get("parent_task", "N/A")
        additional_context = config.get("additional_context", "")
        additional_section = ""
        if additional_context:
            additional_section = f"\n### Additional Context\n{additional_context}\n"

        content = f"""# Sub-Project: {config["sub_project_name"]}

## Parent Project

- **Parent**: {config["parent_name"]}
- **Parent Path**: [../../{config["parent_name"]}/](../../{config["parent_name"]}/)
- **Spawned From Task**: {parent_task}

---

## Overview
{config["description"]}

**Created**: {datetime.now().strftime("%Y-%m-%d")}
**Status**: Active

## Sub-Project Information

### Goal
{config["goal"]}

### Technology Stack
{config["tech"]}

### Project Type
{config["project_type"]}

### Affected Components
{config["components"]}
{additional_section}
## Project Structure

This sub-project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (ASK before creating)
- **`design-decisions/`** - Significant architectural choices (ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (ASK before creating)

**Note**: Also check the parent project's knowledge folders for inherited context.

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Progress Tracking
- [x] Sub-project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Sub-project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Parent Project](../../{config["parent_name"]}/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
"""
        (project_path / "README.md").write_text(content)

    def _create_next_task(self, project_path: Path, config: Dict[str, str]) -> None:
        """Create the next-task.md with parent linkage and Rules of Engagement."""
        portable = config["sub_portable_path"]
        parent_portable = config["parent_portable_path"]
        parent_task = config.get("parent_task", "N/A")

        content = f"""# Next Task: {config["sub_project_name"]}

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: {config["parent_name"]}
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: {config["parent_name"]}
**Parent Next Task**: `{parent_portable}/next-task.md`
**Spawned From Task**: {parent_task}

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `{parent_portable}/design-decisions/`
- Parent Coding Guidelines: `{parent_portable}/coding-guidelines/`
- Parent Wrong Assumptions: `{parent_portable}/wrong-assumptions/`
- Parent Don't Dos: `{parent_portable}/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: {config["sub_project_name"]}

**Description**: {config["description"]}
**Goal**: {config["goal"]}
**Tech Stack**: {config["tech"]}
**Components**: {config["components"]}

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
{portable}/checkpoints/
```

### 2. Current Task
```
{portable}/tasks/
```

### 3. Project Documentation
- **README**: `{portable}/README.md`
- **Parent README**: `{parent_portable}/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
{portable}/design-decisions/
{portable}/coding-guidelines/
{portable}/wrong-assumptions/
{portable}/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
{parent_portable}/design-decisions/
{parent_portable}/coding-guidelines/
{parent_portable}/wrong-assumptions/
{parent_portable}/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `{portable}/checkpoints/`
3. [ ] Check current task status in `{portable}/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

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
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
"""
        (project_path / "next-task.md").write_text(content)

    def _create_initial_task(self, project_path: Path, config: Dict[str, str]) -> None:
        """Create the initial task plan."""
        content = f"""# Task T01: Initial Setup and Analysis

**Created**: {datetime.now().strftime("%Y-%m-%d %H:%M")}
**Status**: PENDING REVIEW
**Type**: Sub-Project of {config["parent_name"]}

**This plan requires your review before execution.**

## Objective

{config["goal"]}

## Parent Context

This sub-project was spawned from **{config["parent_name"]}** (task: {config.get("parent_task", "N/A")}).

Review the parent project's task plan and knowledge folders for broader context.

## Approach

### Phase 1: Analysis
1. Review parent project context and relevant task details
2. Examine the current state of the affected components
3. Identify specific requirements for this sub-project
4. Map dependencies and constraints

### Phase 2: Implementation Planning
1. Break down the work into implementable steps
2. Define order of operations
3. Identify what can be done in parallel
4. Plan for testing and validation

### Phase 3: Execution
1. Implement changes following the plan
2. Validate against success criteria
3. Update parent project status on completion

## Technology Considerations
- Stack: {config["tech"]}
- Components: {config["components"]}

## Next Steps
1. [ ] Complete initial analysis
2. [ ] Create detailed implementation plan
3. [ ] Begin implementation
4. [ ] Validate and test
5. [ ] Update parent project on completion

## Review Process

**What happens next**:
1. **You review this plan** - Consider the approach
2. **Provide feedback** - Share any concerns or changes
3. **I'll revise the plan** - Create T01_1_review.md with feedback, then T01_2_revised_plan.md
4. **You approve** - Give explicit approval to proceed
5. **Execution begins** - Implementation tracked in T01_3_execution.md
"""
        (project_path / "tasks" / "T01_0_plan.md").write_text(content)

    def _update_parent_readme(self, parent_path: Path, config: Dict[str, str]) -> None:
        """Append sub-project entry to parent's README.md."""
        readme_path = parent_path / "README.md"
        if not readme_path.exists():
            print(f"Warning: Parent README.md not found at {readme_path}", file=sys.stderr)
            return

        content = readme_path.read_text()
        sub_name = config["sub_project_name"]
        short_name = config["name"]
        description = config["description"]

        table_row = f"| {short_name} | [{sub_name}](../{sub_name}/) | Active | {description} |"

        if "## Sub-Projects" in content:
            content = content.rstrip() + "\n" + table_row + "\n"
        else:
            sub_projects_section = f"""
## Sub-Projects

| Sub-Project | Path | Status | Description |
|-------------|------|--------|-------------|
{table_row}
"""
            content = content.rstrip() + "\n" + sub_projects_section

        readme_path.write_text(content)

    def _update_parent_next_task(self, parent_path: Path, config: Dict[str, str]) -> None:
        """Append sub-project entry to parent's next-task.md."""
        next_task_path = parent_path / "next-task.md"
        if not next_task_path.exists():
            print(f"Warning: Parent next-task.md not found at {next_task_path}", file=sys.stderr)
            return

        content = next_task_path.read_text()
        sub_portable = config["sub_portable_path"]
        description = config["description"]

        entry = f"- `{sub_portable}/next-task.md` - {description}"

        if "## Sub-Projects" in content:
            content = content.rstrip() + "\n" + entry + "\n"
        else:
            sub_section = f"""
## Sub-Projects

Active sub-projects spawned from this project:

{entry}
"""
            if content.rstrip().endswith("---"):
                last_sep_idx = content.rstrip().rfind("---")
                content = content[:last_sep_idx] + sub_section + "\n---\n"
            else:
                content = content.rstrip() + "\n" + sub_section

        next_task_path.write_text(content)


def main():
    parser = argparse.ArgumentParser(
        description="Bootstrap a sub-project linked to a parent project"
    )

    parser.add_argument("--parent-path", required=True, help="Absolute path to parent project directory")
    parser.add_argument("--name", required=True, help="Sub-project name (kebab-case)")
    parser.add_argument("--description", required=True, help="Brief description of the sub-project")
    parser.add_argument("--goal", required=True, help="Primary goal of the sub-project")
    parser.add_argument("--parent-task", default="N/A", help="Parent task that spawned this sub-project (e.g., T01)")
    parser.add_argument("--additional-context", default="", help="Additional context specific to this sub-project")

    args = parser.parse_args()

    # Find repo root
    try:
        repo_root = Path(os.popen("git rev-parse --show-toplevel").read().strip())
    except Exception:
        repo_root = Path.cwd()

    config = {
        "parent_path": args.parent_path,
        "name": args.name,
        "description": args.description,
        "goal": args.goal,
        "parent_task": args.parent_task,
        "additional_context": args.additional_context,
    }

    bootstrapper = SubProjectBootstrapper(repo_root)
    sub_project_path = bootstrapper.create_sub_project(config)

    print(f"\n  Sub-project created at: {sub_project_path}")
    parent_name = Path(args.parent_path).name
    print(f"  Parent project: {parent_name}")
    print(f"\n  Created files:")
    print(f"  - README.md (with parent link)")
    print(f"  - next-task.md (with parent knowledge folder paths)")
    print(f"  - tasks/T01_0_plan.md (initial task plan)")
    print(f"\n  Updated parent files:")
    print(f"  - {parent_name}/README.md (added sub-project to table)")
    print(f"  - {parent_name}/next-task.md (added sub-project entry)")
    print(f"\n  Next steps:")
    print(f"  1. Review the task plan at {sub_project_path}/tasks/T01_0_plan.md")
    print(f"  2. To resume: Drag {sub_project_path}/next-task.md into chat")


if __name__ == "__main__":
    main()
