# Project: 20260403.03.sdk-docs-auto-generation

## Overview
Auto-generate SDK reference documentation from the proto-to-schema codegen pipeline for all four SDK languages (Go, TypeScript, Python, Java) plus React, producing always-in-sync, high-quality docs pages in the Fumadocs site.

**Created**: 2026-04-03
**Status**: Active 🟢

## Project Information

### Primary Goal
Create an automated pipeline that generates MDX-based SDK reference documentation from proto definitions and service schemas, integrated into the existing make codegen workflow, so every proto change automatically updates the docs.

### Timeline
**Target Completion**: Ongoing / no hard deadline

### Technology Stack
Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)

### Project Type
Feature Development

### Affected Components
tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

## Project Context

### Dependencies
Existing codegen pipeline (proto2schema + generator) must remain stable; schemas/services/*.json must be up to date

### Success Criteria
- Every SDK resource has auto-generated reference docs with method signatures in all 4 languages
- type definitions
- and descriptions. Docs regenerate on make codegen. CI detects stale docs.

### Known Risks & Mitigations
Proto comment quality limits doc quality; React SDK is hand-written and needs a separate approach; MDX layout iterations may require multiple passes

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

## Sub-Projects

| Sub-Project | Path | Status | Description |
|-------------|------|--------|-------------|
| react-sdk-docs-auto-generation | [20260404.01.sp.react-sdk-docs-auto-generation](../20260404.01.sp.react-sdk-docs-auto-generation/) | Active | Build a TypeDoc-based auto-generation pipeline for React SDK (@stigmer/react) reference documentation, producing always-in-sync Fumadocs MDX pages from TSDoc comments in the source code. |
