# SubAgent Execution Support - Agent Delegation Framework

**Date**: January 31, 2026

## Summary

Implemented comprehensive subagent execution support in the agent-runner service, enabling agents to delegate specialized tasks to sub-agents with restricted MCP access and independent skill sets. This foundational capability transforms Stigmer agents from single-purpose executors into sophisticated coordinators that can break down complex tasks across specialized sub-agents, each operating within defined permission boundaries.

The implementation wires proto SubAgent definitions from AgentSpec to graphton's `create_deep_agent()` function, completing the orchestration layer that connects the fully-designed proto API with the existing graphton library support and StatusBuilder tracking infrastructure.

## Problem Statement

Agents previously operated as monolithic executors - a single agent with one set of tools handling all aspects of a task. For complex workflows requiring different expertise areas (code review, research, deployment), this led to:

### Pain Points

- **No task specialization**: Agents couldn't delegate domain-specific work to specialized sub-agents
- **Permission model limitations**: All tools were accessible to the entire agent, no fine-grained MCP access control
- **Skill organization challenges**: No way to assign different skill sets to different aspects of a task
- **Context isolation gaps**: Complex tasks mixed different concerns (review vs. implementation vs. deployment) in a single agent context
- **Missing orchestration layer**: Proto API and graphton library supported subagents, but the transformation layer didn't exist

The proto `SubAgent` message existed in `agent/v1/spec.proto`, graphton's `create_deep_agent()` accepted a `subagents` parameter, and StatusBuilder already tracked `SubAgentExecution` events - but no code connected these pieces. The `subagents` parameter was hardcoded to `None` in `execute_graphton.py`.

## Solution

Built a complete subagent transformation pipeline that converts proto SubAgent definitions into graphton's expected format while enforcing strict permission boundaries and skill resolution.

**Architecture**:
```
Proto SubAgent (agent/v1/spec.proto)
    ↓
SubAgentTransformer (new module)
    ├─ MCP Access Filtering (permission enforcement)
    ├─ Skill Resolution (batch fetch + injection)
    └─ Tool Wrapper Creation (per-subagent MCP sessions)
    ↓
Graphton subagent dict format
    ↓
create_deep_agent(subagents=[...])
```

**Key Design Decisions**:

1. **Separate McpToolsLoader per subagent**: Each subagent gets its own filtered MCP configuration and isolated tool wrappers, preventing access to parent's full tool set

2. **Permission intersection model**: `subagent_tools = parent_tools ∩ subagent_request`
   - SubAgent can only access MCP servers explicitly listed in `mcp_access`
   - SubAgent tools must be subset of parent's enabled tools
   - Empty `enabled_tools` in McpAccess = inherit all parent tools for that server

3. **Batch skill resolution**: All unique skills across all subagents are fetched in a single gRPC call, then distributed to respective subagents

4. **Graceful degradation**: Invalid MCP access references are logged and skipped; skill fetch failures don't block transformation; the system continues with whatever components succeed

## Implementation Details

### New Module: `subagent_transformer.py`

Created `backend/services/agent-runner/worker/activities/graphton/subagent_transformer.py` (554 lines) with:

**Core Functions**:

- `transform_sub_agents()` - Main entry point that orchestrates the full transformation pipeline
- `_filter_mcp_for_subagent()` - Implements permission model by filtering parent's MCP servers based on McpAccess grants
- `_collect_all_skill_refs()` - Deduplicates skill references across all subagents for batch fetching
- `_fetch_skills_batch()` - Fetches skills via gRPC, downloads artifacts, writes to sandbox
- `_create_subagent_mcp_tools()` - Creates McpToolsLoader instance and tool wrappers for filtered MCP config

**Transformation Flow**:

1. Build slug → usage mapping for validation
2. Collect all unique skill refs across subagents (deduplication)
3. Batch fetch all skills and write to sandbox
4. For each SubAgent:
   - Filter parent MCP servers based on McpAccess grants
   - Intersect tools: only include tools in both parent and subagent lists
   - Resolve skills by matching slugs from batch fetch
   - Generate skill prompt section with LOCATION headers
   - Create MCP tool wrappers using graphton utilities
   - Build subagent dict: `{name, description, system_prompt, tools}`
5. Return list of subagent dicts or None if all failed

### Integration: `execute_graphton.py`

Added Step 5.9 (lines 695-751) in the execution pipeline:

**Changes**:
- Moved `skill_client` creation outside conditional block for reuse
- Added SubAgent transformation step before `create_deep_agent()` call
- Built skill writer kwargs based on mode (local vs cloud)
- Called `transform_sub_agents()` with parent MCP config and skill client
- Updated `create_deep_agent()` to pass `transformed_subagents` instead of `None`

