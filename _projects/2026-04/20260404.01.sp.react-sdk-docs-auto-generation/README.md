# Sub-Project: 20260404.01.sp.react-sdk-docs-auto-generation

## Parent Project

- **Parent**: 20260403.03.sdk-docs-auto-generation
- **Parent Path**: [../../20260403.03.sdk-docs-auto-generation/](../../20260403.03.sdk-docs-auto-generation/)
- **Spawned From Task**: T06

---

## Overview
Build a TypeDoc-based auto-generation pipeline for React SDK (@stigmer/react) reference documentation, producing always-in-sync Fumadocs MDX pages from TSDoc comments in the source code.

**Created**: 2026-04-04
**Status**: Active

## Sub-Project Information

### Goal
Auto-generate per-domain reference pages (hooks, components, props) for the React SDK's 61+ hooks and 55+ components, integrated into make gen-sdk-docs, so every code change automatically updates the docs.

### Technology Stack
Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)

### Project Type
Feature Development

### Affected Components
tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

### Additional Context
The React SDK already has TSDoc/JSDoc comments across much of its 192 source files (61 hooks, ~55 public components). No doc generation tooling (TypeDoc, API Extractor) is currently configured. The existing proto-based SDK docs generator (sdk_docs.go) produces MDX using Fumadocs components (SDKTabs, TypeTable). This sub-project adds a parallel TypeDoc-based pipeline for the React SDK, following the same codegen philosophy. Strategy: (1) hand-written react.mdx overview page, (2) auto-generated per-domain reference pages grouped by SDK domain folder (session, execution, agent, mcp-server, skill, environment, composer, workspace, api-key, etc.).

## Project Structure

This sub-project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (ASK before creating)
- **`design-decisions/`** - Significant architectural choices (ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (ASK before creating)

**Note**: Also check the parent project's knowledge folders for inherited context.

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Progress Tracking
- [x] Sub-project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Sub-project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Parent Project](../../20260403.03.sdk-docs-auto-generation/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
