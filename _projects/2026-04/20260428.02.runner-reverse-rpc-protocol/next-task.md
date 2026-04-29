# Next Task: 20260428.02.runner-reverse-rpc-protocol

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260428.02.runner-reverse-rpc-protocol

**Description**: Replace the hand-rolled request-response protocol (oneof command bag + StreamRegistry + request_id correlation) on the runner bidi stream with a proper gRPC reverse tunnel pattern, eliminating manual dispatch, improving extensibility, and enabling standard tooling.
**Goal**: Adopt a gRPC reverse tunnel (e.g. grpctunnel or equivalent) so the server can invoke typed, codegen'd RPCs on the runner through the existing client-initiated connection — removing the StreamRegistry, oneof command bags, manual request_id correlation, and multi-site dispatch switches.
**Tech Stack**: Go, gRPC, Protocol Buffers, Connect-RPC
**Components**: apis/ai/stigmer/agentic/runner/v1/ (proto definitions: io.proto, command.proto), backend/services/stigmer-server/pkg/domain/runner/controller/ (StreamRegistry, connect handler, sendCommand), client-apps/cli/internal/cli/daemon/ (runner_stream.go, runner_stream_commands.go), sdk/typescript/ and sdk/react/ (sendCommand callers)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.02.runner-reverse-rpc-protocol/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-28 20:06
**Current Task**: T01 (Feasibility and Library Evaluation)
**Status**: PENDING REVIEW — task plan created, awaiting developer review before execution

## Session Progress (2026-04-29)

- Created project folder and bootstrapped structure
- Wrote detailed T01 task plan covering: library evaluation (grpctunnel + Connect-RPC compatibility), cloud routing assessment, PoC prototype, proto changes, server/CLI/SDK migration, backward compatibility
- Identified key risks: grpctunnel + Connect-RPC compatibility, cloud pod routing, migration safety
- **Separate UX work completed**: Workspace selector UX upgrade (committed as `5b1092509`) — runner context header, recent/favorite paths, type-ahead input, directory caching, desktop native dialog

## Next Steps

1. Review `tasks/T01_0_plan.md` and provide feedback
2. Once approved, begin Phase 1: evaluate `jhump/grpctunnel` for Connect-RPC compatibility
3. Build a minimal PoC: runner registers `RunnerLocalService` through tunnel, server calls `ListDirectory` through it

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
