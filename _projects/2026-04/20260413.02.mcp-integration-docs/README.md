# Project: 20260413.02.mcp-integration-docs

## Overview
Documentation content strategy and implementation for the MCP integration ecosystem — marketplace, connect flow, OAuth patterns, BYOA, and architecture transparency — across the Stigmer docs site.

**Created**: 2026-04-13
**Status**: Active 🟢

## Project Information

### Primary Goal
Create compelling, demo-rich documentation that shows platform builders how to integrate tools onto Stigmer, and provides transparent architecture documentation for external reviewers (e.g., Slack marketplace).

### Timeline
**Target Completion**: Ongoing, phased delivery

### Technology Stack
Next.js/Fumadocs, MDX, TypeScript/React (demos), @stigmer/react SDK components

### Project Type
Feature Development

### Affected Components
docs/ (MDX content), site/src/components/docs/demos/ (demo scenarios), apis/ (proto overview.md files)

## Project Context

### Dependencies
Content strategy project (20260331.01), MCP projects (20260408-20260413), document writer role (_roles/002_document_writer.md)

### Success Criteria
- Platform builders can follow a complete path from marketplace browsing to OAuth-connected tools
- Slack reviewers can access a transparent architecture page linked from submission materials
- Every guide page has a live demo built from real `@stigmer/react` components
- The `guides/integrations/` section is fully wired in the docs sidebar

### Known Risks & Mitigations
- Demo fixtures need to track proto changes from recent projects — mitigate by building fixtures from current proto shapes
- OAuth architecture page must be accurate to current implementation state — mitigate by cross-referencing with managed-credentials and BYOA project docs
- New guides section needs IA doc update — handled in T01

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
- [x] T01: Concepts expansion + nav setup
- [ ] T02: Marketplace and connect guides + demos
- [ ] T03: OAuth for tools guide + hero demo
- [ ] T04: BYOA guide + demo
- [ ] T05: Architecture transparency page
- [ ] T06: Tutorial completion + demo updates
- [ ] T07: SDK reference polish

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

## Task Map

| Task | Title | Scope | Est. effort |
|------|-------|-------|-------------|
| **T01** | Concepts expansion + nav setup | Expand `concepts/tools.mdx`, create `guides/integrations/` nav, update IA doc | 1 session |
| **T02** | Marketplace and connect guides | Write `overview.mdx` + `connect-from-marketplace.mdx`, build 2 demos | 1-2 sessions |
| **T03** | OAuth for tools guide | Write `oauth-for-tools.mdx`, build `oauth-connect-flow` demo | 1-2 sessions |
| **T04** | BYOA guide | Write `bring-your-own-oauth.mdx`, build `byoa-setup` demo | 1 session |
| **T05** | Architecture transparency | Write `oauth-architecture.mdx` with mermaid diagrams | 1 session |
| **T06** | Tutorial completion | Refresh `connect-tools.mdx`, build 2 tutorial pages, update demos | 2 sessions |
| **T07** | SDK reference polish | Create `overview.md` for mcpserver + oauthapp, review proto comments | 1 session |

## Audiences

1. **Platform builders** (primary) — "How do I connect tools to my agents?"
2. **External reviewers** (secondary) — "How does your OAuth architecture work?" (Slack marketplace submission)
3. **MCP server authors** (future) — "How do I get my server into the Stigmer marketplace?"

## Predecessor Projects

These projects built the features this documentation covers:

| Project | What it built |
|---------|--------------|
| `20260408.01` | MCP marketplace catalog (registry sync, then curated) |
| `20260408.02` | MCP connect flow (one-click connect, auto-classified approvals) |
| `20260409.01` | Sandbox security (Daytona isolation for stdio MCP) |
| `20260410.01` | Curated MCP marketplace (~53 servers) |
| `20260410.02` | Curated skills marketplace (~18 skills + composite agents) |
| `20260410.03` | MCP OAuth connect (DCR+PKCE, vendor OAuth, OAuthApp) |
| `20260411.01` | OAuth managed credentials (encrypted per-grant environments) |
| `20260411.02` | Connect retry + env declarations (required vs optional) |
| `20260412.01` | Slack marketplace submission (vendor approval status) |
| `20260412.02` | MCP marketplace OAuth expansion (53 servers, DCR/vendor patterns) |
| `20260413.01` | OAuth BYOA integration (org-level OAuth app overrides) |

## Notes

_Add any additional notes, links, or context here as the project evolves._