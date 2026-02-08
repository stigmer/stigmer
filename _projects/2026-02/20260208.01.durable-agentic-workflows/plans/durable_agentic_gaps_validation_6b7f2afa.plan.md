---
name: Durable Agentic Gaps Validation
overview: Validated research report gaps against Stigmer codebase. Confirmed 8 of 9 gaps exist. Priority is Gap A1 (crash recovery) and A2 (tool idempotency) to enable activity retries and claim "durable agentic workflows".
todos:
  - id: extend-heartbeat
    content: Add checkpoint_id to Activity heartbeat payload in execute_graphton.py
    status: pending
  - id: build-tool-ledger
    content: Create tool call ledger with idempotency key generation and storage
    status: pending
  - id: wrap-tool-execution
    content: Wrap tool execution with ledger lookup to return cached results on retry
    status: pending
  - id: checkpoint-resume
    content: Implement checkpoint resume logic - read heartbeat details on retry, resume LangGraph from checkpoint
    status: pending
  - id: enable-retries
    content: Enable activity retries in InvokeAgentExecutionWorkflowImpl.java after idempotency is implemented
    status: pending
  - id: test-crash-recovery
    content: Test crash recovery - verify agent resumes from checkpoint without duplicate tool calls
    status: pending
isProject: false
---

# Durable Agentic Workflows - Gap Validation Complete

## Validation Results

The research report's gap analysis is **accurate**. All major gaps were confirmed against the actual codebase.

### Critical Discovery

Activity retries are **disabled** in [InvokeAgentExecutionWorkflowImpl.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowImpl.java) (line 134):

```java
.setMaximumAttempts(1)  // No retries - "agent execution not idempotent"
```

This defensive workaround means the system **fails instead of recovering** from crashes. Fixing Gap A1 and A2 will allow enabling retries for true durability.

---

## Prioritized Implementation Roadmap

### Phase 0: Make Agent Steps Durable (Category-Defining)

**Gap A1: Crash Recovery Resume** (Highest Priority)

- Add `checkpoint_id` to heartbeat payload in [execute_graphton.py](stigmer/backend/services/agent-runner/worker/activities/execute_graphton.py)
- On activity retry, read last heartbeat details
- Resume LangGraph from that checkpoint instead of restarting
- Files to modify:
  - `execute_graphton.py` - heartbeat with checkpoint_id
  - `InvokeAgentExecutionWorkflowImpl.java` - enable retries after idempotency is solved

**Gap A2: Tool Idempotency** (Highest Priority)

- Implement idempotency keys: `(workflow_execution_id, agent_task_id, tool_name, tool_call_index)`
- Add tool call ledger to store outcomes
- On retry, return stored result instead of re-executing
- Files to modify:
  - `tool_wrappers.py` - wrap tools with idempotency check
  - New: `tool_ledger.py` - ledger storage/lookup

**Gap A3: Pause/Resume Propagation** (Medium Priority)

- Add pause/resume workflow lifecycle commands
- Propagate pause into agent runs (checkpoint + exit cleanly)
- Files to modify:
  - `lifecycle_steps.go` - add pause/resume
  - `execute_graphton.py` - handle pause signal

### Phase 1: Production Reliability

**Gap B1: Signal-With-Start**

- Implement race-proof event delivery for webhooks
- Use Temporal's SignalWithStart API in event ingress

**Gap B2: Event Correlation + Dedupe**

- Build event ingress gateway with correlation keys
- Add dedupe store (Redis or database)

### Phase 2: Enterprise Features

- Gap B3: Human task system (SLAs, escalation)
- Gap B4: Workflow versioning + pinning
- Gap B5: Saga/compensation semantics
- Gap B6: ISO 8601 wait semantics

---

## Recommended Next Task

**Start with Gap A1 + A2 together** because:

1. They are interdependent (can't enable retries without both)
2. They unlock the "durable agentic workflows" claim
3. Foundation exists (heartbeats, checkpointer) - just needs connection

### Specific Implementation Steps for A1 + A2

1. **Extend heartbeat payload** to include `checkpoint_id` from LangGraph
2. **Build tool call ledger** with idempotency key generation
3. **Wrap tool execution** with ledger lookup before execution
4. **Implement checkpoint resume** logic on activity retry
5. **Enable activity retries** (`setMaximumAttempts(3)`)
6. **Test crash recovery** - verify agent resumes from checkpoint

