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
**Status**: ALL 3 TASKS COMPLETE -- Ready for end-to-end testing
**Last Session**: 2026-04-10 -- Completed Task 3 (composite domain agents)
**Active Task**: None -- all implementation complete, pending live validation

## Session Progress (2026-04-10, Session 1)

- Completed full license audit of all 17 skills in `anthropics/skills`
- Confirmed document skills (docx, pdf, pptx, xlsx) are source-available -- NOT redistributable
- Discovered `doc-coauthoring` has no license file -- skipped, tracked as follow-up
- Added `canvas-design` and `frontend-design` to vendor list (not in original plan, both Apache 2.0)
- Fixed bug in `01_vendor_skill.sh` -- `cd` into temp dir caused multi-skill vendoring to fail (replaced with `git -C`)
- Vendored 7 new skills + re-vendored `skill-creator` at latest commit (`12ab35c2`)
- All 8 skills verified: SKILL.md, LICENSE.txt, provenance.json present and correct
- Note: `canvas-design` includes 5.5 MB of font files -- accepted for now, optimize later

## Session Progress (2026-04-10, Session 2)

- Established structural pattern for self-composed domain skills: SKILL.md + references/ directory, consistent anatomy (frontmatter, workflow steps, key principles, reference file table)
- Made two scoping decisions before writing: (1) research-analyst focused on systematic methodology and source evaluation, not general summarization; (2) data-analyst focused on analytical thinking and insight communication, not computation
- Self-composed 5 domain skills with 15 files total:
  - **customer-support** (SKILL.md + escalation-framework.md + conversation-patterns.md) -- 4-step methodology: assess, gather, resolve, close
  - **code-reviewer** (SKILL.md + review-checklist.md + feedback-patterns.md) -- 5-step methodology: understand, verify correctness, assess quality, evaluate risk, deliver feedback
  - **technical-writer** (SKILL.md + document-types.md + clarity-checklist.md) -- 5-step methodology: classify, gather substance, structure, write, self-review
  - **data-analyst** (SKILL.md + analytical-methods.md + visualization-guide.md) -- 5-step methodology: frame question, assess data, analyze, synthesize, communicate
  - **research-analyst** (SKILL.md + source-evaluation.md + report-structure.md) -- 5-step methodology: define question, plan strategy, gather/evaluate, synthesize, present
- All skills passed quality bar: specificity test, actionability test, progressive disclosure test, trigger clarity test, anti-platitude test
- Skills are tool-agnostic by design -- methodology works standalone, tool integration happens at agent layer (Task 3)

## Session Progress (2026-04-10, Session 3)

- Confirmed companion MCP marketplace project (`20260410.01`) has all 3 tasks complete -- 36 curated MCP server YAML files are in place, unblocking Task 3
- Investigated Agent Runner code to understand runtime skill/tool injection -- discovered that `SkillWriter` automatically generates "Available Skills" prompt section and MCP tools are injected as LangGraph tool wrappers, eliminating need for skill activation or tool wiring in agent instructions
- Created 5 composite domain agents pairing skills with MCP servers:
  - **code-review-agent** (code-reviewer skill + GitHub) -- depth over breadth, never approve without explicit request
  - **data-analyst-agent** (data-analyst skill + Postgres) -- inspect schema first, read-only by default
  - **docs-agent** (technical-writer skill + GitHub + Filesystem) -- verify against source code, don't mix document types
  - **support-agent** (customer-support skill + Slack + Linear) -- every conversation gets closure, create tickets for follow-ups
  - **research-agent** (research-analyst skill + Brave Search + Exa + Fetch) -- cross-reference sources, cite specifically, surface contradictions
- Design decisions: lean instructions (~15 lines each) since runtime handles skill activation and tool injection; no `enabled_tools` (use MCP server defaults); no `env_spec` on agents (MCP servers declare their own)
- Cross-agent consistency review passed: all 8 cross-references verified (MCP server slugs + skill slugs), consistent YAML structure, description pattern, instruction tone

## Next Steps

1. **Test end-to-end**: Run `stigmer seedpack apply` to verify all 5 new agents bootstrap correctly alongside existing agents
2. **Merge**: Merge the `feat/curated-mcp-marketplace` branch (contains all 3 tasks: vendored skills, self-composed skills, composite agents, plus 36 curated MCP servers)
3. **Verify marketplace UX**: Check that agents appear in the marketplace with correct descriptions and skill/MCP server references

