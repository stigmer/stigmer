# Project: 20260125.01.skill-api-enhancement

## Overview
Enhance Skill API with proper versioning, proto definitions, and support for both local daemon and cloud storage (CloudFlare bucket). Remove inline skill feature.

**Created**: 2026-01-25
**Status**: Active 🟢

## Project Information

### Primary Goal
Implement a proper Skill API resource following Stigmer standards, with version support in ApiResourceReference, CLI detection in stigmer apply, and unified backend for local/cloud deployments

### Timeline
**Target Completion**: 2 weeks

### Technology Stack
Protobuf, Go (CLI), Java (Backend), Temporal (Orchestration)

### Project Type
Feature Development

### Affected Components
apis/ (proto definitions), client-apps/cli/ (Go CLI), backend/ (Java handlers), Agent integration

## Project Context

### Dependencies
ADR document for architecture, existing ApiResourceReference proto, SKILL.md format definition

### Success Criteria
- 1) Skill proto API with 5-file pattern created
- 2) ApiResourceReference has version field defaulting to 'latest'
- 3) stigmer apply detects SKILL.md and uploads skill
- 4) Backend supports local file storage and cloud bucket
- 5) Inline skill feature removed from agents
- 6) Documentation and examples complete

### Known Risks & Mitigations
Proto breaking changes may affect existing systems, need to ensure clean removal of inline skill without breaking agent execution

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

**Phase**: Design Complete, Ready for Implementation

### Design Decisions Completed
✅ Proto structure (Spec vs Status separation)
✅ Field naming (`skill_md` for SKILL.md content)
✅ Audit strategy (two-collection pattern with timestamps)
✅ Tag strategy (mutable tags with archived history)
✅ Content-addressable storage (SHA256 deduplication)
✅ ApiResourceReference version field enhancement
✅ Resolution logic for version queries

See [design-decisions/](design-decisions/) for complete architectural documentation.

### Active Task
See [tasks/T01_0_plan.md](tasks/T01_0_plan.md) for the detailed implementation plan.

### Latest Checkpoint
**2026-01-25**: T01.1 Proto API Definitions Complete ([checkpoint](checkpoints/2026-01-25-t01-1-proto-definitions-complete.md))
- All proto definitions implemented with simplified push-based workflow
- No backward compatibility (clean slate as requested)
- Ready for T01.2 CLI Enhancement

### Progress Tracking
- [x] Project initialized
- [x] Requirements gathered (2026-01-25)
- [x] Architecture designed (2026-01-25)
- [x] Design decisions documented (2026-01-25)
- [x] Proto API implementation (2026-01-25) ✅ T01.1 Complete
- [ ] CLI enhancement (Next: T01.2)
- [ ] Backend implementation
- [ ] Agent integration
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
- [Implementation Plan](tasks/T01_0_plan.md) - Detailed 2-week task breakdown
- [Design Decisions](design-decisions/) - **START HERE** for architectural context
  - [00-conversation-summary.md](design-decisions/00-conversation-summary.md) - Complete design session summary
  - [01-skill-proto-structure.md](design-decisions/01-skill-proto-structure.md) - Proto structure, audit, tags
  - [02-api-resource-reference-versioning.md](design-decisions/02-api-resource-reference-versioning.md) - Version field enhancement
- [Checkpoints](checkpoints/) - Major milestones (none yet)
- [Coding Guidelines](coding-guidelines/) - Project standards (TBD)

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