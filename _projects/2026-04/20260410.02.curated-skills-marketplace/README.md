# Project: 20260410.02.curated-skills-marketplace

## Overview
Expand seedpack skills from 3 meta-authoring skills to ~18 curated, general-purpose skills by vendoring from anthropics/skills (Apache 2.0) and self-composing key domain skills aligned with the platform-for-platforms positioning.

**Created**: 2026-04-10
**Status**: Active 🟢

## Project Information

### Primary Goal
Populate the skills marketplace with general-purpose, high-quality skills that demonstrate Pillar 1 (Knows Your Business): vendor 6-10 skills from anthropics/skills, self-compose 5 original domain skills (customer-support, code-reviewer, technical-writer, data-analyst, research-analyst), and create composite agents that pair skills with MCP servers.

### Timeline
**Target Completion**: 1 week

### Technology Stack
Markdown (SKILL.md), YAML (Agent definitions), Shell (vendor scripts), Python (skill scripts)

### Project Type
Feature Development

### Affected Components
stigmer/seedpack/skills, stigmer/seedpack/agents, stigmer/seedpack/tools/vendor-sources.json, stigmer/seedpack/tools/01_vendor_skill.sh

## Project Context

### Dependencies
Depends on anthropics/skills repo (Apache 2.0 license for most skills, source-available for document skills). Vendoring infrastructure already exists. MCP server curated marketplace project should land first for composite agents to reference those servers.

### Success Criteria
- 6+ vendored skills from anthropics/skills with provenance.json
- 5 self-composed domain skills with SKILL.md and references
- 4 composite agents pairing skills with MCP servers
- seedpack apply bootstraps all successfully

### Known Risks & Mitigations
Document skills (docx/pdf/pptx/xlsx) have source-available license that may not allow redistribution. Self-composed skills require careful quality bar to match Anthropic skill quality. Composite agents depend on curated MCP servers landing first.

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Documentation finalized
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

The `next-task.md` file contains:
- Direct paths to all project folders
- Current status information
- Resume checklist
- Quick commands

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Documentation Discipline

**CRITICAL**: AI assistants must ASK for permission before creating:
- Checkpoints
- Design decisions
- Guidelines
- Wrong assumptions
- Don't dos

Only task logs (T##_1_feedback.md, T##_2_execution.md) can be updated without permission.

## Notes

_Add any additional notes, links, or context here as the project evolves._