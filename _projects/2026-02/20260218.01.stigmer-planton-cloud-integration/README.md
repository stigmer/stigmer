# Project: 20260218.01.stigmer-planton-integration

## Overview
Research and design the integration architecture for Stigmer as an agent-execution provider within Planton. Both are SaaS products with their own organizations, user accounts, and authentication. This project investigates identity federation, organization synchronization, user authentication across boundaries, and whether Stigmer should remain a standalone SaaS or become an embedded/white-label service for platforms like Planton.

**Created**: 2026-02-18
**Status**: Active 🟢

## Project Information

### Primary Goal
Determine the right architecture and mechanisms for integrating Stigmer into Planton — covering identity/auth federation, organization mirroring, cross-platform user authentication, and Stigmer's product positioning (standalone SaaS vs embedded provider vs hybrid).

### Timeline
**Target Completion**: 2-3 weeks — primarily research and architectural design, with proof-of-concept validation

### Technology Stack
Architecture design, gRPC APIs, OAuth2/OIDC, API keys, service accounts, identity federation protocols, Stigmer platform, Planton platform

### Project Type
Research

### Affected Components
Stigmer identity/auth system, Stigmer organization management, Stigmer agent execution API, Planton identity/auth system, Planton organization management, integration API layer

## Project Context

### Dependencies
Stigmer existing auth and org management system, Planton existing auth and org management system, MCP server work (parallel project)

### Success Criteria
- Clear integration architecture documented with trade-off analysis
- Identity/auth federation mechanism selected and justified
- Organization synchronization approach defined
- Decision on Stigmer product positioning (SaaS vs embedded vs hybrid)
- Security model for cross-platform authentication validated
- Proof-of-concept or prototype plan ready

### Known Risks & Mitigations
Wrong architectural choice could lock both products into a bad integration pattern, Identity federation complexity may be underestimated, Security implications of cross-platform auth tokens, Maintaining Stigmer as independent SaaS while also serving as embedded provider creates dual-mode complexity, Org/user sync failures could cause data inconsistency

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