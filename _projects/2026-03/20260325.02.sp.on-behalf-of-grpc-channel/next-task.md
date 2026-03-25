# Next Task: 20260325.02.sp.on-behalf-of-grpc-channel

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260325.01.auto-personal-org
- **Overall Objective**: Build gRPC on-behalf-of infrastructure enabling system (machine account) to create resources attributed to a specific user identity, solving FGA ownership attribution.
- **What's Been Completed**: All 9 implementation steps (Phase 1 + Phase 2)
- **What's Pending**: Integration testing, wiring into Temporal activities (parent project scope)
- **Agreed Focus for This Session**: From plan, next steps
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260325.01.auto-personal-org
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.01.auto-personal-org/next-task.md`
**Spawned From Task**: Task 2

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.01.auto-personal-org/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.01.auto-personal-org/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.01.auto-personal-org/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.01.auto-personal-org/dont-dos/`

---

## Current Status

**Created**: 2026-03-25 10:53
**Current Task**: T01 - Implementation
**Status**: Complete (all 9 steps implemented)

## Session Progress (2026-03-25)

### Accomplished
- Designed and implemented complete on-behalf-of gRPC impersonation infrastructure
- 5 new files created, 4 existing files modified
- All 9 plan steps completed (Phase 1: FGA model + core infra, Phase 2: downstream repos)

### Key Design Decisions Made
1. **Full identity override** (industry standard - Kubernetes, AWS, Microsoft pattern): after impersonation, the effective caller becomes the target user entirely
2. **FGA-based impersonation gate**: `can_impersonate: operator` on platform type ensures only authorized operators can use `x-on-behalf-of` header
3. **RequestCallerIdentity unchanged**: no dual-identity fields; identity model answers "who is the effective caller?"
4. **Silent rejection**: unauthorized impersonation attempts silently ignored (no information leakage)
5. **Sequential provisioning assumption**: identity account creation completes (granting platform FGA permissions) before on-behalf-of operations run

### Files Created (stigmer-cloud)
- `OnBehalfOfMetadata.java` (api-authentication) - shared gRPC metadata key constant
- `OnBehalfOfClientInterceptor.java` (api-authentication) - client interceptor attaching x-on-behalf-of header
- `ImpersonatedChannelFactory.java` (api-authentication) - factory wrapping inProcessChannelAsSystem with impersonation
- `OnBehalfOfAuthorizationGuard.java` (api-authorization) - FGA check for can_impersonate permission
- `OrganizationGrpcRepo.java` + `OrganizationGrpcRepoImpl.java` (stigmer-service) - organization downstream repo

### Files Modified (stigmer-cloud)
- `platform.fga` - added `can_impersonate: operator` permission
- `GrpcRequestContextBuilderInterceptor.java` - FGA-gated full identity override for on-behalf-of calls
- `AgentInstanceGrpcRepo.java` + `AgentInstanceGrpcRepoImpl.java` - added `createOnBehalfOf`
- `ExecutionContextGrpcRepo.java` + `ExecutionContextGrpcRepoImpl.java` - added `createOnBehalfOf`

### Files NOT Modified (by design)
- `RequestCallerIdentity.java` - identity model stays clean
- `CreateAuthorizationTuplesStepV2.java` - already uses `getIdentityAccountId()` which is the target user after override
- `RequestAuthorizationService.java` - works correctly with target user
- No new migration needed - machine account already has `operator` role granting `can_impersonate`

## Next Steps

1. **Wire into Temporal activities** (parent project scope): Use `ImpersonatedChannelFactory` and `createOnBehalfOf` methods in provisioning workflows
2. **Integration testing**: Verify end-to-end impersonation flow with actual FGA checks
3. **Return to parent project**: Resume auto-personal-org to implement the provisioning Temporal workflow

## Context for Resume

- The `@Lazy` injection pattern on `OnBehalfOfAuthorizationGuard` is critical to prevent circular dependency during Spring bean initialization (same pattern as `RequestAuthorizationService`)
- The in-process FGA check in the interceptor does NOT have `x-on-behalf-of` header, preventing infinite loop
- Machine account is already bootstrapped as `platform:stigmer#operator` via `U20250102_InsertBootstrapIdentityAccounts` migration
- `grpc-request` BUILD.bazel already depends on both `api-authentication` and `api-authorization`, so no dependency changes needed

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/next-task.md`

---

## Sub-Project: 20260325.02.sp.on-behalf-of-grpc-channel

**Description**: Build gRPC on-behalf-of infrastructure for in-process calls, enabling the system (machine account) to create resources attributed to a specific user identity. Solves the FGA ownership problem when system-created resources (personal orgs, execution contexts, default agent instances) get incorrectly owned by the machine account instead of the actual user.
**Goal**: Create OnBehalfOfClientInterceptor, ImpersonatedChannelFactory, and server-side interceptor changes so that downstream gRPC clients can create resources with correct FGA ownership attribution to the actual user instead of the machine account.
**Tech Stack**: Java/Spring, gRPC, OpenFGA, Bazel

## Essential Files to Review

### 1. Latest Checkpoint
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.01.auto-personal-org/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.01.auto-personal-org/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.01.auto-personal-org/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.01.auto-personal-org/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.01.auto-personal-org/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint from `checkpoints/`
3. [ ] Check current task status in `tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Quick Commands

After loading context:
- "Continue with next steps" - Wire into Temporal activities
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
