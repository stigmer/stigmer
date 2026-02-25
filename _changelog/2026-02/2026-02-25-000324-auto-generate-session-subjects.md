# Auto-Generate Session Subjects via Economy-Tier LLM

**Date**: February 25, 2026

## Summary

Added automatic session subject generation that replaces the hardcoded "Auto-created session" with a concise, meaningful conversation title (similar to ChatGPT/Claude). The feature runs as a fire-and-forget Temporal activity alongside main agent execution, using an economy-tier LLM (claude-haiku-4, gpt-4o-mini, or the configured local model) to keep costs negligible.

## Problem Statement

When users create agent executions without specifying a session, the system auto-creates a session with the hardcoded subject "Auto-created session". This makes it impossible to distinguish sessions in the UI — every session looks the same.

### Pain Points

- Sessions list shows dozens of identically-named "Auto-created session" entries
- Users must click into each session to remember what conversation it contains
- No context at a glance — the session list provides zero information value

## Solution

A new Temporal activity `GenerateSessionSubject` that runs fire-and-forget alongside the main agent execution. It uses the user's first message and agent context to generate a 3-7 word title via an economy-tier LLM, then updates the session subject via gRPC.

The activity is provider-agnostic — it works with Anthropic, OpenAI, and Ollama through the existing `ModelRegistry` and `parse_model_string()` infrastructure.

## Implementation Details

### Python Activity (stigmer repo)

New file `backend/services/agent-runner/worker/activities/generate_session_subject.py`:

- Follows the slim-payload pattern: receives only `execution_id`, hydrates execution/session/agent via gRPC
- Sentinel detection: only generates when `subject == "Auto-created session"` (preserves user-set subjects)
- Model selection: `ModelRegistry.get_summarization_model()` picks the cheapest model for the configured provider
- Raw text prompt (not structured output) for universal provider compatibility
- All exceptions caught and logged — never propagated to the main execution flow

Worker registration in `worker/worker.py` — activity added alongside ExecuteGraphton, EnsureThread, and CleanupSandbox.

### Java Workflow (stigmer-cloud repo)

New interface `GenerateSessionSubjectActivity.java` with `@ActivityMethod(name = "GenerateSessionSubject")`.

Wired into `InvokeAgentExecutionWorkflowImpl.java`:
- Activity stub with 60s timeout, `setMaximumAttempts(1)` (best-effort, no retries)
- Called via `Async.procedure()` between EnsureThread (Step 1) and ExecuteGraphton (Step 2)
- Non-blocking: main execution proceeds immediately without waiting

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Model selection | `ModelRegistry.get_summarization_model()` | Provider-agnostic, cost-efficient |
| Output format | Raw text prompt | Universal provider support (Ollama doesn't always support structured output) |
| Execution model | Separate Temporal activity | Clean separation, independent lifecycle |
| Orchestration | `Async.procedure()` fire-and-forget | Non-blocking, failure-tolerant |
| Detection | Sentinel string check | Simple, no proto changes needed |

## Benefits

- **User experience**: Sessions have meaningful, distinguishable names in the UI
- **Zero degradation**: If generation fails, the existing "Auto-created session" persists
- **Cost-efficient**: Economy-tier models (haiku/gpt-4o-mini) cost fractions of a cent per title
- **Provider-agnostic**: Works with Anthropic, OpenAI, and Ollama without configuration changes
- **Clean architecture**: Separate activity with no changes to the main execution path

## Impact

- **End users**: Session lists become immediately useful for finding past conversations
- **Agent execution flow**: Zero impact — fire-and-forget, non-blocking
- **Deployment**: Cross-repo change — Python activity deployed first, Java workflow second

## Related Work

- Session creation flow: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go` (hardcoded subject at line 356)
- Session proto: `apis/ai/stigmer/agentic/session/v1/spec.proto` (subject field)
- Prior art: `planton/backend/services/agent-fleet-worker/worker/activities/generate_session_subject.py` (reference, not carried over)

---

**Status**: ✅ Production Ready (pending Task 4: end-to-end testing)
**Timeline**: ~1 hour (exploration + planning + implementation)
