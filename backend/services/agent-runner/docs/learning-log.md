# Agent Runner Learning Log

**Purpose**: Organized record of lessons learned during agent-runner implementation.

**Organization**: By topic (not chronological) for easy lookup.

**Usage**: Check here BEFORE implementing to avoid known issues.

---

## Temporal Activities

### 2026-01-16 - System Error Recovery and Status Updates

**Problem**: When system errors occurred (workflow type not found, activity registration issues, connection failures), the execution status in MongoDB remained in "pending" or "in_progress" state forever. Users had no visibility that the execution had failed.

**Root Cause**:
- Java workflow caught and re-threw exceptions but didn't update execution status
- Python activities only handled business logic errors, not system errors during initialization
- Temporal marked workflows as failed internally, but user-facing status wasn't updated
- System errors (e.g., "Activity not registered") occurred before activity logic could run

**Solution**: Add top-level system error handler in Python activity:

```python
@activity.defn(name="ExecuteGraphton")
async def execute_graphton(execution: AgentExecution, thread_id: str) -> AgentExecutionStatus:
    try:
        # Delegate to main implementation
        return await _execute_graphton_impl(execution, thread_id, ...)
    except Exception as system_error:
        # Top-level handler for system errors
        failed_status = AgentExecutionStatus(
            phase=ExecutionPhase.EXECUTION_FAILED,
            error=f"System error: {str(system_error)}",
            messages=[
                Message(role="system", content="Internal system error occurred. Please contact support."),
                Message(role="system", content=f"Error details: {str(system_error)}")
            ]
        )
        
        # Update status in database (best effort)
        try:
            execution_client = AgentExecutionClient(get_api_key())
            await execution_client.update_status(execution_id, failed_status)
        except Exception as update_error:
            logger.error(f"Failed to update status: {update_error}")
        
        return failed_status
```

**Java Workflow Layer**: Added try-catch with UpdateExecutionStatusActivity call:

```java
@Override
public void run(AgentExecution execution) {
    try {
        executeGraphtonFlow(execution);
    } catch (Exception e) {
        // Update execution status before re-throwing
        AgentExecutionStatus failedStatus = AgentExecutionStatus.newBuilder()
            .setPhase(ExecutionPhase.EXECUTION_FAILED)
            .addMessages(Message.newBuilder()
                .setRole("system")
                .setContent("Internal system error occurred. Please contact support.")
                .build())
            .build();
        
        updateStatusActivity.updateExecutionStatus(executionId, failedStatus);
        throw new RuntimeException("Workflow execution failed: " + e.getMessage(), e);
    }
}
```

**Implementation**:
1. Created top-level error handler wrapping entire activity
2. Created `_execute_graphton_impl()` for main implementation (existing try-except preserved)
3. Added `UpdateExecutionStatusActivity` in Java (runs on execution-persistence queue)
4. System errors now update status before Temporal marks workflow as failed

**Benefits**:
- ✅ Users always see accurate execution status in UI
- ✅ System errors don't leave executions in limbo
- ✅ Error messages help users understand what went wrong
- ✅ Support teams have error details for troubleshooting
- ✅ Two-layer error handling: business logic errors + system errors

**Prevention**:
- Always wrap activity entry point with top-level try-except for system errors
- Update execution status before re-throwing/returning error
- Test with simulated system errors (activity not registered, connection failures)
- Monitor for executions stuck in non-terminal phases

**Related**: Java workflow error handling (InvokeAgentExecutionWorkflowImpl.java), UpdateExecutionStatusActivity

---

### 2026-01-15 - Activities Cannot Call Other Activities

**Problem**: Python activity tried to invoke Java activity using `temporal_client.start_activity()`. Got error: `'Client' object has no attribute 'start_activity'`.

**Root Cause**: 
1. Temporal Python SDK doesn't have `start_activity()` method
2. **Fundamental Temporal design**: Activities cannot invoke other activities
3. Only workflows can orchestrate activity calls

**Solution**: Use correct polyglot pattern:

```python
# ❌ Wrong: Activity trying to call activity
@activity.defn(name="ExecuteAgent")
async def execute_agent(...):
    status = build_status()
    # This doesn't work - activities can't call activities!
    await temporal_client.start_activity("PersistStatus", status)

# ✅ Correct: Activity returns data, workflow orchestrates
@activity.defn(name="ExecuteAgent")
async def execute_agent(...):
    status = build_status()
    # Return to workflow - workflow calls persistence activity
    return status
```

**Workflow orchestration**:
```java
// Workflow receives and passes data between activities
AgentExecutionStatus status = pythonActivity.executeAgent(execution);
javaActivity.persistStatus(executionId, status);
```

