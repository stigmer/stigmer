# Fix deepagents 0.4.x Backend Parameter Incompatibility and Recursion Limit Propagation

**Date**: February 14, 2026

## Summary

Fixed critical TypeError preventing agent creation due to incompatible `backend` parameter being passed to deepagents 0.4.x `create_deep_agent()`. The deepagents library removed the `backend` parameter in v0.4.0, replacing it with `memory_backend` for the `FilesystemMiddleware`. Additionally, fixed recursion limit validator thresholds and added defense-in-depth recursion limit configuration at invoke-time. Simplified platform tool creation logic and cleaned up stale workaround code.

## Problem Statement

Agent creation was failing with a TypeError when graphton attempted to pass a `backend` parameter to `deepagents.create_deep_agent()`. The investigation revealed that deepagents 0.4.0 removed this parameter entirely (with no `**kwargs` fallback), causing immediate failures on every agent creation attempt with sandbox configuration.

### Pain Points

- **Critical blocker**: `TypeError: create_deep_agent() got an unexpected keyword argument 'backend'` on every agent creation attempt
- **Architecture mismatch**: Graphton's two-path sandbox logic (approval vs non-approval) was broken by API change
- **Config validator noise**: recursion_limit=1000 (platform standard) triggered warnings due to threshold=500
- **Stale workarounds**: `general_purpose_agent=False` parameter and comments referenced obsolete deepagents behavior
- **Missing defense-in-depth**: recursion_limit only set via `with_config()` at creation, not at invoke-time
- **Test gap**: No tests verifying deepagents 0.4.x compatibility or recursion_limit behavior

## Solution

Implemented a comprehensive fix addressing the deepagents 0.4.x API compatibility while improving recursion limit handling and test coverage:

1. **Removed invalid `backend` parameter** from deepagents call
2. **Unified sandbox tool creation** - always create platform tool wrappers when sandbox_config is provided (with or without approval_checker)
3. **Added invoke-time recursion_limit** as defense-in-depth
4. **Raised validator threshold** from 500 to 5000 (platform standard is 1000)
5. **Cleaned up stale workarounds** and misleading comments
6. **Added comprehensive tests** (17 new tests) for compatibility and behavior verification

## Implementation Details

### 1. graphton/core/agent.py - Removed Backend Parameter (Critical Fix)

**Problem**: Graphton passed `backend=backend_for_deepagents` to `deepagents_create_deep_agent()`, but deepagents 0.4.0 doesn't accept this parameter.

**Root cause**: deepagents 0.4.0 changed architecture:
- Removed `backend` parameter from `create_deep_agent()`
- Introduced `memory_backend` parameter for `FilesystemMiddleware`
- Always creates internal `FilesystemMiddleware` with `StateBackend` (in-memory storage)
- No `**kwargs` to capture unknown parameters → immediate TypeError

**Solution**: Simplified to single-path logic:

```python
# BEFORE: Two-path conditional (broken)
if sandbox_config:
    backend = create_sandbox_backend(sandbox_config)
    if approval_checker is not None:
        # Create wrappers, set backend_for_deepagents=None
        platform_tools = create_platform_tool_wrappers(backend, approval_checker)
        tools_list.extend(platform_tools)
        backend_for_deepagents = None
    else:
        # Let deepagents handle it
        backend_for_deepagents = backend

agent = deepagents_create_deep_agent(
    ...,
    backend=backend_for_deepagents,  # TypeError!
)

# AFTER: Single-path, always create wrappers (fixed)
if sandbox_config:
    sandbox_backend = create_sandbox_backend(sandbox_config)
    platform_tools = create_platform_tool_wrappers(
        backend=sandbox_backend,
        approval_checker=approval_checker,  # Can be None
    )
    tools_list.extend(platform_tools)

agent = deepagents_create_deep_agent(
    ...,
    # No backend parameter!
)
```

**Coexistence strategy**: Graphton's platform tools and deepagents' filesystem tools coexist:
- Graphton tools: `read`, `write`, `edit`, `execute`, `ls`, `glob`, `grep` (sandbox-backed)
- deepagents tools: `read_file`, `write_file`, `edit_file` (in-memory StateBackend), plus `ls`, `glob`, `grep`
- For name collisions (`ls`, `glob`, `grep`): explicit tools take precedence in langchain's ToolNode resolution
- No conflict: Different tools serve different purposes (persistent sandbox vs ephemeral scratchpad)

**Subagent handling**: Removed misleading `general_purpose_agent` gating:

