# Next Task: 20260319.06.secrets-flow-hardening

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260319.06.secrets-flow-hardening

**Description**: Fix implementation flaws in the secrets-providing SDK: fragile ref-based state in Layer 2 hooks, naming inconsistencies across bounded contexts, dual-path session creation API, missing Execution Flow UI in Console, weak error messages across secret flows, and incorrect CLI commands in documentation.
**Goal**: Harden the React SDK Layer 2 orchestration for the Environment Flow, fix documentation inaccuracies, clean up naming/API inconsistencies, surface the Execution Flow in Console UI, and improve error messages — bringing the secrets infrastructure to state-of-the-art quality across all surfaces.
**Tech Stack**: TypeScript/React (SDK hooks and components), Protobuf (naming fixes), Java (backend naming/merge service), Go (CLI command verification)
**Components**: @stigmer/react Layer 2 hooks (useAgentSetup, usePersonalEnvironment, usePersonalAgentInstance, SessionComposer), docs/product/how-to-provide-secrets.md, proto definitions (environment_refs vs env_refs), backend EnvironmentMergeService, CLI environment/agent-instance commands

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.06.secrets-flow-hardening/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-19 20:08
**Current Task**: T02 (useAgentSetup Hardening)
**Status**: Ready to start

## Session Progress (2026-03-20, Session 3)

- **T03 completed**: Renamed `env_refs` to `environment_refs` in WorkflowInstanceSpec
  - Renamed proto field in `spec.proto` (field number 3 unchanged — binary wire compatible)
  - Added CEL validation rule enforcing `kind=environment` (parity with AgentInstanceSpec)
  - Updated all comments in `command.proto`, `query.proto`, `io.proto`
  - Regenerated all stubs: Go, Java, TS, Python proto stubs + SDK gen files (Go, TS, Java, Python) + MCP server gen
  - Updated 3 hand-written Java files in stigmer-cloud backend:
    - `WorkflowInstanceCreateHandler.java` — accessor and variable names
    - `CreateExecutionContextStep.java` — accessor, variable names, comments, log messages
    - `EnvironmentMergeServiceTest.java` — test method name and @DisplayName
  - Verified builds: stigmer Go SDK clean, stigmer-cloud Bazel backend (307 source files) clean
  - Committed: `bd1fca76` on `feat/add-customize-ui-2` (stigmer), `a307f32c` on `main` (stigmer-cloud)
- **Surprise finding during T03**: WorkflowInstanceSpec had no CEL validation on `env_refs`, while AgentInstanceSpec had one on `environment_refs`. Added the validation rule during rename to achieve full parity. User approved.

## Earlier Session Progress (2026-03-20, Sessions 1-2)

- **T01 completed**: Fixed incorrect CLI commands in `docs/product/how-to-provide-secrets.md`
  - Committed: `6c941c85` on `feat/add-customize-ui-2`
- **T04 completed**: Enforced mutual-exclusion on `CreateSessionInput` agent fields
  - Committed: `5636cf5a` on `feat/add-customize-ui-2`
- **Design decision during T04**: Removed the "backend default agent" path from `useCreateSession`. The React hook now requires explicit agent selection.
- **Decision on Change 3 (--env-file / --secret-file)**: Not yet decided — deferred for user input

## Next Steps

1. **Start T02** — `useAgentSetup` hardening with unified save-or-use-once model (largest task)
   - Replace ref-based pending state with `useReducer` state machine
   - Compose `usePersonalAgentInstance` instead of duplicating instance creation
   - Extract `diffEnvSpec` as a pure function
   - Add `saveForFuture` flag with dual-path routing (saved vs one-time)
   - Update `AgentEnvForm` with "Save for future runs" toggle
   - Update `SessionComposer` to consume the new `ReadyResult` shape
   - Read `T01_2_revised_plan.md` for full T02 spec
2. Then T05 — Follow-up message one-time secrets input
3. Then T06 — Error messages across secret flows

## Context for Resume

- The revised plan (`T01_2_revised_plan.md`) is the authoritative task breakdown — all decisions resolved, all tasks approved
- Execution order: T01 (done) -> T04 (done) -> T03 (done) -> T02 -> T05 -> T06
- Checkpoint: `checkpoints/2026-03-20-session-3.md` — covers T03 execution and validation parity decision
- Working branch: `feat/add-customize-ui-2` (stigmer)
- stigmer-cloud T03 committed directly to `main`

## Quick Commands

After loading context:
- "Start T02" - Begin the useAgentSetup hardening task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
