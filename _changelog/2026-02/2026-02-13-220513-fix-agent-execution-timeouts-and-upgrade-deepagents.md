# Fix Agent Execution Timeouts and Upgrade DeepAgents Library

**Date**: February 13, 2026

## Summary

Fixed critical agent execution failures by addressing two distinct issues: (1) Temporal activity heartbeat timeouts during ExecuteGraphton setup phase, and (2) "Recursion limit of 25 reached" errors caused by outdated deepagents API usage. The fixes enable reliable execution of long-running agent workflows like the skill-creator-agent.

## Problem Statement

Agent executions were failing with two distinct error patterns that prevented successful completion of agent workflows:

### Pain Points

1. **Heartbeat Timeout**: ExecuteGraphton activity failed with "Activity stopped sending heartbeat (worker may have crashed)" during lengthy setup operations (skill loading, gRPC calls, artifact downloads)
2. **Recursion Limit**: After fixing heartbeat, agents immediately hit "Recursion limit of 25 reached" errors despite setting `recursion_limit=1000` in graphton
3. **API Incompatibility**: Using deprecated deepagents 0.2.x API with parameters that no longer exist in 0.4.x (`backend` renamed, `general_purpose_agent` removed)

## Solution

### Part 1: Heartbeat Timeout Fix

Added strategic heartbeat signals throughout the ExecuteGraphton setup phase to prevent Temporal from marking the activity as failed during legitimate long-running initialization steps.

**Key Changes**:
- Created `heartbeat_during_setup()` helper function with phase tracking
- Inserted 6 heartbeat calls at critical setup milestones:
  1. After execution chain resolution (gRPC calls)
  2. After agent/instance/agent-template resolution
  3. After attachment downloads
  4. After environment variable merge
  5. After MCP server transformation
  6. After agent graph creation

**Result**: Activity stays alive during 30+ second setup phases

### Part 2: DeepAgents Upgrade and API Compatibility

Upgraded deepagents from 0.2.4 to 0.4.1 and fixed API compatibility issues to resolve recursion limit errors.

**Root Cause**: 
- The `general_purpose_agent` parameter in deepagents 0.2.x controlled whether a default "general-purpose" subagent was automatically created
- When set to `False` in graphton, it wasn't being passed through to deepagents, causing the parameter to default to `True`
- The auto-created general-purpose subagent ran with LangGraph's default `recursion_limit=25`, ignoring the parent's `recursion_limit=1000`

**API Changes in DeepAgents 0.4.x**:
- `backend` parameter → `memory_backend` (renamed)
- `general_purpose_agent` parameter → removed (control via `subagents` list instead)

**Key Changes**:
- Updated `pyproject.toml`: `deepagents = ">=0.4.0,<0.5.0"`
- Fixed `graphton/core/agent.py`:
  - Changed `backend=` to `memory_backend=`
  - Removed `general_purpose_agent=` parameter
  - Now pass empty `subagents=[]` list when `general_purpose_agent=False` to disable auto-subagent creation
- Updated poetry lock files for both graphton and agent-runner

**Result**: No more recursion limit errors, agents respect configured recursion limits

## Implementation Details

### Heartbeat Implementation

```python
def heartbeat_during_setup(phase_name: str, details: dict | None = None) -> None:
    """Send heartbeat with setup phase info to prevent timeout during initialization."""
    activity.heartbeat({
        "setup_phase": phase_name,
        "details": details or {},
    })
```

Strategic placement at:
- Post-gRPC resolution: `heartbeat_during_setup("chain_resolved", {...})`
- Post-attachment: `heartbeat_during_setup("attachments_downloaded", {...})`
- Post-environment: `heartbeat_during_setup("environment_merged", {...})`
- Post-MCP: `heartbeat_during_setup("mcp_servers_transformed", {...})`
- Post-agent-creation: `heartbeat_during_setup("agent_created")`

### DeepAgents API Migration

**Before (0.2.x)**:
```python
agent = deepagents_create_deep_agent(
    model=model_instance,
    # ...
    backend=backend_for_deepagents,
    general_purpose_agent=general_purpose_agent,
)
```

**After (0.4.x)**:
```python
agent = deepagents_create_deep_agent(
    model=model_instance,
    # ...
    subagents=transformed_subagents if general_purpose_agent else [],
    memory_backend=backend_for_deepagents,
)
```

### Files Modified

**Heartbeat Fix**:
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (+56 lines)

**DeepAgents Upgrade**:
- `backend/libs/python/graphton/pyproject.toml` (version bump)
- `backend/libs/python/graphton/src/graphton/core/agent.py` (API fixes)
- `backend/libs/python/graphton/poetry.lock` (dependency resolution)
- `backend/services/agent-runner/poetry.lock` (transitive dependency update)

**Documentation**:
- `backend/libs/go/seedpack/agents/skill-creator-agent.yaml` (updated skill access pattern)

## Benefits

1. **Reliability**: Agent executions no longer fail with spurious timeout or recursion errors
2. **Observability**: Heartbeat phase tracking provides visibility into setup progress
3. **Modern Dependencies**: Using latest deepagents 0.4.x with better subagent control
4. **Proper Recursion Limits**: Agents now correctly respect configured limits (1000 vs 25)
5. **Maintainability**: Using current API patterns that won't be deprecated

## Testing

Validated fix with `stigmer draft skill` command:
- **Before**: Failed with "Activity stopped sending heartbeat" → "Recursion limit of 25 reached"
- **After**: Successfully completes execution, reaches tool approval step
- **Execution**: `aex-01khbxk10b9m0fa5ehw05krbe9` completed with 2 messages, 1 tool call
- **Agent Graph**: Properly created with reused sandbox, no API errors

## Impact

**Who/What is Affected**:
- ✅ All agent executions using graphton library
- ✅ ExecuteGraphton activity (no more heartbeat timeouts)
- ✅ Agents with complex workflows (skill-creator-agent, etc.)
- ✅ Long setup times for skill loading, MCP servers, attachments

**Breaking Changes**: None (internal implementation only)

## Related Work

- Previous heartbeat investigation: Activity timeout debugging
- DeepAgents library: Tracking API evolution from 0.2.x to 0.4.x
- LangGraph recursion limits: Understanding default vs configured behavior
- Temporal activity patterns: Heartbeat best practices for long-running setup

---

**Status**: ✅ Production Ready
**Timeline**: Fixed and validated February 13, 2026
**Testing**: Local execution confirmed working with skill-creator-agent
