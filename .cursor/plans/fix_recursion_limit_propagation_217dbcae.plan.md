---
name: Fix Recursion Limit Propagation
overview: "Workstream 3 investigation revealed that the recursion_limit=25 bug has likely been resolved by langchain 1.2.10 (which sets recursion_limit=10,000 by default in create_agent), but uncovered two new issues: a `backend` parameter incompatibility with deepagents 0.4.0 that could prevent agent creation entirely, and an incomplete general_purpose_agent=False workaround. This plan addresses all three issues with a verification-first approach."
todos:
  - id: verify-backend
    content: "Phase 1: Write verification script to test if graphton.create_deep_agent() raises TypeError on `backend` parameter with deepagents 0.4.0"
    status: completed
  - id: verify-recursion
    content: "Phase 1: Inspect compiled graph and subagent graph recursion_limit values with current library versions"
    status: completed
  - id: fix-backend-compat
    content: "Phase 2: Remove `backend` parameter from deepagents call; adapt sandbox tool provisioning to work without it"
    status: completed
  - id: fix-invoke-config
    content: "Phase 2: Add recursion_limit to invoke-time config in execute_graphton.py as defense-in-depth"
    status: completed
  - id: fix-validator
    content: "Phase 2: Update config validator warn threshold (currently 500, platform uses 1000)"
    status: completed
  - id: cleanup-workaround
    content: "Phase 2: Clean up general_purpose_agent=False workaround and stale comments based on collaboration decisions"
    status: completed
  - id: add-tests
    content: "Phase 3: Add tests for recursion_limit behavior and agent creation compatibility"
    status: completed
isProject: false
---

# Workstream 3: Fix Recursion Limit Propagation

## Investigation Findings (Surprises)

The investigation for Workstream 3 uncovered facts that significantly change the scope and nature of this work. Three surprises need discussion before we write code.

### Surprise 1: langchain 1.2.10 already sets recursion_limit=10,000

`langchain.agents.create_agent()` (v1.2.10) now applies `.with_config({"recursion_limit": 10_000})` to every compiled graph it returns (line 939-951 in langchain source). This means:

- **Top-level graph**: gets 10,000 from langchain, then overridden to 1,000 by deepagents (`graph.py:144`), then overridden to 1,000 again by graphton (`agent.py:535`)
- **Subagent graphs** (created inside `SubAgentMiddleware._get_subagents` via `create_agent()`): get 10,000 from langchain, with NO override applied

The original recursion_limit=25 error in [logs.md](_cursor/logs.md) was almost certainly from an older langchain version where `create_agent()` used LangGraph's default of 25. With the current libraries, subagent graphs should have a 10,000 limit.

**Implication**: The recursion_limit bug may already be resolved at the library level. We need to verify before adding complexity.

### Surprise 2: `backend` parameter incompatibility (potential blocker)

[agent.py](backend/libs/python/graphton/src/graphton/core/agent.py) line 530 passes `backend=backend_for_deepagents` to `deepagents_create_deep_agent()`:

```python
agent = deepagents_create_deep_agent(
    model=model_instance,
    tools=tools_list,
    system_prompt=enhanced_prompt,
    middleware=middleware_list,
    subagents=transformed_subagents if general_purpose_agent else [],
    context_schema=context_schema,
    backend=backend_for_deepagents,  # <-- Not accepted by deepagents 0.4.0!
    checkpointer=checkpointer,
)
```

But `deepagents.create_deep_agent` (v0.4.0) does **not** accept a `backend` parameter and has no `**kwargs`:

```
params: ['model', 'tools', 'system_prompt', 'middleware', 'subagents',
         'response_format', 'context_schema', 'checkpointer', 'store',
         'memory_backend', 'interrupt_on', 'debug', 'name', 'cache']
```

This should raise a `TypeError` on every agent creation attempt. If the system was recently working, it may have been on an older deepagents version that DID accept `backend`, or the logs.md output is from a build before the library update.

**Implication**: This is a potential blocker. If agent creation is currently broken, this must be fixed before anything else. We need to verify whether the current code can create agents successfully.

### Surprise 3: `general_purpose_agent=False` workaround is incomplete

