# Project: 20260322.01.documentation-infrastructure

## Overview
Build world-class documentation infrastructure for Stigmer: Vale prose linting, Fumadocs integration into the existing Next.js site, Snipsync code sample pipeline, auto-generated CLI/API reference docs, CI/CD quality gates, and advanced features (custom components, LLM output, search). Based on comparative analysis of Temporal, Pulumi, HashiCorp, GitHub, Crossplane, and Next.js documentation repositories.

**Created**: 2026-03-22
**Status**: Active 🟢

## Project Information

### Primary Goal
Transform Stigmer's ad-hoc 112 markdown files into a production-grade documentation system with automated quality enforcement, a rendered docs site at stigmer.ai/docs, tested code samples, and CI gates -- all within the existing monorepo

### Timeline
**Target Completion**: 6-8 weeks across 5 phases

### Technology Stack
Next.js 15, Fumadocs (fumadocs-core/fumadocs-mdx/fumadocs-ui), Vale, Snipsync, Prettier, Husky, MDX, Tailwind 4, TypeScript

### Project Type
Feature Development

### Affected Components
site/ (Next.js marketing site), docs/ (112 markdown files), Makefile (build targets), .github/workflows/ (CI), root package.json (npm workspaces), sdk/ (Go/TS/Python/Java SDKs), client-apps/cli/ (CLI for doc generation), examples/ (code samples)

## Project Context

### Dependencies
Fumadocs requires Next.js App Router (already in site/). Vale requires separate binary install (brew install vale). Snipsync requires Node.js. No external service dependencies for Phase 1-2.

### Success Criteria
- Vale runs on all docs with zero errors on committed content
- Fumadocs renders docs at /docs/ with sidebar and search
- make lint-docs and make docs-build pass in CI
- code samples extracted from tested examples/ via Snipsync
- CLI reference auto-generated
- PR preview deployments working

### Known Risks & Mitigations
Fumadocs integration with existing site/ layout and Tailwind config may require careful merging. Existing 112 markdown files may have significant quality issues requiring bulk triage. Snipsync markers require touching many files. Proto-to-docs generation has no proven blueprint from reference repos.

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