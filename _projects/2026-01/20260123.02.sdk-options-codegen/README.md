# Project: 20260123.02.sdk-options-codegen

## Overview
Build a universal SDK options code generator that automatically generates functional options for ALL SDK resources (Agent, Skill, SubAgent, Workflow tasks, MCP Servers, Environment) from proto schemas, eliminating 90% of hand-crafted options code across the entire SDK (~100-200 functions)

**Created**: 2026-01-23
**Status**: Active 🟢

## Project Information

### Primary Goal
Create a universal code generation system that generates functional options (Option, HttpCallOption, AgentCallOption, SkillOption, etc.) for all SDK resources from proto/JSON schemas, achieving 95% code generation, 5% ergonomic sugar across the entire SDK

### Timeline
**Target Completion**: Flexible - implement incrementally with validation at each step

### Technology Stack
Go, Protocol Buffers, JSON schemas, Code generation templates

### Project Type
Feature Development

### Affected Components
**Code Generator**: `tools/codegen/generator/main.go`

**SDK Resources (~21 config types)**:

**Top-Level Resources** (what users create):
- Agent: `sdk/go/agent/agent.go` (~10 options: WithName, WithInstructions, WithSkills, etc.)
- Skill: `sdk/go/skill/skill.go` (~7 options: WithName, WithMarkdown, WithDescription, etc.)
- Workflow: `sdk/go/workflow/workflow.go` (~10 options: WithNamespace, WithName, WithVersion, etc.)

**Component Types** (nested in above):
- SubAgent: `sdk/go/subagent/subagent.go` (~5 options)
- Workflow Tasks: `sdk/go/workflow/*_options.go` (13 task types × 5-10 options each)
- MCP Servers: `sdk/go/mcpserver/options.go` (3 server types × 5-7 options each)
- Environment: `sdk/go/environment/environment.go` (~5 options)

**Schemas**: All JSON schemas in `tools/codegen/schemas/` (agent, skill, tasks, types)

## Project Context

### Dependencies
Existing codegen infrastructure, proto schemas with full field metadata, understanding of functional options pattern

### Success Criteria
- 1) **Universal Generator**: Codegen generates option types + option functions for ALL SDK resources
- 2) **Complete Coverage**: All ~20 config types have generated options (~100-200 functions automated)  
- 3) **Minimal Manual Code**: Hand-written files reduced to <50 LOC (only specialized helpers)
- 4) **Backward Compatibility**: All existing tests pass without modification
- 5) **Pulumi-Style Ergonomics**: Generated options follow functional options pattern
- 6) **Extensibility**: New resources require only JSON schema, no code changes

### Known Risks & Mitigations
Breaking existing API if not backward compatible, Need to handle special cases (maps, nested types, expression support), May need custom templates per field type

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
- [x] Initial analysis complete (T01 ✅)
- [x] Core implementation (T02 ✅ - Simple field types)
- [x] Complex field types (T03 ✅ - maps, arrays)
- [ ] Agent/Skill resources (T04)
- [ ] Migration and testing (T05)
- [ ] Ergonomic layer (T06)
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