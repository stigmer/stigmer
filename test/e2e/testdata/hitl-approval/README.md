# HITL Approval Flow Test Fixtures

This directory contains test fixtures for validating the Human-in-the-Loop (HITL) approval flow.

## Overview

The HITL approval flow allows users to approve, skip, or reject tool executions before they happen.
This is critical for dangerous operations like file deletion, code deployment, or data modification.

## Test Fixtures

### MCP Server: `hitl-test-mcp-server`
- Uses the filesystem MCP server
- Provides tools: read_file, write_file, list_directory, etc.
- Tool approval policies should be configured separately

### Agent: `hitl-approval-test-agent`
- Instructions guide it to use filesystem tools
- Designed to trigger approval when asked to perform "dangerous" operations

### Workflow: `hitl-approval-test-workflow`
- Single task that calls the approval test agent
- Message instructs the agent to create a test file

## Prerequisites

1. **Stigmer Server**: Running on port 7234
2. **Temporal**: Running on port 7233
3. **Ollama**: Running on port 11434 with `qwen2.5-coder:7b` model
4. **Tool Approval Configuration**: Configure the MCP server to require approval for `write_file`

## Configuring Tool Approval

After deploying the fixtures, configure approval requirements via the API:

```bash
# Update MCP server with default_tool_approvals
grpcurl -plaintext -d '{
  "id": "<mcp-server-id>",
  "spec": {
    "default_tool_approvals": [
      {
        "tool_name": "write_file",
        "message": "Write file: {{args.path}}"
      }
    ]
  }
}' localhost:8080 ai.stigmer.agentic.mcpserver.v1.McpServerCommandController/update
```

## Test Scenarios

### Scenario 1: Approve via Workflow API
1. Deploy fixtures: `stigmer apply --config test/e2e/testdata/hitl-approval`
2. Run workflow: `stigmer run hitl-approval-test-workflow`
3. Wait for `pending_approval` to be populated
4. Submit approval: `WorkflowExecution.submitApproval(APPROVE)`
5. Verify workflow completes successfully

### Scenario 2: Approve via Agent API
1. Same as above, but submit approval via `AgentExecution.submitApproval(APPROVE)`
2. Verify workflow detects completion and continues

### Scenario 3: Skip via Workflow API
1. Submit `SKIP` instead of `APPROVE`
2. Verify tool is marked as `TOOL_CALL_SKIPPED`
3. Verify workflow completes (not failed)

### Scenario 4: Reject via Workflow API
1. Submit `REJECT` instead of `APPROVE`
2. Verify tool is marked as `TOOL_CALL_FAILED`
3. Verify workflow fails with rejection error

## Running Tests

```bash
# Run all HITL approval tests
go test -tags=e2e -v -run "TestHitlApproval" ./test/e2e/...

# Run specific scenario
go test -tags=e2e -v -run "TestHitlApprovalWorkflowApprove" ./test/e2e/...
```

## Troubleshooting

### Approval not triggered
- Verify MCP server has `default_tool_approvals` configured
- Verify agent is using the correct MCP server
- Check agent-runner logs for approval policy evaluation

### Signal not propagating to workflow
- Verify `parent_workflow_id` is set on AgentExecution
- Check workflow-runner logs for signal reception
- Verify Temporal connectivity between services
