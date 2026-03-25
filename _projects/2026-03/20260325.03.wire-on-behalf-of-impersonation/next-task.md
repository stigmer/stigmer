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
**Status**: In Progress — T05, T06, T08 complete; remaining work is testing + T07/T08 review

### Completed (previous sessions)
- **T07**: Simplified `agent_execution.fga` owner relation (removed redundant `operator from session`)
- **T01**: Converted ExecutionContext creation to `createOnBehalfOf` (2 call sites)
- **T02**: Converted AgentInstance auto-creation to `createOnBehalfOf` (3 call sites)
- **T03**: Added `createOnBehalfOf` to WorkflowInstanceGrpcRepo + converted callers (2 repo files + 2 call sites)
- **T04**: Thread invoker identity through Temporal workflow inputs (cross-repo: Java, Go, Python)

### Completed (this session — OBO impersonation wiring)

This session implemented the full OBO wiring plan across both repos:

#### FGA + Proto Authorization Changes
- Added `operator` relation + `can_update_status` permission to `agent_execution.fga` and `workflow_execution.fga`
- Added `can_update_status = 28` to `ApiResourceIamPermission` enum
- Changed `updateStatus` RPCs from `can_edit` to `can_update_status` in both execution command protos
- Set `is_skip_authorization=true` on all ExecutionContext RPCs (derived auth from parent execution)

#### Pipeline Reordering (stigmer-cloud)
- Reordered both `AgentExecutionCreateHandler` and `WorkflowExecutionCreateHandler` pipelines to: `createAuthorizationTuples → createExecutionContext → persist`
- Ensures FGA tuples exist before ExecutionContext creation; runtime_env cleared before persist

#### ExecutionContext Derived Auth (stigmer-cloud)
- Rewrote `ExecutionContextGetByExecutionIdHandler.Authorize` to check `can_view` on parent `agent_execution` or `workflow_execution` (tries both, passes if either authorizes)

#### Agent Runner OBO (Python)
- Created `OnBehalfOfInterceptor` (`x-on-behalf-of` header injection)
- Extended `ChannelProvider` with dual-channel: `channel` (system) + `obo_channel` (impersonated)
- Wired OBO in `execute_graphton.py`: read clients use OBO, `execution_client` stays system for `updateStatus`
- Wired OBO in `generate_session_subject.py`: added `invoker_identity_account_id` parameter, updated Java interface

#### Workflow Runner OBO (Go)
- Created `WithOnBehalfOf` context helper in `pkg/grpc_client/on_behalf_of.go`
- Wired OBO in `execute_workflow_activity.go`: `oboCtx` for reads, plain `ctx` for `updateStatus`
- Fixed missing auth headers in `task_builder_call_agent_activities.go` + wired OBO via `buildAuthenticatedContext`
- Added `InvokerIdentityAccountID` to `TemporalWorkflowInput`, stored in workflow state, threaded to task builder

#### T08 Decision: ExecutionContext FGA Model
- Architectural decision: ExecutionContext is ephemeral (1:1 with parent, created and deleted within execution lifecycle) — a dedicated FGA model would be over-engineering
- Solution: derive authorization from parent execution (`can_view` on `agent_execution` or `workflow_execution`)
- No FGA tuples created for ExecutionContext; `is_skip_authorization=true` on all RPCs with handler-level custom auth

### Commits
- `e0547c56` (stigmer-cloud): `feat(backend/stigmer-service): wire on-behalf-of impersonation into all createAsSystem call sites`
- `4f00e47a` (stigmer): `docs(projects): update wire-on-behalf-of task status and add changelog`
- `e3f53251` (stigmer): `feat(backend): thread invoker identity through Temporal workflow inputs`
- `7d4e384d` (stigmer-cloud): `feat(backend/stigmer-service): thread invoker identity through Temporal workflow inputs`

### Remaining Work
- Build and validate all changes (Bazel for Java, Go vet, Python syntax)
- End-to-end test: trigger agent execution and verify OBO header flows through
- End-to-end test: trigger workflow execution and verify OBO header flows through
- Verify `can_update_status` FGA permission resolves correctly for operator

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
