# Project Management Tools

This directory contains tools and scripts for managing projects in the Stigmer OSS repository following the Next Project Framework.

## Overview

The Next Project Framework provides structured project management for both multi-day projects and quick projects. These tools automate the creation of project structures with appropriate documentation templates.

## Directory Structure

```
_projects/tools/
├── projects/
│   ├── bootstrap_project.py           # Creates full multi-day projects
│   ├── bootstrap_quick_project.py     # Creates lightweight quick projects
│   └── templates/
│       ├── project_readme.md          # README template for full projects
│       ├── initial_task_*.md          # Task templates by project type
│       ├── checkpoint_template.md     # Checkpoint documentation template
│       ├── design_decision_template.md # Design decision template
│       ├── task_review_template.md    # Task review template
│       └── quick/                     # Templates for quick projects
│           ├── quick_project_readme.md
│           ├── quick_tasks.md
│           ├── quick_notes.md
│           └── quick_next_task.md
└── README.md                          # This file
```

## Scripts

### bootstrap_project.py

Creates a comprehensive project structure for multi-day projects (3+ days or complex work).

**Usage:**
```bash
python3 _projects/tools/projects/bootstrap_project.py \
  --name "my-feature" \
  --description "Implement new feature X" \
  --goal "Add functionality Y to component Z" \
  --timeline "1-2 weeks" \
  --tech "Go, gRPC, BadgerDB" \
  --type "feature-development" \
  --components "stigmer-server, CLI" \
  --success-criteria "Feature works, tests pass, docs updated" \
  --dependencies "None" \
  --risks "Integration complexity"
```

**Project Types:**
- `feature-development` - New features
- `refactoring` - Code improvements
- `migration` - Technology migrations
- `bug-fix` - Bug fixes
- `optimization` - Performance improvements
- `research` - Research and exploration
- `other` - Other project types

**Creates:**
```
_projects/YYYY-MM/YYYYMMDD.NN.my-feature/
├── README.md                  # Project overview
├── next-task.md              # Quick resume file
├── tasks/
│   └── T01_0_plan.md        # Initial task plan
├── checkpoints/              # Major milestone summaries
├── design-decisions/         # Architectural choices
├── coding-guidelines/        # Project-specific standards
├── wrong-assumptions/        # Corrected misconceptions
└── dont-dos/                 # Anti-patterns to avoid
```

### bootstrap_quick_project.py

Creates a minimal project structure for quick projects (1-2 sessions, < 4 hours).

**Usage:**
```bash
python3 _projects/tools/projects/bootstrap_quick_project.py \
  --name "fix-auth-bug" \
  --description "Fix authentication timeout issue" \
  --goal "Resolve login failures" \
  --tech "Go, gRPC" \
  --components "stigmer-server auth module" \
  --tasks "1. Investigate timeout, 2. Fix bug, 3. Test"
```

**Creates:**
```
_projects/YYYY-MM/YYYYMMDD.NN.fix-auth-bug/
├── README.md          # Single-page overview
├── next-task.md       # Quick resume file
├── tasks.md           # All tasks in one file
└── notes.md           # Quick notes and learnings
```

## Project Organization

Projects are automatically organized by month with sequence numbers:

```
_projects/
├── 2026-01/                      # January 2026
│   ├── 20260122.01.feature-a/    # First project on Jan 22
│   ├── 20260122.02.bugfix-b/     # Second project on Jan 22
│   └── 20260123.01.research-c/   # First project on Jan 23
└── 2026-02/                      # February 2026
    └── ...
```

**Benefits:**
- Chronological organization
- Easy to find projects by date
- Sequence numbers prevent conflicts
- Natural archiving by month

## Usage from Rules

These tools are referenced in the project management rules:

**Full Projects:**
- `@_projects/_rules/next-stigmer-oss-project/start-stigmer-oss-new-project.mdc`

**Quick Projects:**
- `@_projects/_rules/next-stigmer-oss-quick-project/start-stigmer-oss-quick-project.mdc`

The rules handle interviewing the developer, gathering requirements, and invoking these scripts.

## Templates

### Full Project Templates

- `project_readme.md` - Comprehensive README with all project metadata
- `initial_task_feature-development.md` - Task template for features
- `initial_task_refactoring.md` - Task template for refactoring
- `initial_task_migration.md` - Task template for migrations
- `initial_task_generic.md` - Fallback task template
- `checkpoint_template.md` - Template for milestone checkpoints
- `design_decision_template.md` - Template for architectural decisions
- `task_review_template.md` - Template for task reviews

### Quick Project Templates

- `quick_project_readme.md` - Minimal single-page README
- `quick_tasks.md` - Simple task tracking
- `quick_notes.md` - Quick notes and learnings
- `quick_next_task.md` - Resume file for quick projects

## Customization

To add new templates:

1. Add template file to `templates/` or `templates/quick/`
2. Update the bootstrap script to use the new template
3. Update the rule documentation

## Testing

Test the bootstrap scripts manually:

```bash
# Test full project creation
cd /Users/suresh/scm/github.com/stigmer/stigmer
python3 _projects/tools/projects/bootstrap_project.py \
  --name "test-project" \
  --description "Test project" \
  --goal "Testing" \
  --timeline "1 day" \
  --tech "Go" \
  --type "other" \
  --components "test" \
  --success-criteria "Works" \
  --dependencies "None" \
  --risks "None"

# Test quick project creation
python3 _projects/tools/projects/bootstrap_quick_project.py \
  --name "test-quick" \
  --description "Test quick project" \
  --goal "Testing" \
  --tech "Go" \
  --components "test" \
  --tasks "1. Test"
```

## Related Documentation

- [Next Project Framework Rules](../_rules/next-stigmer-oss-project/)
- [Quick Project Framework Rules](../_rules/next-stigmer-oss-quick-project/)

---

**Location**: `_projects/tools/`  
**Maintained by**: Stigmer OSS contributors  
**Last Updated**: 2026-01-22
