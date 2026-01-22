# Task 01: Initial Task Plan - SDK Code Generators

**Status**: 🟡 PENDING REVIEW  
**Created**: 2026-01-22

---

## Overview

Build a Pulumi-inspired code generation framework for the Stigmer Go SDK. This eliminates manual proto-to-Go conversion logic and enables type-safe, extensible builders for workflows and agents.

---

## Context

**Current State**:
- Manual conversion between Go SDK types and Protocol Buffers
- 13 workflow task types, each requiring custom conversion logic
- Agent, skills, MCP servers also need similar patterns
- Adding new task types = lots of boilerplate

**Desired State**:
- Schema-driven code generation (proto → schema → Go code)
- Adding new task = update proto + run codegen
- Type-safe builders with IDE support
- Consistent patterns across all resource types

**Inspiration**:
- Pulumi's codegen approach (`/Users/suresh/scm/github.com/pulumi/pulumi/pkg/codegen/`)
- Schema as intermediate representation
- Template-based code generation

---

## High-Level Tasks

### 1. Research & Design (1-2 days)

**1.1 Study Pulumi's Code Generation**
- [ ] Read Pulumi's `schema.Package` definition
- [ ] Understand Pulumi's Go code generator (`pkg/codegen/go/gen.go`)
- [ ] Analyze Pulumi's template patterns
- [ ] Document key insights in `design-decisions/`

**1.2 Design Stigmer Schema Format**
- [ ] Define JSON schema structure for task types
- [ ] Define JSON schema structure for agent resources
- [ ] Create example schemas for 2-3 task types
- [ ] Validate schema can represent all current features
- [ ] Document schema design in `design-decisions/01-schema-format.md`

**1.3 Plan Code Generation Strategy**
- [ ] Decide on template engine (text/template vs alternatives)
- [ ] Plan generated code structure (`sdk/go/workflow/gen/`, etc.)
- [ ] Define what gets generated vs what stays manual
- [ ] Create architectural diagram
- [ ] Document in `design-decisions/02-codegen-strategy.md`

**Deliverable**: Design documents with clear architectural decisions

---

### 2. Proto → Schema Converter (2-3 days)

**2.1 Build Proto Parser**
- [ ] Create tool: `tools/codegen/proto2schema/`
- [ ] Parse workflow task proto files
- [ ] Extract field names, types, validations, comments
- [ ] Handle nested messages (e.g., HttpEndpoint)
- [ ] Handle enums and repeated fields

**2.2 Generate JSON Schemas**
- [ ] Convert parsed proto to JSON schema format
- [ ] Generate schemas for all 13 workflow tasks
- [ ] Generate schemas for agent resources
- [ ] Validate generated schemas
- [ ] Store schemas in `tools/codegen/schemas/`

**2.3 Schema Validation**
- [ ] Build schema validator
- [ ] Test against all current task types
- [ ] Ensure no information loss from proto
- [ ] Document schema validation rules

**Deliverable**: Working proto2schema converter + complete schemas

---

### 3. Code Generator Engine (3-4 days)

**3.1 Generator Foundation**
- [ ] Create tool: `tools/codegen/generator/`
- [ ] Set up `text/template` infrastructure
- [ ] Build template loader and renderer
- [ ] Implement file writing with formatting (`gofmt`)
- [ ] Add generation metadata comments

**3.2 Template: Config Structs**
- [ ] Create template for task config structs
- [ ] Handle field types (string, int, map, repeated, nested)
- [ ] Generate struct tags (json, validate)
- [ ] Add documentation comments from proto
- [ ] Test with SetTaskConfig, HttpCallTaskConfig

**3.3 Template: Builders**
- [ ] Create template for task builder functions
- [ ] Generate typed constructors
- [ ] Handle optional vs required fields
- [ ] Add validation logic
- [ ] Test with multiple task types

**3.4 Template: Proto Conversion**
- [ ] Create template for ToProto() methods
- [ ] Create template for FromProto() methods
- [ ] Handle type conversions (string ↔ *string, etc.)
- [ ] Handle nested message conversions
- [ ] Handle google.protobuf.Struct marshaling

**3.5 Integration Testing**
- [ ] Generate code for all 13 task types
- [ ] Verify generated code compiles
- [ ] Run `go build` on generated packages
- [ ] Fix any template issues

**Deliverable**: Working code generator producing valid Go code

---

### 4. Workflow SDK Integration (2-3 days)

**4.1 Generate Workflow Code**
- [ ] Run generator for all workflow tasks
- [ ] Place generated code in `sdk/go/workflow/gen/`
- [ ] Review generated code quality
- [ ] Make template adjustments as needed

**4.2 Update Workflow Package**
- [ ] Update `workflow.go` to import generated types
- [ ] Replace manual task config structs with generated ones
- [ ] Update task builder functions to use generated builders
- [ ] Preserve TaskFieldRef and orchestration logic
- [ ] Update internal conversion logic

