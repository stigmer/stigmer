# Next Task: 20260410.02.curated-skills-marketplace

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260410.02.curated-skills-marketplace

**Description**: Expand seedpack skills from 3 meta-authoring skills to ~18 curated, general-purpose skills by vendoring from anthropics/skills (Apache 2.0) and self-composing key domain skills aligned with the platform-for-platforms positioning.
**Goal**: Populate the skills marketplace with general-purpose, high-quality skills that demonstrate Pillar 1 (Knows Your Business): vendor 6-10 skills from anthropics/skills, self-compose 5 original domain skills (customer-support, code-reviewer, technical-writer, data-analyst, research-analyst), and create composite agents that pair skills with MCP servers.
**Tech Stack**: Markdown (SKILL.md), YAML (Agent definitions), Shell (vendor scripts), Python (skill scripts)
**Components**: stigmer/seedpack/skills, stigmer/seedpack/agents, stigmer/seedpack/tools/vendor-sources.json, stigmer/seedpack/tools/01_vendor_skill.sh

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.02.curated-skills-marketplace/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-10
**Status**: In Progress -- Task 1 complete, Task 2 next
**Last Session**: 2026-04-10 -- Completed Task 1 (vendoring skills)

## Session Progress (2026-04-10)

- Completed full license audit of all 17 skills in `anthropics/skills`
- Confirmed document skills (docx, pdf, pptx, xlsx) are source-available -- NOT redistributable
- Discovered `doc-coauthoring` has no license file -- skipped, tracked as follow-up
- Added `canvas-design` and `frontend-design` to vendor list (not in original plan, both Apache 2.0)
- Fixed bug in `01_vendor_skill.sh` -- `cd` into temp dir caused multi-skill vendoring to fail (replaced with `git -C`)
- Vendored 7 new skills + re-vendored `skill-creator` at latest commit (`12ab35c2`)
- All 8 skills verified: SKILL.md, LICENSE.txt, provenance.json present and correct
- Note: `canvas-design` includes 5.5 MB of font files -- accepted for now, optimize later

## Next Steps

1. **Start Task 2**: Self-compose 5 domain skills (customer-support, code-reviewer, technical-writer, data-analyst, research-analyst)
2. **Start Task 3**: Create composite agents pairing skills with MCP servers (depends on Tasks 1-2 + MCP marketplace project)

## Context for Resume

- Changes from Task 1 are uncommitted in working tree on `main` -- user is managing commit timing alongside other work
- The vendor script bug fix (`git -C` instead of `cd`) should be included in whatever commit covers seedpack changes
- `canvas-design` has ~80 .ttf font files (5.5 MB) embedded via the vendor -- future optimization candidate (on-demand download vs embedding)
- `doc-coauthoring` follow-up: revisit if/when Anthropic adds a LICENSE.txt to that skill directory

## Blockers

- None for Task 2 (self-composed skills are independent)
- Task 3 depends on curated MCP marketplace project (`20260410.01`) landing first for agent YAML `mcp_server_usages` references

## Task Breakdown (3 tasks, each = 1 conversation)

### Task 1: Vendor Skills from `anthropics/skills` + License Check -- COMPLETE
**Repo**: stigmer
- Vendored 7 Apache 2.0 skills: webapp-testing, claude-api, internal-comms, brand-guidelines, web-artifacts-builder, canvas-design, frontend-design
- Skipped doc-coauthoring (no license), document skills (non-redistributable)
- Re-vendored skill-creator at latest commit
- Fixed multi-skill vendoring bug in `01_vendor_skill.sh`
- All pinned to commit `12ab35c2eb5668c95810e6a6066f40f4218adc39`
- Changes uncommitted -- user managing commit timing

### Task 2: Self-Compose 5 Domain Skills
**Repo**: stigmer
- Write 5 original SKILL.md skills: customer-support, code-reviewer, technical-writer, data-analyst, research-analyst
- Each with SKILL.md + references/ directory
- Match quality bar of Anthropic vendored skills

### Task 3: Create Composite Agents + Test
**Repo**: stigmer
- Create 4 agent YAML files pairing skills with MCP servers: support-agent, code-review-agent, docs-agent, research-agent
- Test seedpack apply

## Quick Commands

After loading context:
- "Start Task 2" -- begin self-composing domain skills
- "Start Task 3" -- begin creating composite agents
- "Show project status" -- overview of progress

## Key References

- **Detailed plan**: `_projects/2026-04/20260410.02.curated-skills-marketplace/tasks/T01_0_plan.md`
- **Brainstorm plan**: `_cursor/plans/curated_skills_marketplace_59b7afd1.plan.md`
- **Session checkpoint**: `_projects/2026-04/20260410.02.curated-skills-marketplace/checkpoints/2026-04-10-session-1.md`
- **Existing skills**: `seedpack/skills/` (10 skills total: 3 original + 7 vendored)
- **Vendor script**: `seedpack/tools/01_vendor_skill.sh`
- **Vendor sources**: `seedpack/tools/vendor-sources.json`
- **Anthropic skills repo**: `https://github.com/anthropics/skills`
- **Companion MCP project**: `_projects/2026-04/20260410.01.curated-mcp-marketplace/`

---

*Drop this file into a new conversation to resume work on this project.*
