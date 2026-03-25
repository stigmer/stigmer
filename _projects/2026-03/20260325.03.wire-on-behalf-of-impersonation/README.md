# 20260325.03.wire-on-behalf-of-impersonation

## Overview
Wire the existing on-behalf-of gRPC impersonation infrastructure into all createAsSystem call sites in stigmer-service, add invoker identity to Temporal workflow inputs, and convert agent-runner and workflow-runner to use x-on-behalf-of header for all downstream gRPC calls. Also clean up agent_execution FGA model and evaluate adding execution_context FGA type.

**Created**: 2026-03-25  
**Estimated Time**: 1-4 hours  
**Status**: 🚧 In Progress

## Goal
Ensure all system-created resources (ExecutionContext, AgentInstance, WorkflowInstance) are FGA-owned by the actual user, and all runner gRPC operations execute as the invoking user via on-behalf-of impersonation — not the machine account.

## Technology Stack
Java/gRPC, Python, Go, OpenFGA, Temporal, Bazel

## Affected Components
stigmer-service domain handlers, downstream gRPC repos, FGA models, Temporal workflow inputs, agent-runner gRPC clients, workflow-runner gRPC clients

## Success Criteria
- Goal achieved
- Tests passing
- Changes validated

## Quick Links
- [Tasks](tasks.md) - Task breakdown and progress
- [Notes](notes.md) - Quick notes and learnings
- [Resume](next-task.md) - **Drag this into chat to resume!**

## Project Type
⚡ **Quick Project** - Designed to complete in 1-2 sessions with minimal overhead.

## Status Summary

Check [tasks.md](tasks.md) for detailed progress tracking.

Update this section as you make progress:
- Current phase: [Analysis/Implementation/Testing/Complete]
- Blockers: [None/List any blockers]
- Next up: [What's next after current task]

## Notes Summary

Key learnings and decisions are captured in [notes.md](notes.md).

---

*This project follows the Next Quick Project Framework for fast, focused development.*

