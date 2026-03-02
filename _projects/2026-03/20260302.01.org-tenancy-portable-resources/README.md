# Project: 20260302.01.org-tenancy-portable-resources

## Overview
Migrate Project resource from `agentic` to `management` domain, replace hardcoded `org: local` with relative cross-references and a real Organization resource in seedpack, making Stigmer OSS resources portable across local and cloud deployments.

**Created**: 2026-03-02
**Status**: Active 🟢

## Project Information

### Primary Goal
Three interconnected changes:
1. **Migrate Project** from `agentic.stigmer.ai/v1` to `management.stigmer.ai/v1` and expand its apply pipeline to support non-agentic resource kinds (Organization)
2. **Make cross-references org-agnostic** — empty `org` resolves to parent resource's org
3. **Bootstrap a real Organization resource** in seedpack with slug `default`, replace all hardcoded `"local"` org defaults

### Timeline
**Target Completion**: 1 week

### Technology Stack
Go (CLI, Server), Protobuf (APIs), YAML (Seedpack, Skill references), Python (Agent Runner)

### Project Type
Refactoring

### Affected Components
- Proto definitions (`agentic/project` → `management/project`, `ApiResourceReference` org optionality)
- CLI apply pipeline (type registry, verb support, file handlers, org resolution)
- OSS server (Organization controller, cross-ref org resolution, project reconciliation)
- Seedpack (agents, skills, mcp-servers, organizations, stigmer.yaml)
- CLI config (org context commands)
- Documentation and examples

## Project Context

### Architecture Decisions
- **AD-01**: Project moves from `agentic` to `management` domain
- **AD-02**: Project apply pipeline expanded to support Organization kind
- **AD-03**: Empty org in cross-references means "same org as parent"
- **AD-04**: Default org slug is `default`, not `local`
- **AD-05**: Seedpack Project creates the Organization resource
- **AD-06**: Backward compat for `org: local` and old `agentic.stigmer.ai/v1` apiVersion

### Dependencies
None — this is a self-contained refactor with no external blockers. No users on the current API yet.

### Success Criteria
- Project proto lives at `apis/ai/stigmer/management/project/v1/`
- `apiVersion: management.stigmer.ai/v1` accepted for Project (with backward compat for old apiVersion)
- Project apply pipeline handles Organization resources
- Zero `org: local` in seedpack YAML resource files
- Cross-references with empty org resolve to parent resource's org (server-side)
- Seedpack bootstraps a real Organization resource with slug `default`
- CLI defaults to `default` org, supports `stigmer org use/list/get`
- All tests pass, documentation updated

### Known Risks & Mitigations
1. Proto migration import churn — mechanical find/replace, no external users yet
2. Backward compatibility — explicit `org: local` still works, old apiVersion still accepted
3. Seedpack content hash change triggers re-bootstrap — expected, document in release notes
4. Cloud service proto dependency — updated on next git tag bump

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