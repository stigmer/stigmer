# Tasks: 20260224.01.auto-generate-session-subject

**Created**: 2026-02-24

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Explore and document the session creation flow and identify the best injection point for subject generation

**Status**: ✅ DONE
**Created**: 2026-02-24 23:44
**Completed**: 2026-02-24 23:45

### Subtasks
- [x] Find where "Auto-created session" is hardcoded
- [x] Map the session creation flow (agentexecution controller -> session controller)
- [x] Identify session proto definition and updatable fields
- [x] Check agent-runner for existing capabilities (session client, user message access)
- [x] Document potential injection points and approaches

### Findings

**Hardcoded subject**: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go:356`

**Best injection points identified:**
1. **Go side (creation time)**: In `createSessionIfNeededStep.Execute()` - can use `execution.Spec.Message` to set an initial subject
2. **Python side (after first turn)**: In `execute_graphton.py` - can use LLM to generate a smart title and update via `session_client.update()`

**Recommendation**: Use the Python agent-runner (after first turn) for LLM-based subject generation, similar to how ChatGPT generates titles. The agent runner already has `session_client` and `execution.spec.message` available.

See `notes.md` for full exploration details.

## Task 2: Implement subject generation logic (either in Go at session creation using the first user message, or in Python agent-runner after the first turn with LLM-based summarization)

**Status**: ✅ DONE
**Created**: 2026-02-24 23:44
**Completed**: 2026-02-25 00:03

### Subtasks
- [x] Deep codebase exploration: execute_graphton.py flow, session client, model registry, Temporal workflow
- [x] Design plan with architecture diagram, key design decisions, and cross-repo change map
- [x] Create Python Temporal activity `GenerateSessionSubject` in stigmer repo
- [x] Provider-agnostic model selection via `ModelRegistry.get_summarization_model()` + `parse_model_string()`
- [x] Register activity in `worker/worker.py`

### Notes
- Chose Python LLM-based approach (Option B from Task 1 findings) for ChatGPT-style smart titles
- Uses economy-tier model (claude-haiku-4 / gpt-4o-mini / local model) to keep costs negligible
- Raw text prompt instead of structured output for universal provider compatibility
- Sentinel detection: checks `subject == "Auto-created session"` to avoid overwriting user-set subjects
- Fire-and-forget: errors logged but never propagated — non-critical path
- Follows slim-payload pattern: receives only `execution_id`, hydrates via gRPC

## Task 3: Add session subject update mechanism to update subject after first agent response

**Status**: ✅ DONE
**Created**: 2026-02-24 23:44
**Completed**: 2026-02-25 00:03

### Subtasks
- [x] Create Java activity interface `GenerateSessionSubjectActivity.java` in stigmer-cloud repo
- [x] Add activity stub in `InvokeAgentExecutionWorkflowImpl.java` (60s timeout, 1 attempt max)
- [x] Wire fire-and-forget `Async.procedure()` call between EnsureThread and ExecuteGraphton
- [x] Import `io.temporal.workflow.Async` in workflow

### Notes
- Task 2 and Task 3 were naturally one unit — generation logic and update mechanism live in the same activity
- Cross-repo changes: Python activity in stigmer, Java interface + workflow wiring in stigmer-cloud
- Deployment order matters: Python activity first, Java workflow second
- Activity runs via `Async.procedure()` — does not block main agent execution

## Task 4: Test and validate the end-to-end flow

**Status**: ⏸️ TODO
**Created**: 2026-02-24 23:44

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

