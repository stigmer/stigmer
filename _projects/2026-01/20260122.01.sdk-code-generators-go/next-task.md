# Next Task - SDK Code Generators Project

**Project**: SDK Code Generators (Go) - Workflows & Agents  
**Location**: `_projects/2026-01/20260122.01.sdk-code-generators-go/`  
**Status**: 🟡 PENDING PLAN REVIEW  
**Last Updated**: 2026-01-22

---

## Quick Resume

**Drag this file into chat to resume work on this project.**

---

## Current Status

📋 **Phase**: Phase 2 - Proto → Schema Converter  
📝 **Current Task**: Building proto2schema tool  
🟢 **Status**: IMPLEMENTING

---

## What We're Building

A Pulumi-inspired code generation framework that:
- Eliminates manual proto-to-Go conversion logic
- Generates type-safe SDK builders for workflows and agents
- Makes adding new task types trivial (proto + codegen run)

---

## Project Files

### Core Documents
- 📘 **Project Overview**: `_projects/2026-01/20260122.01.sdk-code-generators-go/README.md`
- 📋 **Current Task Plan**: `_projects/2026-01/20260122.01.sdk-code-generators-go/tasks/T01_0_plan.md`
- 📂 **All Tasks**: `_projects/2026-01/20260122.01.sdk-code-generators-go/tasks/`

### Supporting Folders
- 🎯 **Checkpoints**: `_projects/2026-01/20260122.01.sdk-code-generators-go/checkpoints/`
- 🏗️ **Design Decisions**: `_projects/2026-01/20260122.01.sdk-code-generators-go/design-decisions/`
- 📏 **Coding Guidelines**: `_projects/2026-01/20260122.01.sdk-code-generators-go/coding-guidelines/`
- ⚠️ **Wrong Assumptions**: `_projects/2026-01/20260122.01.sdk-code-generators-go/wrong-assumptions/`
- 🚫 **Don't-Dos**: `_projects/2026-01/20260122.01.sdk-code-generators-go/dont-dos/`

---

## Next Actions

### 🟢 Currently Working - Phase 2

**Building the proto2schema converter**:

1. ✅ Phase 1 complete - Design documents created
2. 🔄 Create `tools/codegen/proto2schema/` tool
3. 🔄 Parse proto files using `protoreflect`
4. 🔄 Extract field metadata (names, types, validations, comments)
5. 🔄 Convert to JSON schema format
6. 🔄 Generate schemas for all 13 workflow tasks

**What's Being Built**:
- CLI tool: `tools/codegen/proto2schema/main.go`
- Proto parser using Go's `protoreflect` package
- Schema generator that outputs JSON files
- Validation logic to ensure schemas are complete

---

## High-Level Phases (Progress)

```
Phase 1: Research & Design          (2 hours)    ✅ COMPLETE
Phase 2: Proto → Schema Converter   (2-3 days)   🟢 IN PROGRESS
Phase 3: Code Generator Engine      (3-4 days)   ⏳ NOT STARTED
Phase 4: Workflow Integration       (2-3 days)   ⏳ NOT STARTED
Phase 5: Agent Integration          (2-3 days)   ⏳ NOT STARTED
Phase 6: Examples Migration         (1-2 days)   ⏳ NOT STARTED
Phase 7: Documentation & Polish     (1-2 days)   ⏳ NOT STARTED
Phase 8: Validation & Handoff       (1 day)      ⏳ NOT STARTED
```

---

## Key References

- **Pulumi Codegen**: `/Users/suresh/scm/github.com/pulumi/pulumi/pkg/codegen/`
- **Stigmer Protos**: `apis/ai/stigmer/agentic/workflow/v1/`, `apis/ai/stigmer/agentic/agent/v1/`
- **Current SDK**: `sdk/go/workflow/`, `sdk/go/agent/`
- **ADR Document**: `docs/adr/20260118-181912-sdk-code-generators.md`

---

## To Resume This Project

Simply drag this file (`next-task.md`) into the chat, and I'll:
1. Load the current state
2. Review progress
3. Continue from where we left off

---

**Current Status**: 🟡 Waiting for plan review and approval
