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

## Task Dependency Graph

```
T01 (ExecutionContext OBO) ─────────┐
T02 (AgentInstance OBO) ────────────┤── stigmer-cloud in-process changes
T03 (WorkflowInstance OBO method) ──┘
         │
T04 (Temporal workflow inputs) ──── bridge: stigmer protos + stigmer-cloud starters
         │
    ┌────┴────┐
T05 (Agent runner OBO)    T06 (Workflow runner OBO) ── stigmer runner changes
    └────┬────┘
         │
T07 (agent_execution.fga cleanup) ── FGA model
T08 (execution_context FGA type) ── FGA model (can be parallel)
```

T01-T03 are independent of each other and can be done in parallel.
T04 must come before T05/T06.
T07-T08 are independent and can be done anytime.

---

## Current Status

**Last Updated**: Check tasks.md for most recent status
**Current Focus**: See which task is marked 🚧 IN PROGRESS in tasks.md

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

