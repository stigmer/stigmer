# Next Task: 20260325.03.wire-on-behalf-of-impersonation

## 🎯 Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260325.03.wire-on-behalf-of-impersonation  
**Description**: Wire the existing on-behalf-of gRPC impersonation infrastructure into all createAsSystem call sites in stigmer-service, add invoker identity to Temporal workflow inputs, and convert agent-runner and workflow-runner to use x-on-behalf-of header for all downstream gRPC calls. Also clean up agent_execution FGA model and evaluate adding execution_context FGA type.  
**Goal**: Ensure all system-created resources (ExecutionContext, AgentInstance, WorkflowInstance) are FGA-owned by the actual user, and all runner gRPC operations execute as the invoking user via on-behalf-of impersonation — not the machine account.  
**Tech Stack**: Java/gRPC, Python, Go, OpenFGA, Temporal, Bazel  
**Components**: stigmer-service domain handlers, downstream gRPC repos, FGA models, Temporal workflow inputs, agent-runner gRPC clients, workflow-runner gRPC clients

**Created**: 2026-03-25  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.03.wire-on-behalf-of-impersonation
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.03.wire-on-behalf-of-impersonation/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### 📖 Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.03.wire-on-behalf-of-impersonation/README.md
```
Project overview, goals, and success criteria.

### 📝 Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.03.wire-on-behalf-of-impersonation/notes.md
```
Important decisions, learnings, and gotchas captured during development.

---

## Resume Checklist

When starting a new session, quickly review:

1. [ ] Open `tasks.md` and check current task status
2. [ ] Review any recent notes in `notes.md`
3. [ ] Continue with the current task or move to next

That's it! No complex structure - just focused work.

---

## Prerequisite

This project depends on `20260325.02.sp.on-behalf-of-grpc-channel` (COMPLETE). All impersonation infrastructure is built. This project wires it in.

---

## Current Status

**Last Updated**: 2026-03-25
**Status**: In Progress — Operator propagation removed; remaining work is build validation + end-to-end testing

### Completed (Sessions 1–3 — OBO Infrastructure + Wiring)
- **T07**: Simplified `agent_execution.fga` owner relation (removed redundant `operator from session`)
- **T01**: Converted ExecutionContext creation to `createOnBehalfOf` (2 call sites)
- **T02**: Converted AgentInstance auto-creation to `createOnBehalfOf` (3 call sites)
- **T03**: Added `createOnBehalfOf` to WorkflowInstanceGrpcRepo + converted callers (2 repo files + 2 call sites)
- **T04**: Thread invoker identity through Temporal workflow inputs (cross-repo: Java, Go, Python)
- **T05/T06**: Full OBO wiring plan — FGA/proto auth changes, pipeline reordering, agent-runner + workflow-runner OBO channels
- **T08**: Architectural decision — ExecutionContext uses derived auth from parent execution (no dedicated FGA model)

### Completed (Session 4 — ExecutionContext Derived Auth + Runner OBO Fixes)

This session completed the derived authorization model for ExecutionContext and fixed OBO channel usage in agent-runner:

#### ExecutionContext Derived Authorization Service (stigmer-cloud — NEW)
- Created `ExecutionContextDerivedAuthorization` shared Spring `@Component` — encapsulates "try agent_execution, then workflow_execution" FGA check pattern
- Single method: `isAuthorized(caller, executionId, permission)` — reused by all ExecutionContext handlers

#### ExecutionContext Handler Refactoring (stigmer-cloud — 6 handlers)
- **CreateHandler**: Replaced `commonSteps.authorize` with custom step checking `can_edit` on parent execution
- **GetHandler**: Reordered pipeline (load before authorize), custom step checking `can_view` on parent
- **GetByReferenceHandler**: Replaced operator check with derived auth (`can_view` on parent)
- **GetByExecutionIdHandler**: Delegated inline auth to shared service
- **DeleteHandler**: Reordered pipeline (load before authorize), custom step checking `can_edit` on parent
- **ApplyHandler**: Updated Javadoc to document inherited authorization

#### Agent Runner OBO Fixes (stigmer — Python)
- `generate_session_subject.py`: Switched session update and agent execution read to OBO channel
- `execute_graphton.py`: Split execution client — `execution_query_client` (OBO for reads), `execution_client` (system for `updateStatus`)

#### Proto + Documentation Updates (stigmer)
- Updated `command.proto`, `query.proto`, `api.proto` comments — replaced "operator-only" with derived auth documentation

#### Key Bug Fix
- Discovered latent bug: `commonSteps.authorize` (`AuthorizeRequestStepV2`) fails with `Status.INTERNAL` for OBO calls when `is_skip_authorization=true` is set without `RpcAuthorizationConfig` — all handlers now use custom auth steps to avoid this

### Session 4 Checkpoint
```
checkpoints/2026-03-25-session-4.md
```

### Commits
- `e0547c56` (stigmer-cloud): `feat(backend/stigmer-service): wire on-behalf-of impersonation into all createAsSystem call sites`
- `4f00e47a` (stigmer): `docs(projects): update wire-on-behalf-of task status and add changelog`
- `e3f53251` (stigmer): `feat(backend): thread invoker identity through Temporal workflow inputs`
- `7d4e384d` (stigmer-cloud): `feat(backend/stigmer-service): thread invoker identity through Temporal workflow inputs`
- *(pending)* Session 4 changes — uncommitted across both repos

### Completed (Session 5 — Remove Operator Propagation)

Removed the entire transitive `operator` propagation chain from the FGA model. This was a natural extension of the OBO work — with impersonation in place, operator propagation to every resource was redundant.

- Rewrote `platform.fga` with 4 explicit platform-level permissions
- Simplified all 16 FGA type definitions (removed `operator` relation, `or operator` unions)
- Deleted `createPlatformLink` RPC, handler, and service method
- Updated `ApiResourceIamPermission` enum (reserved `operator`/`platform`/`can_update_status`, added `can_bootstrap_iam`/`can_manage_identity_accounts`/`can_update_execution_status`)
- Changed `updateStatus` RPCs to platform-level `can_update_execution_status` check
- Updated bootstrap migration, handlers, tests, and Javadoc
- **Net result**: 165 lines added, 868 lines deleted across stigmer-cloud; 53 added, 85 deleted in stigmer

#### Commits
- `3c2b21e3` (stigmer): `refactor(apis): remove operator propagation from FGA authorization model`
- `43926471` (stigmer-cloud): `refactor(backend): remove operator propagation from FGA model and Java backend`

### Remaining Work
- Build and validate all changes (Bazel for Java, Go vet, Python syntax)
- End-to-end test: trigger agent execution and verify OBO + derived auth flows through
- End-to-end test: trigger workflow execution and verify OBO + derived auth flows through
- Verify `can_update_execution_status` FGA permission resolves correctly for operator (platform-level check now)
- Follow-up: data migration to clean stale platform-link tuples from FGA store

---

## Quick Commands

After loading this file into chat, you can say:

- **"Show current status"** - Get overview of all tasks and progress
- **"Continue with current task"** - Resume work on in-progress task
- **"What's next?"** - Move to next task
- **"Update task X to done"** - Mark a task complete
- **"Add a note"** - Capture a quick learning or decision
- **"Complete project"** - Final wrap-up when all tasks done

---

*Quick Project Framework: Minimal overhead, maximum focus. When structure helps, not hinders.*
