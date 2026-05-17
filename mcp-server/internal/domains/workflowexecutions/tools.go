// Package workflowexecutions provides MCP tools for querying workflow execution
// status and event logs, backed by the WorkflowExecutionQueryController RPCs.
package workflowexecutions

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
	wfxv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/workflowexecution/v1"
)

// --- get_workflow_execution ---

// GetWorkflowExecutionInput defines the parameters for the "get_workflow_execution" tool.
type GetWorkflowExecutionInput struct {
	ExecutionID string `json:"execution_id" jsonschema:"Workflow execution ID (wex_* format)."`
}

// GetWorkflowExecutionTool returns the MCP tool definition.
func GetWorkflowExecutionTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "get_workflow_execution",
		Description: "Get a workflow execution's full status including phase, tasks, errors, cost, and timing. Use for diagnosing failed or running executions.",
	}
}

// GetWorkflowExecutionHandler returns the typed tool handler.
func GetWorkflowExecutionHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetWorkflowExecutionInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetWorkflowExecutionInput) (*mcp.CallToolResult, any, error) {
		if input.ExecutionID == "" {
			return nil, nil, fmt.Errorf("execution_id is required")
		}

		conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
		if err != nil {
			return nil, nil, fmt.Errorf("get_workflow_execution: %w", err)
		}
		defer conn.Close()

		rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
		defer cancel()

		client := wfxv1.NewWorkflowExecutionQueryControllerClient(conn)
		execution, err := client.Get(rpcCtx, &wfxv1.WorkflowExecutionId{Value: input.ExecutionID})
		if err != nil {
			return nil, nil, domains.RPCError(err, fmt.Sprintf("workflow execution %q", input.ExecutionID))
		}

		text, err := domains.MarshalJSON(execution)
		if err != nil {
			return nil, nil, err
		}
		return domains.TextResult(text)
	}
}

// --- get_workflow_execution_events ---

// GetWorkflowExecutionEventsInput defines the parameters for the "get_workflow_execution_events" tool.
type GetWorkflowExecutionEventsInput struct {
	ExecutionID string `json:"execution_id" jsonschema:"Workflow execution ID (wex_* format)."`
	TaskName    string `json:"task_name,omitempty" jsonschema:"Filter events by task name."`
	PageSize    int32  `json:"page_size,omitempty" jsonschema:"Number of events per page (default 100, max 500)."`
}

// GetWorkflowExecutionEventsTool returns the MCP tool definition.
func GetWorkflowExecutionEventsTool() *mcp.Tool {
	return &mcp.Tool{
		Name: "get_workflow_execution_events",
		Description: "Get the event log for a workflow execution. " +
			"Returns task transitions, errors, cost checkpoints, and approval events. " +
			"Use for deep diagnosis of execution failures.",
	}
}

// GetWorkflowExecutionEventsHandler returns the typed tool handler.
func GetWorkflowExecutionEventsHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetWorkflowExecutionEventsInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetWorkflowExecutionEventsInput) (*mcp.CallToolResult, any, error) {
		if input.ExecutionID == "" {
			return nil, nil, fmt.Errorf("execution_id is required")
		}

		conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
		if err != nil {
			return nil, nil, fmt.Errorf("get_workflow_execution_events: %w", err)
		}
		defer conn.Close()

		rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
		defer cancel()

		req := &wfxv1.GetEventLogRequest{
			ExecutionId: input.ExecutionID,
			TaskName:    input.TaskName,
		}
		if input.PageSize > 0 {
			req.PageSize = input.PageSize
		}

		client := wfxv1.NewWorkflowExecutionQueryControllerClient(conn)
		resp, err := client.GetEventLog(rpcCtx, req)
		if err != nil {
			return nil, nil, domains.RPCError(err, fmt.Sprintf("event log for execution %q", input.ExecutionID))
		}

		text, err := domains.MarshalJSON(resp)
		if err != nil {
			return nil, nil, err
		}
		return domains.TextResult(text)
	}
}
