# Project: 20260316.01.sdk-package-restructure

## Overview
Restructure Stigmer's SDK and TypeScript packages into a clean architecture: @stigmer/sdk (framework-agnostic TS client), @stigmer/react (consolidated React hooks and embeddable components), @stigmer/theme, and @stigmer/protos. Clean up Go SDK to target only 5 core resources (agent, skill, mcp-server, session, execution). Fix the broken npm release pipeline.

**Created**: 2026-03-16
**Status**: Active 🟢

## Project Information

### Primary Goal
Establish the correct package segregation and release infrastructure so that platform builders can install @stigmer/sdk + @stigmer/react and integrate Stigmer into their products with minimal friction. Clean the Go SDK down to 5 resources with codegen-friendly structure. Evaluate whether codegen applies to TypeScript SDK as well.

### Timeline
**Target Completion**: 2-3 weeks

### Technology Stack
TypeScript/React, Go, Protobuf/Buf, npm workspaces, GitHub Actions

### Project Type
Refactoring

### Affected Components
sdk/go (Go SDK), client-apps/web/_libs/domain (React domain packages), client-apps/web/_libs/infra (rpc-client), scripts/publish-libs.mjs (release script), package.json (workspace config), .github/workflows/release.npm-libs.yaml (CI), apis/stubs/ts (proto stubs)

## Project Context

### Dependencies
Buf Schema Registry (buf.build/leftbin/stigmer) for proto stubs, existing web console must keep working during migration

### Success Criteria
- 1. Go SDK cleaned to 5 resources (agent
- skill
- mcp-server
- session
- execution) with codegen structure. 2. @stigmer/sdk TypeScript package created with framework-agnostic client. 3. @stigmer/react consolidates all domain packages with subpath exports. 4. npm release pipeline (publish-libs.mjs + GitHub Actions) runs end-to-end. 5. Web console continues to work using the restructured packages.

### Known Risks & Mitigations
Breaking the existing web console during domain package consolidation. Codegen approach may need iteration. Go SDK cleanup removes code that might be needed later (mitigated by git history).

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