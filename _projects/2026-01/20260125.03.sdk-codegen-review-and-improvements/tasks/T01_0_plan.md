# T01: SDK Code Generation Review and Improvements Plan

**Status**: PENDING_REVIEW  
**Created**: 2026-01-25  
**Author**: Claude Opus 4.5

## Executive Summary

This plan outlines a comprehensive review of the Stigmer SDK code generation system, comparing it against Pulumi's mature approach and modern SDK design principles. The goal is to identify improvements, unused code, oversimplifications, and enhancement opportunities while ensuring we maintain the solid foundations already in place.

---

## Current State Analysis

### What You Have (Strengths)

After analyzing the codebase, I found a **well-architected system** with several excellent design decisions:

1. **Two-Stage Code Generation Pipeline** (`tools/codegen/`)
   - Stage 1: Proto → JSON Schema (`proto2schema/main.go`)
   - Stage 2: JSON Schema → Go Code (`generator/main.go`)
   - This separation is clean and allows for multi-language generation

2. **Pulumi-Inspired Args Pattern**
   - Generated `*Args` structs following Pulumi conventions
   - Clean struct-based configuration (e.g., `agent.AgentArgs{}`)
   - Type-safe, discoverable API

3. **Synthesis Model Architecture**
   - SDK collects configuration → auto-writes `manifest.pb`
   - CLI reads manifest → deploys to platform
   - Clean separation of concerns

4. **Proto-First Design with Buf**
   - Using Buf CLI for proto management
   - Publishing to Buf Schema Registry (BSR)
   - Version-locked dependencies via `buf.lock`

5. **Comprehensive Documentation**
   - `codegen-architecture.md` clearly explains the system
   - Examples cover all major use cases (19 examples!)
   - Well-documented API with godoc comments

### Areas for Review (Potential Improvements)

Based on my analysis, here are the areas to investigate:

| Area | Current State | Potential Improvement |
|------|---------------|----------------------|
| **Build System** | Makefile-driven | Consider Mage/Bazel integration |
| **Args Generation** | Generated per-namespace | Could benefit from type helpers |
| **Validation** | Partial buf.validate parsing | Could be more comprehensive |
| **Multi-Language** | Go only (Python/TS planned) | Schema-based generation ready |
| **Testing** | Good coverage | Could add golden file tests |
| **Ergonomics** | Clean but verbose | Could add more convenience |

---

## Proposed Review Tasks

### Phase 1: Deep Audit (Days 1-2)

#### T01.1: Code Generation Pipeline Audit
**Goal**: Verify the two-stage pipeline is optimal

**Review Items**:
- [ ] Analyze `tools/codegen/proto2schema/main.go` (~585 lines)
- [ ] Analyze `tools/codegen/generator/main.go` (~735 lines)
- [ ] Compare schema intermediate format with Pulumi's approach
- [ ] Check for dead code or unused generation paths
- [ ] Evaluate buf.validate extraction completeness
- [ ] Review nested type collection logic

**Questions to Answer**:
1. Is the JSON schema format optimal for multi-language generation?
2. Are there proto message types not being generated?
3. Is validation extraction complete enough?

#### T01.2: SDK API Ergonomics Audit
**Goal**: Evaluate developer experience compared to Pulumi

**Review Items**:
- [ ] Agent API (`sdk/go/agent/`)
- [ ] Workflow API (`sdk/go/workflow/`)
- [ ] Skill API (`sdk/go/skill/`)
- [ ] MCP Server API (`sdk/go/mcpserver/`)
- [ ] Environment API (`sdk/go/environment/`)
- [ ] Subagent API (`sdk/go/subagent/`)

**Comparison Points with Pulumi**:
1. Resource creation patterns (New vs Builder)
2. Functional options usage
3. Type safety (Output/Input types in Pulumi)
4. Error handling patterns
5. Context propagation

#### T01.3: Build Pipeline Audit
**Goal**: Evaluate if Makefile is the right approach

**Review Items**:
- [ ] Root `Makefile` targets and flow
- [ ] `apis/Makefile` proto generation
- [ ] `sdk/go/Makefile` SDK build
- [ ] Bazel integration status (`.bazelrc`, `MODULE.bazel`)
- [ ] GoReleaser configuration (`.goreleaser.yml`)

**Alternatives to Consider**:
1. **Go Generate**: `//go:generate` directives for self-documenting generation
2. **Mage**: Go-native task runner (Pulumi uses this)
3. **Task**: Modern task runner with better DX
4. **Full Bazel**: Already partially set up
5. **Just**: Simpler Makefile alternative

---

### Phase 2: Comparative Analysis (Day 3)

#### T02.1: Pulumi Pattern Comparison
**Goal**: Identify gaps and opportunities by comparing with Pulumi

**Pulumi Features to Evaluate**:

| Pulumi Feature | Stigmer Status | Recommendation |
|----------------|----------------|----------------|
| Input/Output types | Not implemented | Consider for type safety |
| Resource dependencies | Implicit via refs | ✅ Good |
| Provider plugin system | N/A | Different model |
| PCL intermediate | JSON Schema | Equivalent approach |
| Multi-lang codegen | Planned | Schema supports this |
| Schema-based SDK gen | Partial | Could expand |
| Automation API | Not applicable | Different domain |

#### T02.2: Modern SDK Design Patterns
**Goal**: Apply modern Go SDK best practices

**Patterns to Evaluate**:
1. **Functional Options vs Args Struct**
   - You use both (hybrid) - verify consistency
   
