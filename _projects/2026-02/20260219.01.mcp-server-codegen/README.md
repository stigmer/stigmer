# Project: 20260219.01.mcp-server-codegen

## Overview
A manifest-driven Go code generator that produces curated MCP server tool and resource handlers from a YAML config and Go templates. Targets the official modelcontextprotocol/go-sdk. Designed to be reusable across Stigmer, Planton, and future products.

**Created**: 2026-02-19
**Status**: Active 🟢

## Project Information

### Primary Goal
Eliminate hand-written MCP server boilerplate by generating typed tool handlers, resource templates, fetch functions, and server wiring from a declarative YAML manifest — while preserving curated tool surfaces (not exposing every RPC).

### Timeline
**Target Completion**: 1-2 weeks (after T11-A write operations are complete)

### Technology Stack
Go, text/template, YAML, modelcontextprotocol/go-sdk, protobuf/protojson

### Project Type
Feature Development

### Affected Components
Standalone repo (new). Consumers: stigmer/mcp-server/, plantonhq/mcp-server-planton/. Proto stubs from stigmer/apis/stubs/go/ and buf.build registry.

## Project Context

### Dependencies
T11-A (Stigmer MCP server write operations) should be complete first to validate the full pattern (read + write tools) before codifying it into templates.

### Success Criteria
- 1. Generator reproduces Stigmer's existing 4 domains (agents
- skills
- workflows
- mcpservers) identically from a manifest. 2. Adding a new resource domain requires only a YAML entry
- not Go code. 3. Generated code targets official go-sdk. 4. Works for Planton after SDK migration.

### Known Risks & Mitigations
1. Official go-sdk API may change (v1.3.0 is current, pre-1.0 stability). 2. Template approach may not cover edge cases (search tool, versioned skill resources). 3. Planton has different patterns (cloud resource wrapping, multi-level domains) — generator must be flexible enough.

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