**Error Handling**:
```python
try:
    transformed_subagents = await transform_sub_agents(...)
    if transformed_subagents:
        logger.info(f"Successfully transformed {len(transformed_subagents)} sub-agent(s)")
    else:
        logger.warning("No valid sub-agents after transformation")
except Exception as e:
    logger.error(f"Failed to transform sub-agents: {e}")
    transformed_subagents = None  # Continue without subagents
```

### Permission Model Implementation

**MCP Access Restriction**:
```python
def _filter_mcp_for_subagent(
    mcp_access_list: list[McpAccess],
    parent_mcp_servers: dict[str, dict[str, Any]],
    parent_mcp_tools: dict[str, list[str]],
    usage_by_slug: dict[str, McpServerUsage],
    log: logging.Logger,
) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]]]:
```

**Validation Steps**:
1. Check slug exists in parent's `mcp_server_usages`
2. Check server exists in transformed parent configs
3. Copy server config (subagent uses same connection)
4. Intersect tools:
   - If `enabled_tools` specified: include only those in parent's list
   - If `enabled_tools` empty: inherit all parent tools
5. Remove server if no valid tools after filtering

**Example**:
- Parent has github with: `[search_code, get_file, create_pr, list_repos]`
- SubAgent requests: `[search_code, get_file, delete_repo]`
- Result: `[search_code, get_file]` (intersection, `delete_repo` not in parent)

### Skill Resolution

**Batch Fetch Strategy**:
```python
# Collect all unique skill refs
all_skill_refs = _collect_all_skill_refs(sub_agents)

# Single batch fetch
skills_by_id, skill_paths = await _fetch_skills_batch(
    skill_refs=all_skill_refs,
    skill_client=skill_client,
    skill_writer_class=skill_writer_class,
    ...
)

# Distribute to subagents
for sub_agent in sub_agents:
    for ref in sub_agent.skill_refs:
        # Find skill by slug matching
        for skill_id, skill in skills_by_id.items():
            if skill.metadata.slug == ref.slug:
                subagent_skills.append(skill)
```

**Prompt Enhancement**:
- Skills are written to sandbox at `/bin/skills/{version_hash}/`
- `SkillWriter.generate_prompt_section()` creates markdown with LOCATION headers
- Skill content appended to subagent's `instructions` to form `system_prompt`

### Testing

**Unit Tests** (`test_subagent_transformer.py` - 783 lines):

Test coverage for helper functions:
- `_build_usage_slug_map()` - 3 tests
- `_collect_all_skill_refs()` - 4 tests  
- `_filter_mcp_for_subagent()` - 7 tests

Test coverage for main transformation:
- Empty/single/multiple subagents
- MCP access with valid/invalid slugs
- Tool intersection logic
- Skill resolution and prompt injection
- Graceful error handling (MCP failures, skill failures)
- Edge cases (empty descriptions, invalid configs)

**Integration Tests** (`test_integration_subagent_pipeline.py` - 622 lines):