## Context for Resume

- All work is on `feat/curated-mcp-marketplace` branch
- `canvas-design` has ~80 .ttf font files (5.5 MB) embedded via the vendor -- future optimization candidate (on-demand download vs embedding)
- `doc-coauthoring` follow-up: revisit if/when Anthropic adds a LICENSE.txt to that skill directory
- Agent instructions are intentionally lean (~15 lines) because the Agent Runner handles skill activation (SkillWriter generates "Available Skills" section) and tool injection (MCP tools registered as LangGraph tool wrappers) automatically
- The 5 domain agents are the first non-meta agents in the seedpack -- they establish the pattern for skill + MCP server composition

## Blockers

- None -- all implementation complete

## Task Breakdown (3 tasks, each = 1 conversation)

### Task 1: Vendor Skills from `anthropics/skills` + License Check -- COMPLETE
**Repo**: stigmer
- Vendored 7 Apache 2.0 skills: webapp-testing, claude-api, internal-comms, brand-guidelines, web-artifacts-builder, canvas-design, frontend-design
- Skipped doc-coauthoring (no license), document skills (non-redistributable)
- Re-vendored skill-creator at latest commit
- Fixed multi-skill vendoring bug in `01_vendor_skill.sh`
- All pinned to commit `12ab35c2eb5668c95810e6a6066f40f4218adc39`

### Task 2: Self-Compose 5 Domain Skills -- COMPLETE
**Repo**: stigmer
- Wrote 5 original domain-expertise skills: customer-support, code-reviewer, technical-writer, data-analyst, research-analyst
- Each with SKILL.md (workflow + key principles) + references/ directory (2 reference files each)
- 15 files total, consistent structural pattern across all 5 skills
- Scoping decisions: research-analyst focused on methodology not summarization; data-analyst focused on analytical thinking not computation
- Quality bar met: anti-platitude, specificity, actionability, progressive disclosure, trigger clarity

### Task 3: Create Composite Agents -- COMPLETE
**Repo**: stigmer
- Created 5 agent YAML files (expanded from planned 4) pairing domain skills with curated MCP servers
- Lean instruction pattern (~15 lines each) -- runtime handles skill activation and tool injection
- All cross-references verified: 8 MCP server slugs + 5 skill slugs match existing definitions
- Agents: code-review-agent, data-analyst-agent, docs-agent, support-agent, research-agent

## Quick Commands

After loading context:
- "Show project status" -- overview of progress
- "Test seedpack apply" -- verify all resources bootstrap correctly
- "Create PR" -- open pull request for the full feature branch

## Key References

- **Detailed plan**: `_projects/2026-04/20260410.02.curated-skills-marketplace/tasks/T01_0_plan.md`
- **Task 3 plan**: `_cursor/plans/composite_domain_agents_6dcab0a8.plan.md`
- **Task 2 plan**: `_cursor/plans/self-compose_domain_skills_6a70194b.plan.md`
- **Brainstorm plan**: `_cursor/plans/curated_skills_marketplace_59b7afd1.plan.md`
- **Session 1 checkpoint**: `_projects/2026-04/20260410.02.curated-skills-marketplace/checkpoints/2026-04-10-session-1.md`
- **Session 2 checkpoint**: `_projects/2026-04/20260410.02.curated-skills-marketplace/checkpoints/2026-04-10-session-2.md`
- **Session 3 checkpoint**: `_projects/2026-04/20260410.02.curated-skills-marketplace/checkpoints/2026-04-10-session-3.md`
- **Existing skills**: `seedpack/skills/` (15 skills total: 2 platform-authoring + 8 vendored + 5 self-composed)
- **Existing agents**: `seedpack/agents/` (9 agents total: 1 general-purpose + 3 meta-authoring + 5 domain)
- **Vendor script**: `seedpack/tools/01_vendor_skill.sh`
- **Vendor sources**: `seedpack/tools/vendor-sources.json`
- **Anthropic skills repo**: `https://github.com/anthropics/skills`
- **Companion MCP project**: `_projects/2026-04/20260410.01.curated-mcp-marketplace/`

---

*Drop this file into a new conversation to resume work on this project.*
