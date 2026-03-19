# Next Task: 20260319.03.sp.env-auth-and-secret-redaction

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

## Sub-Project: 20260319.03.sp.env-auth-and-secret-redaction

**Description**: Update FGA authorization model to support personal environments (member-level creation permissions) and implement secret value redaction in environment queries with owner-only secret retrieval.
**Goal**: 1) Allow regular org members to create environments and agent instances (FGA can_create_* to member). 2) Add secret redaction to environment get/getByReference RPCs (admins see keys but not values). 3) Add a new owner-only RPC for retrieving unredacted secret values. 4) Add can_read_secrets permission to the FGA model.
**Tech Stack**: TypeScript/React, Go (backend env merge), Protobuf, OpenFGA
**Components**: sdk/react (AgentPicker, useAgentSearch, SessionComposer), sdk/typescript (useCreateSession), backend/libs/go/envmerge (env_spec filtering), client-apps/web (SessionLauncher), FGA model (labels)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.03.sp.env-auth-and-secret-redaction/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.03.sp.env-auth-and-secret-redaction/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.03.sp.env-auth-and-secret-redaction/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.03.sp.env-auth-and-secret-redaction/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.03.sp.env-auth-and-secret-redaction/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.03.sp.env-auth-and-secret-redaction/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.03.sp.env-auth-and-secret-redaction/dont-dos/
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
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.03.sp.env-auth-and-secret-redaction/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.03.sp.env-auth-and-secret-redaction/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-19 13:12
**Current Task**: T01 (Environment Authorization & Secret Redaction)
**Status**: T01.1–T01.3 COMPLETE, T01.4–T01.7 pending
**Last Session**: 2026-03-19, Session 2

## Session Progress (2026-03-19, Session 2)

- Plan approved and T01.1, T01.2, T01.3 implemented (all FGA model changes)
- **T01.1**: `can_create_environment` changed from `admin` to `member` in `organization.fga`
- **T01.2**: `environment.fga` rewritten — removed `admin from organization` from owner, added `creator` relation, added `can_read_secrets: creator` permission
- **T01.3**: `agent_instance.fga` — removed `admin from organization` from owner
- Updated FGA model README.md with new "Personal" access pattern
- Created FGA changelog: `2026-03-19-personal-resources-auth-model.md`
- Committed to stigmer-cloud: `5fd98510`

## Session Progress (2026-03-19, Session 1)

- Bootstrapped sub-project from parent `20260319.02.agent-picker-personal-env`
- Analyzed current backend implementation — discovered:
  - Secret redaction ALREADY implemented in `RedactSecretValues` step (both `get` and `getByReference`)
  - Agent instance creation doesn't need org-level FGA change (uses `can_create_instance` on Agent)
  - Secret encryption at rest already done (AES-256-GCM via `EnvironmentSecretService`)
- Scope reduced from 5+ items to 3 actual changes needed:
  1. FGA: `can_create_environment: admin` → `member` (blocker for personal env flow)
  2. FGA: Add `can_read_secrets` permission + `creator` relation
  3. Proto + Backend: Add `getSecretValue` RPC (creator-only unredacted reads)
- Wrote detailed T01_0_plan.md — awaiting review

## Next Steps

1. **T01.4** (stigmer-cloud): Write `creator` FGA tuple on environment creation in `EnvironmentCreateHandler` and `EnvironmentApplyHandler`
2. **T01.5** (stigmer OSS): Add `getSecretValue` RPC + `EnvironmentSecretValueInput` message to proto
3. **T01.6** (stigmer-cloud): Implement `EnvironmentGetSecretValueHandler` (single key decrypt)
4. **T01.7** (stigmer OSS): Verify `getSecretValue` in TypeScript SDK after proto generation

T01.4 and T01.5 can be done in parallel (different repos). T01.6 depends on both.

## Context for Resume

- The `creator` relation is in the FGA model but no tuples are written yet (T01.4)
- The `can_read_secrets` permission exists in FGA but no RPC uses it yet (T01.5/T01.6)
- `CreateAuthorizationTuplesStepV2` in `grpc-request` lib handles tuple creation via `IamPolicyCreationService.createTuples()` — need to add `creator` tuple alongside the existing `owner` tuple
- Execution engine reads secrets via `ExecutionContext.getByExecutionId` (internal path with `DecryptSecretValues`), not through user-facing RPCs — unaffected by these changes

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
