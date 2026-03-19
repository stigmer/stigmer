# Next Task: 20260319.05.sp.sdk-labels-and-env-var-ops

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260319.02.agent-picker-personal-env
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260319.02.agent-picker-personal-env
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/next-task.md`
**Spawned From Task**: Phase 2 preparation

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260319.05.sp.sdk-labels-and-env-var-ops

**Description**: Add labels support to all SDK resource input types (codegen fix) and add incremental environment variable management RPCs (updateVariables, removeVariables) with backend sentinel defense-in-depth.
**Goal**: 1) Add optional labels field to ALL SDK resource input types and wire into build*Proto functions. 2) Add updateVariables proto RPC to EnvironmentCommandController (server-side merge of new/changed vars). 3) Add removeVariables proto RPC to EnvironmentCommandController (remove specific keys). 4) Implement Go OSS handlers for both new RPCs. 5) Implement Java Cloud handlers for both new RPCs (with encryption awareness). 6) Add backend sentinel defense-in-depth: update handlers preserve existing secret values when redaction marker is sent back. 7) Add SDK TypeScript client methods + React hooks for the new RPCs.
**Tech Stack**: TypeScript/React, Go (backend env merge), Protobuf, OpenFGA
**Components**: sdk/react (AgentPicker, useAgentSearch, SessionComposer), sdk/typescript (useCreateSession), backend/libs/go/envmerge (env_spec filtering), client-apps/web (SessionLauncher), FGA model (labels)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-19 16:50
**Current Task**: T01 — Track A complete, Tracks B/C/D pending
**Status**: In Progress

## Session Progress (2026-03-19)

### Track A: SDK Labels Codegen Fix — COMPLETE

**What was accomplished:**
- Modified all 4 codegen generators (Go, TypeScript, Java, Python) to emit `labels` field
- Added `Labels` to `metaFieldNames` set defensively
- Regenerated all 17 resource client files across all 4 SDKs (68 files total)
- Verified: Go compiles, TypeScript has zero errors in generated files, all codegen tests pass
- All 17 resource input types confirmed to have labels in all 4 languages

**Files modified (source changes):**
- `tools/codegen/generator/sdk_client.go` — metaFieldNames + Go input struct + toProto metadata
- `tools/codegen/generator/sdk_client_ts.go` — TS input interface + buildProto metadata (both branches)
- `tools/codegen/generator/sdk_client_java.go` — Java field + builder + conditional putAllLabels
- `tools/codegen/generator/sdk_client_python.go` — Python dataclass field + conditional metadata.labels.update()

**Design decisions:**
- Labels only (not tags/visibility) — scoped to immediate need
- Conditional wiring: labels are only set in metadata when provided (no behavioral change for existing callers)
- Java uses separate `metaBuilder` variable for clean conditional `putAllLabels`
- Python builds metadata separately to allow `ScalarMapContainer.update()`

### What's Pending (Tracks B, C, D)

- **Track B**: Environment Variable Management RPCs (`updateVariables`, `removeVariables`)
  - T01.4–T01.12: Proto messages, stubs, Go OSS handlers, Java Cloud handlers
- **Track C**: Backend Sentinel Defense-in-Depth
  - T01.13–T01.14: Redaction marker preservation in update pipelines
- **Track D**: SDK TypeScript Client + React Hooks
  - T01.15–T01.18: TypeScript client methods, React hooks, barrel exports

## Next Steps

1. **Track B — Proto definitions** (T01.4–T01.5): Add `UpdateEnvironmentVariablesRequest` and `RemoveEnvironmentVariablesRequest` messages to `io.proto`, add RPCs to `command.proto`
2. **Track B — Regenerate stubs** (T01.6): Run proto generation for all languages
3. **Track B — Go OSS handlers** (T01.7–T01.9): Implement `updateVariables` and `removeVariables` handlers
4. **Track B — Java Cloud handlers** (T01.10–T01.12): Implement with encryption awareness
5. **Track C — Sentinel defense** (T01.13–T01.14): After Track B understanding
6. **Track D — SDK + React** (T01.15–T01.18): After Track B stubs exist

## Context for Resume

- Track A is fully complete and committed
- React hooks (`useCreateEnvironment`, `useUpdateEnvironment`) automatically accept labels via TypeScript structural typing — no React code changes needed
- The `usePersonalEnvironment.getOrCreate()` can now set `labels: { "stigmer.ai/personal": "true" }` at creation time
- Track B is the critical path — it's sequential (proto → stubs → Go → Java) and has the most open questions (see T01 plan open questions section)

## Quick Commands

After loading context:
- "Continue with Track B" - Start proto definitions for variable management RPCs
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