Full pipeline tests:
- Single subagent with MCP + skills (end-to-end)
- Multiple subagents with different configs
- MCP restriction enforcement verification
- Tool expansion prevention (subagent cannot get tools parent doesn't have)
- Skill injection into system prompt
- Error recovery (continues when MCP fails, continues when skills fail)
- Graphton compatibility (output format validation)

**Mock Strategy**:
- Used real `SkillWriter` for integration tests
- Mocked `McpToolsLoader` to avoid actual MCP connections
- Mocked tool wrappers but verified correct filtered configs passed
- Used temporary directories for sandbox operations

### Module Exports

Updated `worker/activities/graphton/__init__.py` to export new utilities:
```python
from worker.activities.graphton.subagent_transformer import transform_sub_agents

__all__ = [
    "ApprovalConfig",
    "build_approval_config",
    "create_approval_checker",
    "SkillWriter",
    "StatusBuilder",
    "transform_sub_agents",  # New
]
```

### Test Fixtures

Added to `tests/conftest.py`:
- `mock_sub_agent()` - Basic SubAgent proto
- `mock_mcp_access()` - McpAccess proto
- `mock_mcp_server_usage()` - McpServerUsage proto for testing

## Benefits

### For Agents

- **Task specialization**: Agents can delegate to domain experts (code review, research, deployment)
- **Context isolation**: Each subagent operates in its own context with focused instructions
- **Parallel execution**: Multiple subagents can work concurrently (graphton's built-in capability)
- **Reduced complexity**: Parent agent coordinates rather than executing all tasks directly

### For Platform

- **Permission boundaries**: Strict MCP access control prevents privilege escalation
- **Skill organization**: Skills can be scoped to specific subagent types
- **Execution tracking**: StatusBuilder already tracks SubAgentExecution events (Phase 2.3)
- **Graceful degradation**: Invalid configs don't crash the system, just log warnings

### For Development

- **Clean architecture**: Transformation logic isolated in dedicated module
- **Comprehensive tests**: 40+ tests covering edge cases and error scenarios
- **Following patterns**: Mirrors existing `config_transformer.py` and `skill_writer.py` patterns
- **No library changes**: Used existing graphton utilities, no changes to graphton library needed

### Performance

- **Batch skill fetching**: Single gRPC call for all unique skills (vs. N calls)
- **Shared parent resources**: Subagents reuse parent's sandbox, MCP connections
- **Lazy loading**: MCP tools loaded only when needed per subagent

## Impact

### Components Modified

**Core Service** (`backend/services/agent-runner`):
- `worker/activities/execute_graphton.py` (73 lines added)
- `worker/activities/graphton/__init__.py` (27 lines, exports)
- `tests/conftest.py` (36 lines, fixtures)

**New Components** (`backend/services/agent-runner`):
- `worker/activities/graphton/subagent_transformer.py` (554 lines)
- `tests/test_subagent_transformer.py` (783 lines)
- `tests/test_integration_subagent_pipeline.py` (622 lines)

**Total**: ~2,095 lines of production code and tests

### Proto API Utilization

Now fully utilizing:
- `SubAgent` message from `agent/v1/spec.proto`
- `McpAccess` message for permission model
- `SubAgentExecution` tracking in StatusBuilder (existing)

### Affected Workflows

**Agent Execution Flow**:
```
Before: AgentSpec → create_deep_agent(subagents=None) → monolithic execution

After:  AgentSpec → transform_sub_agents() → create_deep_agent(subagents=[...]) 
        → parent coordinates, subagents execute specialized tasks
```

**Permission Enforcement**:
```
Before: No per-tool restrictions within an agent

After:  SubAgent.mcp_access defines allowed servers and tools
        → McpToolsLoader filters config per subagent
        → Tool wrappers only access filtered tools
```

### Backward Compatibility

- **100% backward compatible**: Agents without `sub_agents` work exactly as before
- Empty `sub_agents` list → `transformed_subagents = None` → graphton uses default behavior
- Existing tests unaffected (no changes to core agent execution logic)

## Related Work

### Dependencies

This work completes the subagent support chain:
- **Proto API** (Phase 1): SubAgent, McpAccess messages defined - ✅ Already existed
- **Graphton library** (Phase 2): Subagent parameter support in `create_deep_agent()` - ✅ Already existed  
- **StatusBuilder** (Phase 2.3): SubAgentExecution tracking - ✅ Already existed
- **Orchestration layer** (Phase 3): Transform proto → graphton format - ✅ **This work**

### Enables Future Work

**Agent Templates**:
- Create reusable agent templates with pre-configured subagents
- Example: "Code Review Agent" with subagents for security, style, tests

**Dynamic Subagent Composition**:
- Agents that add/remove subagents based on task analysis
- Context-aware delegation (choose subagent based on file type, task complexity)

**Hierarchical Delegation**:
- Subagents can have their own subagents (if proto supports recursive definition)
- Multi-level task decomposition

**Observability**:
- Track which subagents are most effective
- Analyze delegation patterns for optimization
- Monitor permission violations or access attempts

### Design Patterns Used

**Transformation Pattern** (following `config_transformer.py`):
```
Proto objects → Validate → Transform → LangGraph/Graphton format
```

**Graceful Degradation** (following `execute_graphton.py`):
```
try:
    component = transform_component(...)
except Exception as e:
    logger.error(f"Component failed: {e}")
    component = None  # Continue without component
```

**Batch Processing** (optimizing gRPC calls):
```
refs = collect_all_refs(items)  # Deduplicate
resources = await client.fetch_batch(refs)  # Single call
distribute_to_items(items, resources)  # Map back
```

## Testing Evidence

### Unit Test Results

**Helper Functions**:
- ✅ `_build_usage_slug_map`: 3/3 tests passing
- ✅ `_collect_all_skill_refs`: 4/4 tests passing  
- ✅ `_filter_mcp_for_subagent`: 7/7 tests passing

**Main Transformation**:
- ✅ Empty subagents → None
- ✅ Single subagent transformation
- ✅ Multiple subagents transformation
- ✅ Subagent with MCP gets tool wrappers
- ✅ Subagent with skills gets enhanced prompt
- ✅ MCP errors handled gracefully
- ✅ Skill errors handled gracefully

**Edge Cases**:
- ✅ Empty description → fallback to "Sub-agent: {name}"
- ✅ Empty MCP slug → skipped with warning
- ✅ Invalid server reference → skipped with warning
- ✅ Tool not in parent → filtered out

### Integration Test Coverage

**Full Pipeline**:
- ✅ Single subagent with MCP + skills (end-to-end verification)
- ✅ Multiple subagents with different configs
- ✅ Code reviewer subagent (realistic scenario)
- ✅ Research subagent without MCP

**Permission Model**:
- ✅ MCP restriction enforcement (only allowed servers)
- ✅ Tool intersection (cannot expand beyond parent)
- ✅ Empty enabled_tools inherits all parent tools

**Error Recovery**:
- ✅ Continues when MCP fails (subagent created without tools)
- ✅ Continues when skill fetch fails (subagent created with base prompt)
- ✅ Returns valid subagents when some fail

**Graphton Compatibility**:
- ✅ Output format matches graphton expectations
- ✅ Required fields present: name, description, system_prompt
- ✅ Optional tools field is list when present

## Migration Path

**For Existing Agents**:
1. No changes required - backward compatible
2. To use subagents: Add `sub_agents` to AgentSpec proto
3. Define SubAgent with `name`, `description`, `instructions`
4. Optionally add `mcp_access` for MCP restrictions
5. Optionally add `skill_refs` for specialized skills

**Example AgentSpec YAML**:
```yaml
instructions: "You are a project coordinator."
mcp_server_usages:
  - mcp_server_ref:
      slug: github
    enabled_tools: [search_code, get_file, create_pr]
skill_refs:
  - scope: platform
    slug: project-management
sub_agents:
  - name: code-reviewer
    description: "Reviews code for quality and security"
    instructions: "You are a code review expert. Focus on security."
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, get_file]  # Subset of parent
    skill_refs:
      - scope: platform
        slug: security-review
```

**Deployment**:
- No database migrations needed
- No API changes (proto was already defined)
- No configuration changes required
- Agents without `sub_agents` continue working

## Code Quality

### Design Principles

- **Single Responsibility**: `subagent_transformer.py` does one thing - transform SubAgents
- **Separation of Concerns**: MCP filtering, skill resolution, tool creation separated into functions
- **Error Handling**: Every external call wrapped in try/except with logging
- **Type Safety**: Type hints throughout, validated by linter
- **Testability**: Pure functions for logic, mocks for I/O

### Code Review Checklist

- ✅ No linter errors
- ✅ Follows existing patterns (`config_transformer.py`, `skill_writer.py`)
- ✅ Comprehensive docstrings
- ✅ Error messages are actionable
- ✅ Logging at appropriate levels (debug/info/warning/error)
- ✅ No hardcoded values
- ✅ Graceful degradation on failures

### Documentation

- Module docstring explains purpose and design decisions
- Function docstrings include Args, Returns, Examples
- Complex logic commented inline
- Test docstrings describe what's being tested

## Lessons Learned

### What Went Well

1. **Clean integration**: Existing graphton API was perfect, no library changes needed
2. **Test-driven**: Tests written alongside implementation caught issues early
3. **Pattern reuse**: Following `config_transformer.py` made design obvious
4. **Graceful failures**: Error handling prevented cascading failures

### Challenges Overcome

1. **Scope management**: `skill_client` initially created in conditional block, needed refactoring for reuse
2. **Tool wrapper creation**: Needed to understand graphton's `McpToolsLoader` and `create_tool_wrapper` utilities
3. **Permission model clarity**: Tool intersection logic required careful validation logic

### Future Improvements

**Potential Optimizations**:
- Cache transformed subagents if AgentSpec hasn't changed
- Parallel MCP tool loading for multiple subagents
- Skill artifact caching across subagent executions

**Monitoring Additions**:
- Metrics: subagent usage frequency, delegation patterns
- Alerts: excessive MCP permission denials, subagent failures
- Tracing: parent-to-subagent delegation flow

**User Experience**:
- Better error messages when MCP access invalid
- Suggestions when subagent requests unavailable tools
- Documentation with example subagent configs

---

**Status**: ✅ Production Ready

**Implementation Timeline**: 
- Investigation: 30 minutes (graphton internals, proto structure)
- Core implementation: 2.5 hours (transformer module, integration)
- Testing: 1.5 hours (unit tests, integration tests)
- Documentation: 30 minutes (docstrings, inline comments)

**Files Changed**: 7 total (3 modified, 4 created)
**Lines Added**: ~2,095 (554 production + 1,405 tests + 136 integration)

**Next Steps**:
- Create example AgentSpec with subagents for testing
- Document subagent best practices for users
- Monitor production usage for optimization opportunities
