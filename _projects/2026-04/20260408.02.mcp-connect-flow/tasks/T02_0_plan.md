# Task T02: Python Classifier + Connect Workflow + Graphton Backfill

**Created**: 2026-04-08
**Status**: PENDING (blocked on T01)
**Scope**: stigmer OSS — `backend/services/agent-runner/`
**Estimated effort**: Substantial — new structured-output pattern, new Temporal workflow, approval policy chain rewrite, Graphton setup modification

## Objective

Implement the structured-output tool approval classifier, the `stigmer/mcp-server/connect` Temporal workflow, update the approval policy resolution chain, and add first-time-use backfill to the Graphton setup pipeline. All Python, all in agent-runner.

## Detailed Changes

### 1. New: classify_tool_approvals.py

**File**: `backend/services/agent-runner/worker/activities/classify_tool_approvals.py`

This introduces the first `with_structured_output` usage in the codebase.

**Core function** (standalone, no Temporal coupling):
```python
async def classify_tools(
    tools: list[ToolInfo],
    server_name: str,
    server_description: str,
) -> ClassifyToolApprovalsOutput:
```

**Pydantic models**:
```python
class ToolInfo(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any] | None = None

class ToolApprovalClassification(BaseModel):
    tool_name: str
    requires_approval: bool
    message: str  # with {{args.field}} placeholders for HITL display

class ClassifyToolApprovalsOutput(BaseModel):
    approvals: list[ToolApprovalClassification]
```

**Implementation pattern**:
- Use `ModelRegistry.get_summarization_model()` for economy-tier model
- `model.with_structured_output(ClassifyToolApprovalsOutput).ainvoke([SystemMessage, HumanMessage])`
- System prompt: classification rules:
  - Read-only operations (queries, searches, lists) → `requires_approval: false`
  - Creates/modifies resources → `requires_approval: true` with clear message
  - Deletes/destructive operations → `requires_approval: true` with detailed message including `{{args.field}}` placeholders
- Human message: JSON-formatted list of tools with name, description, input_schema

**Temporal activity wrapper**:
```python
@dataclass
class ClassifyToolApprovalsInput:
    tools: list[dict[str, Any]]
    server_name: str
    server_description: str

@activity.defn(name="ClassifyToolApprovals")
async def classify_tool_approvals_activity(input: ClassifyToolApprovalsInput) -> dict:
    # Calls classify_tools() core function
```

**Reference files**:
- `worker/activities/generate_session_subject.py` — economy-tier model pattern, `ModelRegistry` usage
- `worker/activities/discover_mcp_server.py` — activity/workflow registration pattern, dataclass I/O

### 2. New: Connect Workflow

**File**: New workflow in `classify_tool_approvals.py` (or separate file — decide during implementation)

```python
CONNECT_WORKFLOW_NAME = "stigmer/mcp-server/connect"

@dataclass
class ConnectMcpServerOutput:
    tools: list[DiscoveredToolResult]
    resource_templates: list[DiscoveredResourceTemplateResult]
    tool_approvals: list[dict[str, Any]]

@workflow.defn(name=CONNECT_WORKFLOW_NAME)
class ConnectMcpServerWorkflow:
    @workflow.run
    async def run(self, input: DiscoverMcpServerInput) -> ConnectMcpServerOutput:
        # Step 1: Discover (existing activity)
        discovery = await workflow.execute_activity(
            discover_mcp_server, input, start_to_close_timeout=timedelta(seconds=300))

        # Step 2: Classify (new activity)
        classify_input = ClassifyToolApprovalsInput(
            tools=[...from discovery...],
            server_name=...,
            server_description=...)
        classification = await workflow.execute_activity(
            classify_tool_approvals_activity, classify_input,
            start_to_close_timeout=timedelta(seconds=60))

        return ConnectMcpServerOutput(
            tools=discovery.tools,
            resource_templates=discovery.resource_templates,
            tool_approvals=classification)
```

### 3. Update: approval_policy.py

**File**: `backend/services/agent-runner/worker/activities/graphton/approval_policy.py`

