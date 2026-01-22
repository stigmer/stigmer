# Design Decision: Overall Approach

**Date**: 2026-01-22  
**Status**: Proposed  
**Decision Makers**: Development Team

---

## Context

We need to eliminate manual proto-to-Go conversion logic in the Stigmer SDK. Currently, each task type and agent feature requires hand-written conversion code, which doesn't scale.

---

## Decision

Implement a **Pulumi-inspired code generation framework** with the following architecture:

```
Proto Definitions → Schema Converter → JSON Schema → Code Generator → Go SDK
```

---

## Key Decisions

### 1. Schema as Intermediate Representation (Option B from discussion)

**Decision**: Use JSON schema as an intermediate format between protos and generated code.

**Rationale**:
- ✅ More flexible than direct proto → Go generation
- ✅ Can express SDK-specific concerns (builders, helpers)
- ✅ Matches Pulumi's proven pattern
- ✅ Easier to extend to other languages (Python, TypeScript)
- ✅ Decouples proto structure from SDK API

**Alternatives Considered**:
- ❌ **Option A**: Direct proto → Go (too rigid, couples SDK to proto structure)
- ❌ **Option C**: Handwritten wrappers (doesn't scale, high maintenance)

---

### 2. Generated Code Structure (Option A from discussion)

**Decision**: Separate generated code into dedicated `gen/` packages.

**Structure**:
```
sdk/go/
├── workflow/          # Hand-written core
│   ├── workflow.go    # Orchestration (manual)
│   ├── task.go        # TaskFieldRef, deps (manual)
│   └── gen/           # Generated code
│       ├── configs.go
│       ├── builders.go
│       └── proto.go
├── agent/             # Hand-written core
│   ├── agent.go       # Orchestration (manual)
│   └── gen/           # Generated code
│       ├── configs.go
│       ├── builders.go
│       └── proto.go
```

**Rationale**:
- ✅ Clear separation of concerns
- ✅ Easy to `.gitignore` generated code (if desired)
- ✅ No confusion about what to edit
- ✅ Clean imports (`workflow.gen.SetTaskConfig`)

**Alternatives Considered**:
- ❌ **Option B**: Mixed manual + generated (hard to maintain, unclear boundaries)

---

### 3. What Gets Generated vs. Manual

**Generated (from schema)**:
- Task config structs (SetTaskConfig, HttpCallTaskConfig, etc.)
- Agent config structs (Skills, MCP servers, etc.)
- Builder functions (typed constructors)
- Proto conversion (ToProto/FromProto methods)
- Validation helpers

**Manual (core SDK infrastructure)**:
- Workflow orchestration (`Workflow` type, task sequencing)
- Agent orchestration (`Agent` type, execution model)
- TaskFieldRef (Pulumi-style output references)
- Dependency tracking
- Context management
- Synth/converter logic

**Inspiration**: Matches Pulumi's split:
- **Pulumi generates**: Resource types (aws.S3Bucket), typed inputs/outputs
- **Pulumi keeps manual**: SDK core (pulumi.Context, pulumi.Run)

---

### 4. Template Engine: `text/template`

**Decision**: Use Go's standard `text/template` package.

**Rationale**:
- ✅ Part of standard library (no dependencies)
- ✅ Sufficient for our needs
- ✅ Easy to understand and maintain
- ✅ Same as Pulumi uses

**Alternatives Considered**:
- ❌ Third-party template engines (unnecessary complexity)
- ❌ Code generation via AST manipulation (overkill, harder to debug)

---

### 5. Examples Strategy

**Decision**: Keep existing examples in `examples_legacy/`, create new examples with generated SDK.

**Rationale**:
- ✅ Preserves reference implementation
- ✅ Allows gradual migration
- ✅ Demonstrates before/after clearly
- ✅ Can delete legacy once confident

**Migration Path**:
```
sdk/go/examples/          → sdk/go/examples_legacy/
sdk/go/examples/ (new)    ← Fresh examples using generated code
```

---

### 6. Scope: Workflows AND Agents (Both in Phase 1)

**Decision**: Generate code for both workflows and agents in this project.

**Rationale**:
- ✅ Both follow same "kind + struct" pattern
- ✅ Reuse templates and infrastructure
- ✅ Demonstrate versatility of generator
- ✅ Avoid technical debt (half-generated SDK is awkward)

**Parallel or Sequential**: TBD based on complexity; likely workflow-first to validate approach, then agents.

---

### 7. Proto → Schema Converter (Build It)

**Decision**: Build automated proto → schema converter, don't write schemas manually.

**Rationale**:
- ✅ Reduces human error
- ✅ Easier to keep in sync with protos
- ✅ Reusable for future proto changes
- ✅ Can extract validations, comments automatically

**Alternative Considered**:
- ❌ Manual schema writing (error-prone, doesn't scale)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Proto Definitions                    │
│   - apis/ai/stigmer/agentic/workflow/v1/tasks/*.proto   │
│   - apis/ai/stigmer/agentic/agent/v1/*.proto            │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
         ┌────────────────────┐
         │ Proto → Schema     │
         │ Converter          │
         │ (tools/codegen)    │
         └────────┬───────────┘
                  │
                  ▼
         ┌────────────────────┐
         │  JSON Schema       │
         │  (intermediate)    │
         │  - task types      │
         │  - agent resources │
         └────────┬───────────┘
                  │
                  ▼
         ┌────────────────────┐
         │  Code Generator    │
         │  (text/template)   │
         └────────┬───────────┘
                  │
                  ├──────────────────────┬─────────────────┐
                  ▼                      ▼                 ▼
         ┌────────────────┐    ┌─────────────────┐  ┌──────────────┐
         │ Config Structs │    │ Builder Funcs   │  │ Proto Conv   │
         └────────────────┘    └─────────────────┘  └──────────────┘
                  │                      │                 │
                  └──────────────────────┴─────────────────┘
                                         │
                                         ▼
                            ┌─────────────────────────┐
                            │  Generated Go Code      │
                            │  - sdk/go/workflow/gen/ │
                            │  - sdk/go/agent/gen/    │
                            └─────────────────────────┘
```

---

## Tools to Build

1. **Proto → Schema Converter** (`tools/codegen/proto2schema/`)
   - Input: `.proto` files
   - Output: JSON schemas
   - Features: Extract types, validations, docs

2. **Code Generator** (`tools/codegen/generator/`)
   - Input: JSON schemas
   - Output: Go SDK code
   - Features: Template rendering, formatting, validation

3. **CLI Wrapper** (`tools/codegen/main.go`)
   - Orchestrates: proto2schema → generator
   - Flags: target (workflow/agent), output dir, etc.

---

## Success Criteria

**Target Workflow (New Task Type)**:
```bash
# 1. Write proto
vim apis/ai/stigmer/agentic/workflow/v1/tasks/email.proto

# 2. Run codegen
make codegen

# 3. Use in SDK immediately
import "github.com/stigmer/stigmer/sdk/go/workflow/gen"
task := gen.EmailTask(to, subject, body)
```

**Metrics**:
- ⏱️ Time to add new task: < 5 minutes
- 📝 Manual conversion code: 0 lines
- ✅ Test pass rate: 100%
- 🎯 Type safety: Full IDE support

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Template complexity | Medium | Medium | Start simple, iterate |
| Breaking API changes | High | High | Compatibility layer, gradual migration |
| Proto edge cases | Low | Medium | Handle common cases first |
| Performance issues | Low | Low | Profile if slow, optimize later |

---

## Next Steps

1. Review and approve this design decision
2. Begin Phase 1: Research Pulumi patterns
3. Design JSON schema format
4. Build proto2schema converter
5. Build code generator
6. Integrate with SDK

---

**Status**: Awaiting approval to proceed
