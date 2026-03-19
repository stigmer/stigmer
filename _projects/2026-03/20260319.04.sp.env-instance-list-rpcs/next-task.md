# Next Task: 20260319.04.sp.env-instance-list-rpcs

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

## Sub-Project: 20260319.04.sp.env-instance-list-rpcs

**Description**: Add label-based list RPCs for environments, agent instances, and other resource types that currently lack list/query capabilities. Enables personal resource lookup via labels instead of deterministic slug conventions, establishing a reusable pattern for all resource kinds.
**Goal**: 1) Add list RPC with label filtering to EnvironmentQueryController. 2) Add list RPC with label filtering to AgentInstanceQueryController. 3) Implement Go backend handlers (OSS). 4) Implement Java backend handlers with FGA visibility (cloud). 5) Update SDK codegen schemas and regenerate TypeScript clients. 6) Establish a reusable pattern for adding label-based list RPCs to other resource types.
**Tech Stack**: TypeScript/React, Go (backend env merge), Protobuf, OpenFGA
**Components**: sdk/react (AgentPicker, useAgentSearch, SessionComposer), sdk/typescript (useCreateSession), backend/libs/go/envmerge (env_spec filtering), client-apps/web (SessionLauncher), FGA model (labels)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.04.sp.env-instance-list-rpcs/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.04.sp.env-instance-list-rpcs/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.04.sp.env-instance-list-rpcs/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.04.sp.env-instance-list-rpcs/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.04.sp.env-instance-list-rpcs/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.04.sp.env-instance-list-rpcs/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.04.sp.env-instance-list-rpcs/dont-dos/
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
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.04.sp.env-instance-list-rpcs/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.04.sp.env-instance-list-rpcs/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-19 15:01
**Current Task**: T01 (Proto + SDK complete, backend handlers pending)
**Status**: In Progress

## Session Progress (2026-03-19)

### Completed
- T01.1: Added `ListEnvironmentsRequest`, `EnvironmentList`, and `list` RPC to `EnvironmentQueryController`
- T01.2: Added `ListAgentInstancesRequest` and `list` RPC to `AgentInstanceQueryController`
- T01.8a: Created `useEnvironmentList` and `useAgentInstanceList` generic list hooks
- T01.8b: Created `usePersonalEnvironment` and `usePersonalAgentInstance` convenience hooks
- All barrel exports updated (module-level and top-level `index.ts`)
- Committed: `965277a0` on `feat/add-customize-ui`

### Key Decisions
- **Pagination**: Chose offset-based `PageInfo { num, size }` (Convention A) over cursor-based, consistent with `GetAgentInstancesByAgentRequest`
- **Field naming**: `page_info` (not `page`) for consistency within agent instance resource type
- **"Personal" concept**: Lives as a label convention at SDK layer, NOT in proto definitions. Proto is generic `list(org, labels, page_info)`.
- **`usePersonalAgentInstance`**: Accepts `agentId?: string` instead of `ResourceRef` — simpler, avoids unnecessary resolution
- **Codegen schemas**: Auto-generated from protos, no manual changes needed (corrected from original plan)

### Cancelled
- T01.7 (codegen schemas): Not needed — auto-generated from proto definitions

### Remaining (Next Session)
- T01.3: Go backend handler for environment list (stigmer OSS)
- T01.4: Go backend handler for agent instance list (stigmer OSS)
- T01.5: Java backend handler for environment list with FGA (stigmer-cloud)
- T01.6: Java backend handler for agent instance list with FGA (stigmer-cloud)

## Next Steps
1. Implement Go handler for environment list (T01.3) — pipeline: ValidateProto -> ListByOrgAndLabels -> RedactSecretValues
2. Implement Go handler for agent instance list (T01.4) — pipeline: ValidateProto -> ListByOrgAndLabels
3. Implement Java handlers with FGA-filtered queries (T01.5, T01.6) in stigmer-cloud
4. Run `buf generate` (or equivalent) to regenerate TypeScript proto stubs from the new proto definitions

## Context for Resume
- The `list` RPCs use `is_skip_authorization = true` — authorization must be handled in-handler via FGA (cloud) or unrestricted (OSS)
- Environment list MUST apply `RedactSecretValues` to each item (same as get/getByReference)
- The `AgentInstanceList` response type already existed and is reused; `EnvironmentList` was newly created
- Existing list RPC patterns to reference: `Session.list` (session query controller), `AgentExecution.list` (agent execution query controller)
- For Go handler patterns, check existing environment controller at `backend/services/stigmer-server/pkg/domain/environment/controller/`

## Quick Commands

After loading context:
- "Continue with T01.3" - Implement Go environment list handler
- "Continue with T01.5" - Implement Java environment list handler
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