Graphton passes `general_purpose_agent=False` from [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) to control subagent behavior. But deepagents' `create_deep_agent` (graph.py line 101-118) **hardcodes** `general_purpose_agent=True` when creating `SubAgentMiddleware`:

```python
SubAgentMiddleware(
    default_model=model,
    default_tools=tools,
    subagents=subagents if subagents is not None else [],
    ...
    general_purpose_agent=True,  # Hardcoded! Ignores graphton's parameter
)
```

So even with `general_purpose_agent=False` in graphton:

- graphton passes `subagents=[]` to deepagents
- deepagents STILL creates the general-purpose subagent with all tools
- The LLM can still invoke the `task` tool and spawn subagents

The workaround comment in execute_graphton.py (lines 1103-1108) describes this as a recursion_limit fix, but it does not actually prevent deepagents from creating the general-purpose subagent.

---

## Proposed Approach: Verify, Then Fix

Given these surprises, I propose a cautious, verification-first approach.

### Phase 1: Verify Current State

Before writing any production code, we need to answer three questions:

1. **Can agents be created?** Write a minimal integration test that calls `graphton.create_deep_agent()` with the same parameters as execute_graphton.py. If it raises TypeError on `backend`, we know the agent creation is currently broken.
2. **Is the recursion_limit bug still present?** If agent creation works, inspect the compiled graph and subagent graphs to verify their recursion_limit values.
3. **Does config propagate to subagents?** Verify whether the parent's runtime config is inherited by subagraphs during tool execution.

### Phase 2: Fix Based on Findings

**If `backend` TypeError is confirmed (most likely):**

- Remove `backend` parameter from the `deepagents_create_deep_agent()` call
- deepagents 0.4.0 uses `FilesystemMiddleware` (with `memory_backend`) instead of `backend` for sandbox tools
- When `approval_checker` is provided, graphton already creates platform tool wrappers and passes them via `tools` list (lines 500-504), so deepagents doesn't need the backend
- When no approval_checker, need to determine how sandbox tools should be provided (possibly via `memory_backend` parameter)

**For recursion limit:**

- Add `recursion_limit` to the invoke-time config in execute_graphton.py as defense-in-depth:

```python
config = {
    "configurable": {
        "thread_id": thread_id,
        "org": execution.metadata.org,
    },
    "recursion_limit": 1000,
}
```

- Update graphton's config validator: The warn-at-500 threshold is too low given that the platform uses 1000 and langchain defaults to 10,000. Raise to warn at 2000 or remove the warning entirely.
- Clean up the `general_purpose_agent=False` workaround: Since it doesn't actually prevent deepagents from creating the general-purpose subagent, either (a) remove the parameter and the misleading comment, or (b) pass custom `CompiledSubAgent` objects with explicit recursion_limit instead.

### Phase 3: Tests and Documentation

- Add a test that verifies the recursion_limit of both the top-level graph and subagent graphs
- Add a test that creates the agent with the exact same parameters as production
- Update comments in execute_graphton.py to reflect the current library behavior
- Remove stale bug workaround comments or update them to reflect reality

---

## Key Files

- [agent.py](backend/libs/python/graphton/src/graphton/core/agent.py) - graphton agent factory (main changes)
- [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) - production invocation (invoke-time config, comments)
- [config.py](backend/libs/python/graphton/src/graphton/core/config.py) - validator threshold fix
- deepagents (installed, read-only): `graph.py`, `middleware/subagents.py`

## Decision Points Requiring Collaboration

1. **How should sandbox tools work without `backend`?** deepagents 0.4.0 replaced `backend` with `memory_backend` (a `MemoryBackend` protocol). Graphton currently creates sandbox tools via `create_sandbox_backend()` + either approval-aware wrappers or passes `backend` to deepagents. We need to decide: should graphton ALWAYS create its own platform tool wrappers (like it does in the approval flow), or should it adapt to use `memory_backend`?
2. **Should the general-purpose subagent be disabled?** deepagents always creates it. The only way to suppress it is to NOT use deepagents' `SubAgentMiddleware` and create our own task tool. Is that desirable, or should we let deepagents manage subagents and just ensure proper recursion limits?
3. **What recursion_limit should subagents have?** langchain gives them 10,000. graphton's top-level graph uses 1,000. Should subagents have the same limit as the parent, or is 10,000 acceptable as "let subagents run freely within the parent's limit"?