```python
# BEFORE: Gated by general_purpose_agent flag
subagents=transformed_subagents if general_purpose_agent else []

# AFTER: Pass directly (deepagents ignores this parameter anyway)
subagents=transformed_subagents or []
```

**Why this works**: deepagents 0.4.0 hardcodes `general_purpose_agent=True` in its internal `SubAgentMiddleware` initialization, so graphton's parameter had no effect. Passing subagents directly is clearer.

### 2. execute_graphton.py - Added Invoke-Time Recursion Limit

**Defense-in-depth**: Set recursion_limit at invoke-time in addition to creation-time:

```python
config = {
    "recursion_limit": 1000,  # Defense-in-depth
    "configurable": {
        "thread_id": thread_id,
        "org": execution.metadata.org,
    },
}
```

**Why this matters**: LangGraph's `merge_configs` has special handling for `recursion_limit` - it strips values equal to `DEFAULT_RECURSION_LIMIT` (25 in langgraph 1.0.5, 10,000 in 1.0.8) to avoid storing redundant defaults. Our value of 1000 is preserved because `1000 != DEFAULT_RECURSION_LIMIT` in all versions. Setting at invoke-time ensures the limit is enforced even if the graph's default config is somehow lost during merging.

**Cleaned up comments**: Removed stale `general_purpose_agent=False` workaround and updated comments to reflect actual deepagents 0.4.x behavior:
- Documented that subagents get `DEFAULT_RECURSION_LIMIT` (generous limits)
- Noted that deepagents creates in-memory filesystem tools automatically
- Removed misleading bug references

### 3. graphton/core/config.py - Fixed Validator Threshold

**Problem**: Config validator warned at `recursion_limit > 500`, but platform standard is 1000.

**Fix**: Raised threshold to 5000:

```python
# BEFORE
if v > 500:
    warnings.warn("recursion_limit of {v} is very high...")

# AFTER
if v > 5000:
    warnings.warn(
        f"recursion_limit of {v} is very high. This may cause long "
        "execution times or mask infinite loops. Consider values "
        "between 50-2000 for most agents. The platform standard is 1000."
    )
```

**Rationale**:
- Platform standard: 1000 (top-level graph)
- langchain default: 10,000 (subagent graphs in v1.0.8+)
- Warn threshold: 5000 (catches extreme values while allowing 1000)
- Updated recommended range: 50-2000 (more realistic for production agents)

### 4. test_recursion_limit.py - Comprehensive Test Suite

Added 17 new tests across 4 test classes:

**TestRecursionLimitValidator** (7 tests):
- Boundary testing for validator thresholds (500, 1000, 5000, 5001, 6000)
- Zero and negative value rejection
- Warning verification for values > 5000

**TestAgentCreation** (4 tests):
- Verified `backend` parameter is NOT passed to deepagents
- Verified `recursion_limit` applied via `with_config()`
- Verified subagents passed directly without gating
- Verified `None` subagents converted to empty list

**TestSandboxToolCreation** (2 tests):
- Verified platform tools created WITH approval_checker
- Verified platform tools created WITHOUT approval_checker (new behavior)

**TestRecursionLimitMergeConfigs** (4 tests):
- Documented LangGraph `merge_configs` behavior
- Verified platform value (1000) is preserved
- Verified default value is stripped
- Version-resilient tests (work with langgraph 1.0.5 or 1.0.8+)

### Recursion Limit Behavior (Documented)

Through verification, confirmed the complete recursion limit behavior:

**Top-level graph**:
1. `langchain.agents.create_agent()` applies `recursion_limit=DEFAULT_RECURSION_LIMIT` via `with_config()`
2. `deepagents.create_deep_agent()` overrides with `recursion_limit=1000` via `with_config()`
3. `graphton.create_deep_agent()` overrides again with `recursion_limit=1000` via `with_config()`
4. Result: Top-level graph has `recursion_limit=1000`

**Subagent graphs** (created in `SubAgentMiddleware`):
1. `langchain.agents.create_agent()` applies `recursion_limit=DEFAULT_RECURSION_LIMIT`
2. No further overrides
3. Result: Subagents have `DEFAULT_RECURSION_LIMIT` (25 in v1.0.5, 10,000 in v1.0.8+)

**LangGraph merge_configs special handling**:
- Values equal to `DEFAULT_RECURSION_LIMIT` are stripped (treated as "no override")
- Values != `DEFAULT_RECURSION_LIMIT` are preserved
- Platform value of 1000 is always preserved (never equals default in any version)