**Prevention**: 
- Always use workflow for orchestration
- Activities should be pure functions (input → output)
- Never try to invoke activities from activities
- Check Temporal docs before implementing cross-service calls

**Related Docs**: 
- [Architecture: Polyglot Temporal Workflow](architecture/polyglot-temporal-workflow.md)
- [Implementation: Polyglot Migration](implementation/polyglot-workflow-migration.md)
- [Temporal Docs: Activities](https://docs.temporal.io/activities#activities-cannot-call-other-activities)

**Example**: See `worker/activities/execute_graphton.py` - builds status locally, returns to workflow

---

### 2026-01-15 - Return Values Over Side Effects in Activities

**Problem**: Activity was trying to persist status (side effect) instead of returning it.

**Root Cause**: Mixing concerns - execution activity shouldn't know about persistence.

**Solution**: Activities should return data, let workflow handle side effects:

```python
# ❌ Wrong: Side effect in activity
@activity.defn(name="ProcessData")
async def process_data(...):
    result = compute()
    await persist(result)  # ❌ Side effect - mixing concerns

# ✅ Correct: Return data
@activity.defn(name="ProcessData")
async def process_data(...):
    result = compute()
    return result  # ✅ Let workflow decide what to do
```

**Benefits**:
- Clean separation of concerns
- Testable (pure function)
- Workflow controls orchestration
- Observable in Temporal UI

**Prevention**:
- Think of activities as functions: input → processing → output
- Keep side effects in separate activities
- Let workflow orchestrate when side effects happen

**Related Docs**: [Guide: Activity Design Best Practices](guides/polyglot-workflow-guide.md#best-practices)

---

### 2026-01-15 - Progressive Status Updates via gRPC

**Problem**: Users couldn't see agent execution progress in real-time. Status was only available after completion.

**Root Cause**: Temporal activities can't call other activities. The Python activity was building status locally and returning it once at the end.

**Solution**: Send progressive status updates via gRPC during execution:

```python
@activity.defn(name="ExecuteGraphton")
async def execute_graphton(...):
    execution_client = AgentExecutionClient(token_manager)
    
    # Process events and send updates progressively
    async for event in agent_graph.astream_events(...):
        await status_builder.process_event(event)
        
        # Send status update every 10 events
        if events_processed % 10 == 0:
            await execution_client.update(execution_id, status_builder.current_status)
    
    # Final update
    await execution_client.update(execution_id, status_builder.current_status)
    return status_builder.current_status
```

**Custom Build Step** (stigmer-service):
Created `BuildNewStateWithStatusStep` that **merges** status updates instead of clearing them (standard behavior clears status for spec-only updates).

**Benefits**:
- ✅ Real-time progress visibility
- ✅ Simple pattern (direct gRPC calls)
- ✅ Low overhead
- ✅ Best-effort delivery (execution continues on failure)

**Related Docs**: [Architecture: Agent Execution Workflow](architecture/agent-execution-workflow.md)

---

## Error Handling

### 2026-01-15 - Return Failed Status Instead of Throwing

**Problem**: When Python activity threw exception, execution just showed "activity failed" with no details in DB.

**Root Cause**: Throwing exception fails the activity, but doesn't allow graceful error persistence.

**Solution**: Return failed status instead of throwing (for business errors):

```python
@activity.defn(name="ExecuteAgent")
async def execute_agent(...):
    try:
        # Execute agent
        status = build_status()
        status.phase = ExecutionPhase.EXECUTION_COMPLETED
        return status
        
    except Exception as e:
        # Build error status
        status.phase = ExecutionPhase.EXECUTION_FAILED
        status.messages.append(error_message)
        
        # Return failed status (don't throw)
        return status  # ✅ Workflow can persist gracefully
```

**When to throw**: Infrastructure failures (should retry):
```python
# ✅ Throw for transient errors (Temporal retries)
except ConnectionError as e:
    raise  # DB down - let Temporal retry
```

**Benefits**:
- Failed executions have proper error messages in DB
- Frontend shows user-friendly errors
- Workflow can handle failure gracefully
- Audit trail preserved

**Prevention**:
- Return error status for business logic failures
- Throw only for infrastructure failures (should retry)
- Always set phase to FAILED before returning error status

**Example**: See `worker/activities/execute_graphton.py` error handling

---

## Status Building

### 2026-01-15 - Pure Status Builder Pattern

**Problem**: `ExecutionStatusUpdater` mixed status building with persistence attempts.

**Root Cause**: Tried to do too much (build + persist) in one class.

**Solution**: Create pure StatusBuilder that only builds locally:

```python
class StatusBuilder:
    """Builds execution status locally - no persistence."""
    
    def __init__(self, execution_id: str, initial_status):
        self.current_status = initial_status
        self.tool_call_fingerprints = set()
    
    async def process_event(self, event: Dict[str, Any]):
        # Update self.current_status
        # No persistence - just local building
```

**Usage**:
```python
# In activity
builder = StatusBuilder(execution_id, execution.status)
async for event in agent_graph.astream_events(...):
    await builder.process_event(event)

# Return to workflow
return builder.current_status
```

**Benefits**:
- Single responsibility (just builds status)
- No side effects
- Easy to test
- Clear separation from persistence

**Prevention**:
- Keep status building separate from persistence
- Activities should be pure builders
- Let workflow handle persistence orchestration

**Example**: See `worker/activities/graphton/status_builder.py`

---

## Build System & Bazel Configuration

### 2026-01-15 - Bazel + Poetry Integration for Python Services

**Problem**: Agent-runner needed proper Bazel integration but Poetry manages dependencies. Initial attempts failed with "Poetry could not find pyproject.toml" when running from Bazel.

**Root Cause**: Bazel runs from its sandbox/execroot (e.g., `/private/var/tmp/_bazel_*/execroot/_main/bazel-out/...`), not from the actual source directory where `pyproject.toml` lives.

**Solution**: Use `BUILD_WORKSPACE_DIRECTORY` environment variable to find source directory:

```bash
# backend/services/agent-runner/run.sh
#!/usr/bin/env bash
set -euo pipefail

# Bazel sets BUILD_WORKSPACE_DIRECTORY when using 'bazel run'
# This points to the actual source directory, not the sandbox
WORKSPACE_ROOT="${BUILD_WORKSPACE_DIRECTORY}"
SERVICE_DIR="${WORKSPACE_ROOT}/backend/services/agent-runner"

# Change to source directory where pyproject.toml lives
cd "${SERVICE_DIR}"

# Now Poetry can find pyproject.toml
exec poetry run python main.py "$@"
```

**Proper BUILD.bazel Structure** (matches agent-fleet-worker from Planton):

```bazel
load("@rules_python//python:defs.bzl", "py_binary", "py_library")

# Library with service sources
py_library(
    name = "agent_runner_lib",
    srcs = glob([
        "worker/**/*.py",
        "grpc_client/**/*.py",
    ]),
    imports = ["."],
)

# Python binary
py_binary(
    name = "agent_runner_bin",
    srcs = ["main.py"],
    main = "main.py",
    deps = [":agent_runner_lib"],
    data = glob([".env"], allow_empty = True),
)

# Wrapper that runs via Poetry
sh_binary(
    name = "agent_runner",
    srcs = ["run.sh"],
    args = ["$(location :agent_runner_bin)"],
    data = [":agent_runner_bin"] + glob([".env"], allow_empty = True),
)
```

**Run Configuration** (IntelliJ):
```xml
<configuration type="BazelRunConfigurationType">
    <bsp-target>@//backend/services/agent-runner:agent_runner</bsp-target>
</configuration>
```

**Benefits**:
- ✅ Proper Bazel integration (IDE shows Bazel icon)
- ✅ Poetry dependency management preserved
- ✅ Consistent with other services (workflow-runner, stigmer-service)
- ✅ Matches proven pattern from agent-fleet-worker
- ✅ Works with `bazel run` and IDE launch

**Prevention**:
- Always use `BUILD_WORKSPACE_DIRECTORY` for finding source from Bazel sandbox
- Never try to run Poetry from Bazel's execroot
- Structure: `py_library` + `py_binary` + `sh_binary` wrapper
- Let python-dotenv handle `.env` loading (don't source in shell)

**Common Mistakes**:
- ❌ Sourcing `.env` file in shell script (causes "command not found" errors for values)
- ❌ Using `SCRIPT_DIR` instead of `BUILD_WORKSPACE_DIRECTORY`
- ❌ Missing `py_library` target (only having `sh_binary`)
- ❌ Not passing `BUILD_WORKSPACE_DIRECTORY` through to script

**Related Docs**:
- Changelog: `_changelog/2026-01/2026-01-15-230000-unify-env-loading-across-all-services.md`
- Pattern source: `@planton/backend/services/agent-fleet-worker`

**Example**: See `backend/services/agent-runner/BUILD.bazel` and `run.sh`

---

## Documentation Organization

This learning log is organized by topic (not chronologically) because:
- ✅ Easy to find solutions to specific problems
- ✅ Related learnings grouped together
- ✅ Can scan topic headers quickly
- ✅ Builds knowledge base by category

**How to use**:
1. Having an issue? Check the relevant topic section first
2. Found a solution? Add it under appropriate topic
3. New topic? Create new section with clear header
4. Related solutions? Cross-reference them

**Complete Documentation**: See `docs/README.md` for full catalog.