Update the policy chain from:
```
auto_approve_all > tool_approval_overrides > default_tool_approvals > platform_defaults
```
To:
```
auto_approve_all > tool_approval_overrides > pinned_tool_approvals > tool_approvals (status) > platform_defaults
```

Changes to `build_approval_config`:
- Was reading `spec.default_tool_approvals` → now reads both `spec.pinned_tool_approvals` AND `status.tool_approvals`
- `ApprovalConfig` dataclass: add `pinned_tool_approvals` field alongside existing `default_tool_approvals` (rename to `status_tool_approvals`)

Changes to `resolve_tool_approval`:
- Add priority level 3: check `pinned_tool_approvals` (between agent overrides and MCP defaults)
- Rename priority level 4: `default_tool_approvals` → `status_tool_approvals`
- If a tool appears in both pinned and status, pinned wins

### 4. Update: worker.py

**File**: `backend/services/agent-runner/worker/worker.py`

Register the new workflow and activity:
- Add `ConnectMcpServerWorkflow` to workflows list
- Add `classify_tool_approvals_activity` to activities list

### 5. Update: Graphton First-Time-Use Backfill in setup.py

**File**: `backend/services/agent-runner/worker/activities/graphton/setup.py`

In `perform_setup`, after MCP tools are loaded by `McpToolsLoader` and before `build_approval_config`:

```python
# For each MCP server in the execution's usage list:
for server in mcp_servers:
    if (not server.status.discovered_capabilities.tools
            and not server.status.tool_approvals):
        # First-time use — classify and persist
        runtime_tools = mcp_tools_config.get(server.metadata.slug, [])
        if runtime_tools:
            classification = await classify_tools(
                tools=[...from runtime_tools...],
                server_name=server.metadata.name,
                server_description=server.spec.description)
            # Persist via observeMcpServerStatus RPC (service identity)
            await mcp_server_client.observe_mcp_server_status(
                mcp_server_id=server.metadata.id,
                discovered_capabilities=...,
                tool_approvals=classification.approvals)
            # Update in-memory server object for build_approval_config
            ...
```

The `classify_tools()` function is imported directly from `classify_tool_approvals.py` — called as a plain async function, not via Temporal.

The gRPC call uses the agent-runner's service identity (platform operator) which has `can_update_mcp_server_status`.

### 6. Update: gRPC client for observeMcpServerStatus

**File**: `backend/services/agent-runner/grpc_client/mcp_server_client.py` (or wherever the MCP server gRPC client lives)

Add method for the renamed RPC:
```python
async def observe_mcp_server_status(
    self, mcp_server_id: str,
    discovered_capabilities: ...,
    tool_approvals: list[...]) -> McpServer:
```

## Key References

| File | Role |
|------|------|
| `worker/activities/generate_session_subject.py` | Economy-tier model pattern |
| `worker/activities/discover_mcp_server.py` | Temporal activity/workflow pattern, DiscoverMcpServerInput |
| `worker/activities/graphton/approval_policy.py` | Current approval chain (rewrite target) |
| `worker/activities/graphton/setup.py` | Graphton setup pipeline (backfill insertion point) |
| `worker/worker.py` | Activity/workflow registration |
| `grpc_client/mcp_server_client.py` | gRPC client for MCP server RPCs |

## Success Criteria

- [ ] `classify_tools()` core function works with `with_structured_output`
- [ ] `ClassifyToolApprovals` Temporal activity registered and functional
- [ ] `stigmer/mcp-server/connect` workflow chains discover → classify
- [ ] `approval_policy.py` implements new 5-level policy chain
- [ ] `build_approval_config` reads from both `pinned_tool_approvals` and `status.tool_approvals`
- [ ] First-time-use backfill in `setup.py` detects empty status and runs classifier
- [ ] Backfill persists via `observeMcpServerStatus` RPC
- [ ] `worker.py` registers all new workflows/activities
- [ ] All existing approval policy tests updated and passing
- [ ] New tests for classifier and updated policy chain

## Next Task

**T03**: Java Handlers + Auth Wiring (stigmer-cloud)
