# Project: 20260413.01.oauth-byoa-integration

## Overview
Redesign MCP server OAuth integration: implement Bring Your Own App (BYOA) support with org-level OAuth app overrides, fix 10 architectural gaps including missing disconnect flow, stale grant status, execution refresh hardening, and missing admin UI. Establishes a robust OAuth app resolution chain (org override -> platform default -> manual token).

**Created**: 2026-04-13
**Status**: Active 🟢

## Project Information

### Primary Goal
Implement org-level OAuth app overrides with a resolution chain, fix critical gaps (disconnect, grant health, execution refresh, vendor gate, error UX), and build the complete BYOA frontend experience

### Timeline
**Target Completion**: 2-3 weeks (7 tasks across 4 phases)

### Technology Stack
Protobuf (stigmer/apis), Java/Spring (stigmer-cloud backend), Go (stigmer backend), TypeScript/React (stigmer SDK frontend), MongoDB

### Project Type
Feature Development

### Affected Components
Proto APIs (stigmer/apis/ai/stigmer), backend handlers (stigmer-cloud/domain/agentic/mcpserver), frontend SDK (stigmer/sdk/react/src/mcp-server), OAuth infrastructure (OAuthGrant, OAuthApp, ManagedEnvironment), seedpack

## Project Context

### Dependencies
Existing OAuthApp CRUD (command + query controllers), OAuthGrant infrastructure (repo + document), ManagedEnvironmentService, Temporal connect workflow, McpServerVendorApprovalEnricher, VendorOAuthBootstrapConfig

### Success Criteria
- BYOA flow works end-to-end (create org OAuth app + sign in + connect)
- Disconnect flow deletes grant and managed env cleanly
- Connection health accurately reflects token state (healthy/expired/stale)
- Execution-path refresh hard-fails instead of warn-only
- Vendor approval enforced at backend (not just UI)
- Connect failure errors are user-friendly (no raw Temporal metadata)
- Resolution chain correctly prioritizes org override over platform default
- Token refresh resolves correct OAuthApp via resolution chain

### Known Risks & Mitigations
- Cross-repo coordination (proto in stigmer must be regenerated before stigmer-cloud can consume)
- Backward compatibility with existing OAuthGrant documents (no breaking changes to composite key)
- OAuthAppOverride must not break existing vendor OAuth flow for users without overrides
- Figma/Slack/Salesforce OAuth apps in production must continue working unchanged

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
- [x] Architecture analysis (10 gaps identified, resolution chain designed)
- [ ] T01: Proto layer (messages, RPCs, enums, stubs)
- [ ] T02: Backend disconnect + grant health
- [ ] T03: Backend hardening (refresh, vendor gate, error UX)
- [ ] T04: Backend BYOA infrastructure
- [ ] T05: Backend BYOA handlers + integration
- [ ] T06: Frontend gap fixes (disconnect, health, errors)
- [ ] T07: Frontend BYOA experience
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