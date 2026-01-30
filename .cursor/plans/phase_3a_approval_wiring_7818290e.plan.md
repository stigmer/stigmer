---
name: Phase 3A Approval Wiring
overview: Wire ApprovalConfig construction and pass it to StatusBuilder, enabling approval requirement detection for tools. This is the foundation that Phase 3B (interrupt mechanism) will build upon.
todos:
  - id: build-approval-config
    content: Create build_approval_config() function in execute_graphton.py - assembles ApprovalConfig from execution/agent/MCP data
    status: completed
  - id: wire-status-builder
    content: Move StatusBuilder init after MCP fetch, pass ApprovalConfig to constructor
    status: completed
  - id: unit-tests
    content: Add TestBuildApprovalConfig test class with coverage for all input scenarios
    status: completed
isProject: false
---

# Phase 3A: ApprovalConfig Wiring

## Objective

Complete the wiring so that `StatusBuilder` receives `ApprovalConfig` during execution. This enables approval requirement detection - tools that match approval policies will be marked `WAITING_APPROVAL` instead of `RUNNING`.

**Important Scope Limitation**: This phase does NOT implement the actual LangGraph interrupt mechanism. Tools will still execute, but their status will correctly reflect approval requirements. The interrupt mechanism is Phase 3B.

---

## Why Split Phase 3?

The original Phase 3 scope includes both wiring AND interrupt mechanism. These are distinct concerns:

- **Wiring (3A)**: Data assembly and plumbing - straightforward, testable
- **Interrupt (3B)**: LangGraph flow control - requires deeper `graphton` library research, possible upstream changes

Splitting ensures:

1. Clean, focused implementation
2. Testable milestones
3. Manageable context size
4. Foundation in place before tackling the harder problem

---

## Implementation

### 1. Create `build_approval_config()` Function

**Location**: [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) (new function, ~60-80 lines)

**Purpose**: Assemble `ApprovalConfig` from execution, agent, and MCP server data.

**Input Sources** (all available after line 468):

- `execution.spec.auto_approve_all` - runtime bypass flag
- `mcp_server_usages` - contains `tool_approval_overrides` per usage
- `mcp_servers` - contains `spec.default_tool_approvals` per server
- `mcp_tools_config` - mapping of server slug to tool names

**Logic**:

```python
def build_approval_config(
    execution: AgentExecution,
    mcp_server_usages: List[McpServerUsage],
    mcp_servers: List[McpServer],
    mcp_tools_config: Dict[str, List[str]],
) -> ApprovalConfig:
    """
    Build ApprovalConfig from execution context.
    
    Assembles the policy chain configuration:
    1. auto_approve_all from execution spec
    2. tool_approval_overrides from agent's MCP server usages
    3. default_tool_approvals from MCP server specs
    4. tool_to_mcp_server mapping from resolved tools
    """
```

**Key Implementation Details**:

- Collect all `tool_approval_overrides` across usages into flat list
- Build `default_tool_approvals` dict keyed by server slug
- Build `tool_to_mcp_server` mapping by inverting `mcp_tools_config`
- Handle missing/empty fields gracefully (safe defaults)

---

### 2. Pass ApprovalConfig to StatusBuilder

**Location**: [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py), line 141

**Current** (no approval config):

```python
status_builder = StatusBuilder(execution_id, execution.status)
```

**After** (with approval config):

```python
# Build approval config (after MCP servers fetched, around line 470)
approval_config = build_approval_config(
    execution=execution,
    mcp_server_usages=list(mcp_server_usages) if mcp_server_usages else [],
    mcp_servers=mcp_servers if 'mcp_servers' in locals() else [],
    mcp_tools_config=mcp_tools_config,
)

# Initialize status builder with approval config
status_builder = StatusBuilder(execution_id, execution.status, approval_config)
```

**Note**: StatusBuilder instantiation must move after MCP server fetch (currently at line 141, must move after line 468).

---

### 3. Unit Tests

**Location**: [test_status_builder.py](backend/services/agent-runner/tests/test_status_builder.py) (new test class, ~150-200 lines)

**New Test Class**: `TestBuildApprovalConfig`

Test cases:

- Empty inputs return config with safe defaults
- `auto_approve_all` correctly extracted from execution spec
- `tool_approval_overrides` collected from all usages
- `default_tool_approvals` keyed by server slug
- `tool_to_mcp_server` mapping correctly inverted
- Missing MCP servers handled gracefully

**Integration test**: Verify end-to-end that a tool with approval policy gets `WAITING_APPROVAL` status when processed through `StatusBuilder` with properly constructed `ApprovalConfig`.

---

## Files Changed


| File                     | Change                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `execute_graphton.py`    | Add `build_approval_config()` function (~80 lines), move StatusBuilder init, pass config |
| `test_status_builder.py` | Add `TestBuildApprovalConfig` class (~150 lines)                                         |


**Estimated Total**: ~230 lines added

---

## Verification

After implementation:

1. Run existing unit tests (ensure no regressions)
2. Run new `TestBuildApprovalConfig` tests
3. Manually verify with debug logging that `ApprovalConfig` is constructed correctly
4. Observe tool status in execution - tools matching policies should show `WAITING_APPROVAL`

---

## What This Does NOT Include (Phase 3B)

- LangGraph interrupt mechanism (`interrupt_before`, custom tool wrappers)
- Actual pause of tool execution
- Resume flow from interrupted state
- Signal handling from Temporal workflow

These require deeper research into `graphton` library and will be addressed in Phase 3B.

---

## Architecture Context

```
┌─────────────────────────────────────────────────────────────────┐
│                     execute_graphton.py                          │
├─────────────────────────────────────────────────────────────────┤
│ 1. Fetch execution, agent                                        │
│ 2. Fetch MCP servers via gRPC                                   │
│ 3. Transform MCP configs (mcp_servers_config, mcp_tools_config) │
│ 4. BUILD ApprovalConfig  ← NEW (Phase 3A)                       │
│ 5. Create StatusBuilder with ApprovalConfig                     │
│ 6. Create Graphton agent                                        │
│ 7. Stream events → StatusBuilder.process_event()                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      StatusBuilder                               │
├─────────────────────────────────────────────────────────────────┤
│ _handle_tool_start_event()                                       │
│   └─> _check_tool_approval_requirement(tool_name, tool_args)    │
│         └─> Uses ApprovalConfig to resolve policy               │
│         └─> Returns ApprovalRequirement                         │
│   └─> If requires_approval: status = WAITING_APPROVAL           │
│   └─> Else: status = RUNNING                                    │
│                                                                  │
│ (Phase 3B will add interrupt here to pause execution)           │
└─────────────────────────────────────────────────────────────────┘
```

