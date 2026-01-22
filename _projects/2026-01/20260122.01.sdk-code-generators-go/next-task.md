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

📋 **Phase**: Initial Planning  
📝 **Current Task**: T01 - Task Plan Review  
⏳ **Waiting For**: Developer approval of initial plan

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

### ⏸️ Currently Paused - Awaiting Review

**Before proceeding**, I need your review of the initial task plan:

1. **Review**: Read `tasks/T01_0_plan.md`
2. **Provide Feedback**: Any changes, concerns, or suggestions?
3. **Questions to Address**:
   - Does the task breakdown look complete?
   - Are the timelines realistic (1-2 weeks total)?
   - Should we prioritize workflows or agents first, or parallel?
   - Should we build proto2schema converter first, or start with manual schemas?

### ▶️ After Approval

Once you approve (or provide feedback):
1. I'll create `tasks/T01_1_review.md` with your feedback
2. Create `tasks/T01_2_revised_plan.md` if changes needed
3. Create `tasks/T01_3_execution.md` and begin implementation

---

## High-Level Phases (Planned)

```
Phase 1: Research & Design          (1-2 days)   ⏸️ AWAITING APPROVAL
Phase 2: Proto → Schema Converter   (2-3 days)   ⏳ NOT STARTED
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
