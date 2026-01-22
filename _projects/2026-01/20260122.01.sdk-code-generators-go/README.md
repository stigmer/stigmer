# SDK Code Generators (Go) - Workflows & Agents

**Created**: 2026-01-22  
**Status**: 🟢 Phase 2 - Code Generator Engine  
**Timeline**: 1-2 weeks (ahead of schedule)

## Progress

### Completed Phases

- ✅ **Phase 1: Research & Design** (2 hours, completed 2026-01-22)
  - See: `checkpoints/01-phase1-complete.md`
  - See: `design-decisions/01-pulumi-analysis.md`
  - See: `design-decisions/02-schema-format.md`
  - See: `design-decisions/03-codegen-strategy.md`

### Current Phase

- 🟢 **Phase 2: Code Generator Engine** (in progress)
  - Goal: Build tool to generate Go code from JSON schemas
  - Using manual schemas for testing
  - Proto parser deferred to Phase 3

## Overview

Build Pulumi-inspired code generation framework for Stigmer Go SDK to eliminate manual proto conversion and enable type-safe, extensible builders for workflows and agents.

## Problem Statement

Currently, the Stigmer Go SDK requires manual conversion logic between Go types and Protocol Buffer definitions. This creates maintenance overhead and doesn't scale as we add more task types, agent features, and resources.

**Current Pain Points**:
- Manual proto conversion code for each task type
- Inconsistent patterns across different resource types
- Hard to maintain as proto schemas evolve
- Adding new task types requires extensive boilerplate
- No type safety guarantee between SDK and proto definitions

## Goal

Implement schema-driven code generator that produces idiomatic Go SDK code from proto definitions, starting with workflow tasks and agent resources.

**Success Criteria**:
- ✅ Adding new task/agent features requires only proto updates + codegen run
- ✅ Zero manual conversion logic needed
- ✅ Type-safe builders with IDE autocomplete
- ✅ All existing examples work with new SDK
- ✅ Tests pass

## Scope

### Phase 1: Core Code Generation Framework (This Project)

**Generate for BOTH Workflows AND Agents**:

#### Workflow Generation:
- Task config structs (SetTaskConfig, HttpCallTaskConfig, etc.)
- Task builders (typed constructors)
- Proto conversion logic (Go structs ↔ protobuf)
- Validation helpers

#### Agent Generation:
- Agent config structs
- Agent builders (typed constructors)
- Skill config structs
- MCP server config structs
- Proto conversion logic
- Validation helpers

**Keep Manual (Core SDK Infrastructure)**:
- Workflow orchestration (`Workflow` type, dependency tracking, synthesis)
- Agent orchestration (core Agent type, execution model)
- TaskFieldRef (Pulumi-style reference system)
- Context management
- Synth/converter logic

This matches Pulumi's pattern:
- **Pulumi generates**: aws.S3Bucket, gcp.ComputeInstance (resources + configs)
- **Pulumi keeps manual**: pulumi.Context, pulumi.Run, output reference system

## Technology Stack

- **Language**: Go
- **Templating**: `text/template` (Go standard library)
- **Schema Format**: JSON (inspired by Pulumi's schema.Package)
- **Source**: Protocol Buffers
- **Target**: Idiomatic Go SDK code

## Architecture

```
┌─────────────────┐
│ Proto Definitions│
│ (*.proto files) │
└────────┬─────────┘
         │
         ▼
┌─────────────────────┐
│ Schema Converter    │
│ (proto → schema)    │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   JSON Schema       │
│ (intermediate repr) │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Code Generator     │
│ (template-based)    │
└────────┬────────────┘
         │
         ▼
┌─────────────────────────────┐
│   Generated Go Code         │
│ - Config structs            │
│ - Builders                  │
│ - Proto conversion          │
│ - Validation                │
└─────────────────────────────┘
```

## Components Affected

- `apis/ai/stigmer/agentic/workflow/v1/` - Proto definitions (source)
- `apis/ai/stigmer/agentic/agent/v1/` - Proto definitions (source)
- `sdk/go/workflow/` - SDK code (consumer)
- `sdk/go/agent/` - SDK code (consumer)
- `tools/codegen/` - New code generator tool
- `sdk/go/workflow/gen/` - Generated workflow code
- `sdk/go/agent/gen/` - Generated agent code
- `sdk/go/examples/` - Updated examples

## Dependencies

None - self-contained tool development.

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking changes to existing SDK API | High | Preserve backward compatibility layer, phased migration |
| Migration complexity for existing examples | Medium | Keep `examples_legacy/` folder during transition |
| Template maintenance overhead | Medium | Keep templates simple, well-documented, with tests |
| Proto schema evolution | Low | Schema converter handles this automatically |

## Phases

### Phase 1: Schema Foundation (Days 1-2)
- Design JSON schema format (inspired by Pulumi's schema.Package)
- Build proto → schema converter
- Generate schema for all 13 workflow task types + agent resources
- Validate schema correctness

### Phase 2: Code Generator Engine (Days 3-5)
- Build template-based Go generator
- Templates for config structs, builders, proto conversion, validation
- Generate initial code and verify compilation

### Phase 3: Workflow Integration (Days 6-7)
- Integrate generated workflow task code
- Update `sdk/go/workflow/` to use generated types
- Preserve TaskFieldRef and orchestration logic
- Run tests, fix integration issues

### Phase 4: Agent Integration (Days 8-9)
- Integrate generated agent code
- Update `sdk/go/agent/` to use generated types
- Preserve agent orchestration logic
- Run tests, fix integration issues

### Phase 5: Examples & Cleanup (Days 10-11)
- Move existing examples → `examples_legacy/`
- Regenerate all examples with new SDK
- Write migration guide
- Update documentation

### Phase 6: Validation & Handoff (Day 12)
- End-to-end testing
- Smoke test: Add a new task type (verify it only needs proto + codegen run)
- Documentation review
- Prep for Phase 2 projects

## Future Work (Separate Projects)

- **Phase 2**: Advanced schema validation, custom field types
- **Phase 3**: Extend to new resource types (when MCP servers/skills become first-class)
- **Phase 4**: Multi-language SDKs (Python, TypeScript) using same schema

## Reference

- Pulumi Code Generation: `/Users/suresh/scm/github.com/pulumi/pulumi/pkg/codegen/`
- Stigmer Proto Definitions: `apis/ai/stigmer/agentic/`
- Current SDK Implementation: `sdk/go/`
- ADR: `docs/adr/20260118-181912-sdk-code-generators.md`

## Progress Tracking

See `tasks/` directory for detailed task breakdown and progress.

Current task: See `next-task.md`