**Original bug (recursion_limit=25)**: Was from an older langchain version where `create_agent()` used LangGraph's default of 25 without `with_config()`. Fixed in langchain 1.2.10+ which now applies `with_config({"recursion_limit": 10_000})`.

## Benefits

### Immediate Impact

- **Unblocked agent creation**: Removed TypeError, agents can be created again
- **Simplified codebase**: Single-path sandbox tool creation (removed conditional complexity)
- **Better defaults**: Config validator no longer warns on platform standard value
- **Improved reliability**: Invoke-time recursion_limit provides defense-in-depth
- **Test coverage**: 17 new tests verify compatibility and prevent regressions

### Developer Experience

- **Clear architecture**: Platform tools always created explicitly, no hidden logic
- **Accurate comments**: Removed stale workarounds and misleading bug references
- **Version compatibility**: Tests work across langgraph versions (1.0.5 - 1.0.8+)
- **Future-proof**: Tests document expected behavior and catch breaking changes

### Platform Quality

- **Consistent limits**: Top-level=1000, subagents=generous (10,000 in modern versions)
- **No warnings**: Platform standard value (1000) doesn't trigger false alarms
- **Coexistence model**: Sandbox tools and in-memory tools work together without conflicts
- **Test confidence**: Comprehensive coverage of critical agent creation path

## Impact

### Code Changes

**Modified files** (3):
- `backend/libs/python/graphton/src/graphton/core/agent.py` (89 lines changed)
- `backend/libs/python/graphton/src/graphton/core/config.py` (18 lines changed)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (51 lines changed)

**New test file** (1):
- `backend/libs/python/graphton/tests/core/test_recursion_limit.py` (17 tests, 412 lines)

**Total**: 158 production lines changed, 412 test lines added

### Services Affected

- **graphton library**: Core agent factory (all users)
- **agent-runner service**: Graphton agent execution flow
- **Any service using graphton**: Inherits fixed behavior

### Breaking Changes

None. This is a bug fix that restores intended behavior.

### Migration Path

No migration required. Existing code continues to work, but now without TypeError.

## Related Work

### Prior Investigation

- Initial recursion_limit=25 error logged in `_cursor/logs.md` (Dec 2024)
- Multiple attempts to fix via `general_purpose_agent=False` workaround (ineffective)
- Discovery that langchain 1.2.10+ changed default from 25 to 10,000

### Library Versions

- **deepagents**: 0.4.0 (removed `backend` parameter)
- **langgraph**: 1.0.5 (graphton env, DEFAULT=25) / 1.0.8 (agent-runner env, DEFAULT=10,000)
- **langchain**: 1.2.10+ (applies recursion_limit=10,000 via with_config)

### Architecture Decisions

1. **Always create platform tool wrappers** when sandbox_config is provided (regardless of approval_checker)
2. **Let deepagents' FilesystemMiddleware coexist** with graphton's sandbox tools (different purposes)
3. **Defense-in-depth recursion limits** at both creation-time and invoke-time
4. **Version-resilient tests** that work across langgraph 1.0.5-1.0.8+

## Testing

### Test Results

All new tests pass:
```
tests/core/test_recursion_limit.py: 17 passed
tests/core/test_config.py: 26 passed (existing, no regressions)
tests/core/test_checkpointer.py: 11 passed (existing, no regressions)
```

### Test Coverage

New tests cover:
- Config validator boundary conditions
- deepagents 0.4.x API compatibility
- Recursion limit propagation via with_config()
- Sandbox tool creation with/without approval
- LangGraph merge_configs behavior (documented)
- Version compatibility across langgraph 1.0.5-1.0.8+

### Manual Verification

Verified agent creation works with both:
- No sandbox: Agent created successfully
- Filesystem sandbox: Agent created with 12 tools (platform + deepagents)

## Next Steps

### Immediate

- [x] Fix TypeError blocker
- [x] Add tests for compatibility
- [x] Update config validator threshold
- [x] Clean up stale workarounds

### Future Considerations

1. **Monitor deepagents updates**: Watch for further API changes in v0.5.x
2. **Evaluate memory_backend usage**: Consider if graphton should use deepagents' memory_backend for persistent storage
3. **Subagent recursion limits**: Decide if subagents should inherit parent's limit or keep generous default
4. **Tool name collisions**: Consider renaming if collisions cause issues (currently no problems observed)

---

**Status**: ✅ Production Ready

**Contributors**: AI Agent (implementation), Suresh (verification and code review)

**Review Notes**: All changes are non-breaking fixes. Agent creation now works correctly with deepagents 0.4.x. Tests provide regression protection and document expected behavior across library versions.