**4.3 Fix Tests**
- [ ] Run existing workflow tests
- [ ] Fix import paths
- [ ] Fix type mismatches
- [ ] Ensure all tests pass
- [ ] Add tests for generated code

**4.4 Update Documentation**
- [ ] Update workflow package godoc
- [ ] Add examples using generated types
- [ ] Document migration path

**Deliverable**: Workflow SDK fully using generated code, tests passing

---

### 5. Agent SDK Integration (2-3 days)

**5.1 Generate Agent Code**
- [ ] Run generator for agent resources
- [ ] Place generated code in `sdk/go/agent/gen/`
- [ ] Review generated code quality

**5.2 Update Agent Package**
- [ ] Update `agent.go` to import generated types
- [ ] Replace manual config structs with generated ones
- [ ] Update builder functions
- [ ] Preserve agent orchestration logic

**5.3 Fix Tests**
- [ ] Run existing agent tests
- [ ] Fix any issues
- [ ] Ensure all tests pass

**5.4 Update Documentation**
- [ ] Update agent package godoc
- [ ] Add examples using generated types

**Deliverable**: Agent SDK fully using generated code, tests passing

---

### 6. Examples Migration (1-2 days)

**6.1 Preserve Legacy Examples**
- [ ] Move `sdk/go/examples/` → `sdk/go/examples_legacy/`
- [ ] Document legacy examples as deprecated
- [ ] Keep them for reference during migration

**6.2 Regenerate Examples**
- [ ] Create `sdk/go/examples/` (fresh)
- [ ] Regenerate all workflow examples with new SDK
- [ ] Regenerate all agent examples with new SDK
- [ ] Verify examples compile and run
- [ ] Add comments explaining new patterns

**6.3 Migration Guide**
- [ ] Write `docs/sdk-migration-guide.md`
- [ ] Document API changes
- [ ] Provide before/after code samples
- [ ] List breaking changes

**Deliverable**: Clean examples using new SDK + migration guide

---

### 7. Documentation & Polish (1-2 days)

**7.1 Code Generator Documentation**
- [ ] Write `tools/codegen/README.md`
- [ ] Document how to run the generator
- [ ] Document how to add new task types
- [ ] Document schema format
- [ ] Add troubleshooting guide

**7.2 SDK Documentation**
- [ ] Update `sdk/go/README.md`
- [ ] Document generated code structure
- [ ] Explain relationship between proto and SDK
- [ ] Add architecture diagrams

**7.3 End-to-End Testing**
- [ ] Smoke test: Add a new task type from scratch
- [ ] Verify only proto + codegen run needed
- [ ] Measure time savings vs manual approach
- [ ] Document test results

**Deliverable**: Complete documentation, validated workflow

---

### 8. Validation & Handoff (1 day)

**8.1 Final Validation**
- [ ] Run full test suite
- [ ] Build all packages
- [ ] Run linter
- [ ] Check for missing documentation
- [ ] Verify examples work

**8.2 Future Work Planning**
- [ ] Document Phase 2 requirements (schema validation)
- [ ] Document Phase 3 requirements (new resource types)
- [ ] Create follow-up project proposals

**8.3 Knowledge Transfer**
- [ ] Write handoff document
- [ ] Record any learnings in `wrong-assumptions/`
- [ ] Update `dont-dos/` with anti-patterns

**Deliverable**: Production-ready code generator, clean handoff

---

## Dependencies

- Access to Pulumi codebase (already available)
- Current proto definitions (stable)
- Existing SDK code (reference implementation)

## Risks

1. **Template Complexity**: May need iteration to get templates right
   - *Mitigation*: Start simple, iterate based on real usage

2. **Breaking Changes**: Generated code may differ from manual code
   - *Mitigation*: Backward compatibility layer, phased migration

3. **Edge Cases**: Unusual proto patterns may not convert cleanly
   - *Mitigation*: Handle common cases first, add special handling as needed

## Success Metrics

- ⏱️ **Time to add new task**: < 5 minutes (proto + codegen run)
- 📝 **Lines of manual code**: 0 conversion logic
- ✅ **Test pass rate**: 100%
- 🎯 **Type safety**: Full IDE autocomplete support

---

## Next Steps

**Immediate**:
1. Get approval for this plan
2. Capture any feedback/changes
3. Begin Task 1: Research & Design

**After approval**:
- Create T01_1_review.md with your feedback
- Create T01_2_revised_plan.md if changes needed
- Create T01_3_execution.md and begin implementation

---

## Questions for Review

1. Does the task breakdown look complete?
2. Are the timelines realistic (1-2 weeks total)?
3. Should we prioritize workflows or agents first, or parallel?
4. Any missing considerations?
5. Should we build proto2schema converter first, or start with manual schemas?

---

**Status**: Awaiting developer review and approval