2. **Builder Pattern**
   - Used for workflows - evaluate for agents?

3. **Fluent API**
   - Workflow builder methods return `*Workflow` for chaining
   - Could apply to other types

4. **Type Aliases vs Wrapping**
   - `type AgentArgs = genAgent.AgentArgs` - good!

5. **Interface-Based Abstractions**
   - `Context` interface prevents import cycles - excellent

---

### Phase 3: Implementation (Days 4-6)

Based on Phase 1 & 2 findings, implement improvements. Below are **potential** improvements pending review:

#### T03.1: Code Generation Improvements (If Needed)

**Potential Improvements**:
1. **Enhanced Type Helpers**
   - Generate `New<Type>()` convenience constructors
   - Generate `With<Field>()` modifiers for nested types

2. **Validation Generation**
   - Generate validation methods from buf.validate
   - Add runtime validation option

3. **Documentation Generation**
   - Generate markdown docs from proto comments
   - Add OpenAPI spec generation

#### T03.2: API Ergonomics Improvements (If Needed)

**Potential Improvements**:
1. **Convenience Constructors**
   ```go
   // Current
   agent.New(ctx, "name", &agent.AgentArgs{Instructions: "..."})
   
   // Potential addition
   agent.Quick(ctx, "name", "instructions")  // For simple cases
   ```

2. **Type-Safe References**
   ```go
   // Current
   fetchTask.Field("title").Expression()
   
   // Potential improvement (type-safe)
   fetchTask.Output.Title  // Compile-time checked
   ```

3. **Workflow Task Shortcuts**
   - Add more convenience methods like the existing HTTP methods
   - Consider task composition helpers

#### T03.3: Build System Improvements (If Needed)

**Options to Evaluate**:

1. **Mage Migration**
   ```go
   //go:build mage
   
   func Proto() error { ... }
   func SDK() error { ... }
   func Release() error { ... }
   ```
   - Pros: Go-native, type-safe, IDE support
   - Cons: Migration effort

2. **Go Generate Integration**
   ```go
   //go:generate go run tools/codegen/proto2schema/main.go ...
   //go:generate go run tools/codegen/generator/main.go ...
   ```
   - Pros: Standard Go tooling, self-documenting
   - Cons: Less flexible than Makefile

3. **Hybrid Approach**
   - Keep Makefile for orchestration
   - Add `go:generate` for in-source documentation
   - This might be the best balance

---

### Phase 4: Documentation & Testing (Day 7)

#### T04.1: Update Documentation
- Update `tools/codegen/README.md` with any changes
- Update `sdk/go/docs/codegen-architecture.md`
- Add ADR (Architecture Decision Record) for major changes

#### T04.2: Enhanced Testing
- Add golden file tests for code generation
- Add integration tests for the full pipeline
- Ensure all existing tests pass

---

## Detailed Task Breakdown

### Immediate Actions (T01)

| ID | Task | Priority | Effort |
|----|------|----------|--------|
| T01.1 | Audit proto2schema tool | P1 | 2h |
| T01.2 | Audit generator tool | P1 | 2h |
| T01.3 | Audit generated code quality | P1 | 1h |
| T01.4 | Review Makefile targets | P2 | 1h |
| T01.5 | Compare with Pulumi codegen | P2 | 2h |
| T01.6 | Identify dead/unused code | P1 | 2h |

### Secondary Actions (T02)

| ID | Task | Priority | Effort |
|----|------|----------|--------|
| T02.1 | API ergonomics review | P1 | 3h |
| T02.2 | Document improvement opportunities | P1 | 2h |
| T02.3 | Prioritize improvements by impact | P1 | 1h |

### Implementation (T03)

To be defined after audit phase.

---

## Success Criteria

1. **Complete Audit Report**
   - All code generation tools reviewed
   - All SDK packages audited
   - Build pipeline evaluated

2. **Improvement Backlog**
   - List of improvements with effort estimates
   - Prioritized by impact and effort
   - Clear rationale for each

3. **Implemented Changes** (if any)
   - All changes pass tests
   - Backward compatible
   - Well-documented

4. **Updated Documentation**
   - Architecture docs updated
   - New patterns documented
   - Examples updated if needed

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking SDK consumers | Run all tests, check semver compatibility |
| Build pipeline instability | Test in isolated branch first |
| Over-engineering | Focus on practical improvements only |
| Scope creep | Strict adherence to review scope |

---

## Questions for Developer Review

Before proceeding, please review and confirm:

1. **Scope**: Is the proposed scope appropriate? Should we focus on specific areas?

2. **Priorities**: Which areas are most important to you?
   - [ ] Code generation improvements
   - [ ] API ergonomics
   - [ ] Build system changes
   - [ ] All of the above

3. **Constraints**: Are there any constraints I should know about?
   - API stability requirements?
   - Backward compatibility needs?
   - Performance requirements?

4. **Timeline**: Is 1 week appropriate, or should we adjust?

5. **Pulumi Comparison**: How closely do you want to follow Pulumi patterns?
   - Strict alignment
   - Inspired by but adapted for your domain
   - Only where it makes sense

---

## Next Steps

Upon approval:
1. Begin Phase 1 audit with T01.1 (proto2schema analysis)
2. Document findings in checkpoint files
3. Present findings before Phase 3 implementation

---

**Please review this plan and provide feedback. I'll capture your review in `T01_1_review.md` and create a revised plan based on your input.**
