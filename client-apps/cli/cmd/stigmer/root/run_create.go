package root

import (
	"context"
	"fmt"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"google.golang.org/grpc"
)

// createAgentExecution creates a new agent execution
func createAgentExecution(agentID string, orgID string, message string, runtimeEnv envfile.EnvMap, attachments []*agentexecutionv1.Attachment, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
	if message == "" {
		message = "execute"
	}

	executionName := fmt.Sprintf("execution-%d", time.Now().UnixMicro())

	spec := &agentexecutionv1.AgentExecutionSpec{
		AgentId:     agentID,
		Message:     message,
		RuntimeEnv:  runtimeEnv,
		Attachments: attachments,
	}

	execution := &agentexecutionv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: executionName,
			Org:  orgID,
		},
		Spec: spec,
	}

	client := agentexecutionv1.NewAgentExecutionCommandControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := client.Create(ctx, execution)
	if err != nil {
		return nil, fmt.Errorf("failed to create execution: %w", err)
	}

	return result, nil
}

// createWorkflowExecution creates a new workflow execution
func createWorkflowExecution(workflowID string, orgID string, message string, runtimeEnv envfile.EnvMap, conn *grpc.ClientConn) (*workflowexecutionv1.WorkflowExecution, error) {
	if message == "" {
		message = "execute"
	}

	executionName := fmt.Sprintf("execution-%d", time.Now().UnixMicro())

	spec := &workflowexecutionv1.WorkflowExecutionSpec{
		WorkflowId:     workflowID,
		TriggerMessage: message,
		RuntimeEnv:     runtimeEnv,
	}

	execution := &workflowexecutionv1.WorkflowExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: executionName,
			Org:  orgID,
		},
		Spec: spec,
	}

	client := workflowexecutionv1.NewWorkflowExecutionCommandControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := client.Create(ctx, execution)
	if err != nil {
		return nil, fmt.Errorf("failed to create execution: %w", err)
	}

	return result, nil
}
