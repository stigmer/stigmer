# Project: 20260412.01.slack-marketplace-submission

## Overview
Submit the Stigmer Slack app to the Slack Marketplace to enable multi-workspace MCP access. Covers listing assets, scope justifications, public pages, 5+ workspace installs, and the review process.

**Created**: 2026-04-12
**Status**: Active 🟢

## Project Information

### Primary Goal
Get the Stigmer Slack app (A0AS6B4B97G) approved and published in the Slack Marketplace so that any Slack workspace can install it and use Slack MCP tools through Stigmer agents.

### Timeline
**Target Completion**: Flexible -- as soon as we hit 5 active workspace installs

### Technology Stack
Slack API, OAuth 2.0, MCP Protocol, React SDK, Java/Spring (stigmer-service)

### Project Type
Feature Development

### Affected Components
Slack app settings (api.slack.com), seedpack MCP server definitions, OAuthApp configuration, stigmer.ai landing/support/privacy pages

## Project Context

### Dependencies
5+ active Slack workspace installs (hard Slack prerequisite), Slack Marketplace review team (~10 weeks for functional review)

### Success Criteria
- 1. Stigmer Slack app is published in the Slack Marketplace. 2. Any Slack workspace can install the app and complete OAuth. 3. MCP connect (tool discovery) works for non-Stigmer workspaces. 4. Agents can search channels
- send messages
- and read users via Slack MCP tools on customer workspaces.

### Known Risks & Mitigations
1. Slack review may reject scopes or request changes (budget for multiple review rounds). 2. Getting 5+ workspace installs may take time. 3. Slack may restrict search:read.* scopes for MCP use cases. 4. Review timeline is up to 10 weeks -- cannot be accelerated.

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