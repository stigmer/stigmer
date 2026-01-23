//go:build e2e
// +build e2e

package e2e

import (
	"context"
	"fmt"
	"net"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// GetFreePort finds an available port on localhost
func GetFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}

	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()

	return l.Addr().(*net.TCPAddr).Port, nil
}

// WaitForPort checks if a port is accepting connections within the timeout
func WaitForPort(port int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp",
			fmt.Sprintf("localhost:%d", port),
			100*time.Millisecond)
		if err == nil {
			conn.Close()
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}

// GetAgentViaAPI retrieves an agent by ID
func GetAgentViaAPI(serverPort int, agentID string) (*agentv1.Agent, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create agent query client
	client := agentv1.NewAgentQueryControllerClient(conn)

	// Query the agent
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	agent, err := client.Get(ctx, &agentv1.AgentId{Value: agentID})
	if err != nil {
		return nil, fmt.Errorf("failed to get agent: %w", err)
	}

	return agent, nil
}

// GetAgentBySlug queries an agent by slug and organization via gRPC API
// This is the proper way to verify agents by slug in tests
func GetAgentBySlug(serverPort int, slug string, org string) (*agentv1.Agent, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create agent query client
	client := agentv1.NewAgentQueryControllerClient(conn)

	// Query the agent by reference (slug + org)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	agent, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
		Scope: apiresource.ApiResourceOwnerScope_organization,
		Org:   org,
		Kind:  apiresourcekind.ApiResourceKind_agent,
		Slug:  slug,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get agent by slug: %w", err)
	}

	return agent, nil
}

// AgentExistsViaAPI checks if an agent exists by querying the gRPC API
// This is the proper way to verify agents in tests (not direct DB access)
func AgentExistsViaAPI(serverPort int, agentID string) (bool, error) {
	agent, err := GetAgentViaAPI(serverPort, agentID)
	if err != nil {
		return false, err
	}
	return agent != nil, nil
}

// AgentExecutionExistsViaAPI checks if an agent execution exists by querying the gRPC API
// This is the proper way to verify executions in tests (not direct DB access)
func AgentExecutionExistsViaAPI(serverPort int, executionID string) (bool, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return false, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create agent execution query client
	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)

	// Query the execution
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err = client.Get(ctx, &agentexecutionv1.AgentExecutionId{Value: executionID})
	if err != nil {
		// Check if it's a NotFound error (execution doesn't exist) or another error
		return false, fmt.Errorf("failed to get execution: %w", err)
	}

	return true, nil
}

// GetAgentExecutionViaAPI retrieves an agent execution by ID
func GetAgentExecutionViaAPI(serverPort int, executionID string) (*agentexecutionv1.AgentExecution, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create agent execution query client
	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)

	// Query the execution
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	execution, err := client.Get(ctx, &agentexecutionv1.AgentExecutionId{Value: executionID})
	if err != nil {
		return nil, fmt.Errorf("failed to get execution: %w", err)
	}

	return execution, nil
}

// WaitForExecutionPhase polls the execution until it reaches the target phase or times out
// Returns the execution object when target phase is reached, or error on timeout
func WaitForExecutionPhase(serverPort int, executionID string, targetPhase agentexecutionv1.ExecutionPhase, timeout time.Duration) (*agentexecutionv1.AgentExecution, error) {
	deadline := time.Now().Add(timeout)
	var lastExecution *agentexecutionv1.AgentExecution
	
	for time.Now().Before(deadline) {
		execution, err := GetAgentExecutionViaAPI(serverPort, executionID)
		if err != nil {
			// Execution might not exist yet, keep waiting
			time.Sleep(500 * time.Millisecond)
			continue
		}

		lastExecution = execution

		// Check if we've reached the target phase
		if execution.Status != nil && execution.Status.Phase == targetPhase {
			return execution, nil
		}

		// Check if execution is in a terminal failed state
		if execution.Status != nil && execution.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
			return execution, fmt.Errorf("execution failed (target phase was %s)", targetPhase.String())
		}

		// Not there yet, wait and retry
		time.Sleep(500 * time.Millisecond)
	}

	// Timeout reached - include current phase for debugging
	currentPhase := "UNKNOWN"
	if lastExecution != nil && lastExecution.Status != nil {
		currentPhase = lastExecution.Status.Phase.String()
	}
	return nil, fmt.Errorf("timeout waiting for execution to reach phase %s after %v (stuck at phase: %s)", targetPhase.String(), timeout, currentPhase)
}

// GetExecutionMessages retrieves all messages from an execution
func GetExecutionMessages(serverPort int, executionID string) ([]string, error) {
	execution, err := GetAgentExecutionViaAPI(serverPort, executionID)
	if err != nil {
		return nil, err
	}

	if execution.Status == nil || len(execution.Status.Messages) == 0 {
		return []string{}, nil
	}

	messages := make([]string, len(execution.Status.Messages))
	for i, msg := range execution.Status.Messages {
		messages[i] = msg.Content
	}

	return messages, nil
}

// GetWorkflowViaAPI retrieves a workflow by ID
func GetWorkflowViaAPI(serverPort int, workflowID string) (*workflowv1.Workflow, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create workflow query client
	client := workflowv1.NewWorkflowQueryControllerClient(conn)

	// Query the workflow
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	workflow, err := client.Get(ctx, &workflowv1.WorkflowId{Value: workflowID})
	if err != nil {
		return nil, fmt.Errorf("failed to get workflow: %w", err)
	}

	return workflow, nil
}

// GetWorkflowBySlug queries a workflow by slug and organization via gRPC API
// This is the proper way to verify workflows by slug in tests
func GetWorkflowBySlug(serverPort int, slug string, org string) (*workflowv1.Workflow, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create workflow query client
	client := workflowv1.NewWorkflowQueryControllerClient(conn)

	// Query the workflow by reference (slug + org)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	workflow, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
		Scope: apiresource.ApiResourceOwnerScope_organization,
		Org:   org,
		Kind:  apiresourcekind.ApiResourceKind_workflow,
		Slug:  slug,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get workflow by slug: %w", err)
	}

	return workflow, nil
}

// WorkflowExistsViaAPI checks if a workflow exists by querying the gRPC API
// This is the proper way to verify workflows in tests (not direct DB access)
func WorkflowExistsViaAPI(serverPort int, workflowID string) (bool, error) {
	workflow, err := GetWorkflowViaAPI(serverPort, workflowID)
	if err != nil {
		return false, err
	}
	return workflow != nil, nil
}

// WorkflowExecutionExistsViaAPI checks if a workflow execution exists by querying the gRPC API
// This is the proper way to verify executions in tests (not direct DB access)
func WorkflowExecutionExistsViaAPI(serverPort int, executionID string) (bool, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return false, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create workflow execution query client
	client := workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn)

	// Query the execution
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err = client.Get(ctx, &workflowexecutionv1.WorkflowExecutionId{Value: executionID})
	if err != nil {
		// Check if it's a NotFound error (execution doesn't exist) or another error
		return false, fmt.Errorf("failed to get execution: %w", err)
	}

	return true, nil
}

// GetWorkflowExecutionViaAPI retrieves a workflow execution by ID
func GetWorkflowExecutionViaAPI(serverPort int, executionID string) (*workflowexecutionv1.WorkflowExecution, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create workflow execution query client
	client := workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn)

	// Query the execution
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	execution, err := client.Get(ctx, &workflowexecutionv1.WorkflowExecutionId{Value: executionID})
	if err != nil {
		return nil, fmt.Errorf("failed to get execution: %w", err)
	}

	return execution, nil
}

// WaitForWorkflowExecutionPhase polls the execution until it reaches the target phase or times out
// Returns the execution object when target phase is reached, or error on timeout
func WaitForWorkflowExecutionPhase(serverPort int, executionID string, targetPhase workflowexecutionv1.ExecutionPhase, timeout time.Duration) (*workflowexecutionv1.WorkflowExecution, error) {
	deadline := time.Now().Add(timeout)
	var lastExecution *workflowexecutionv1.WorkflowExecution
	
	for time.Now().Before(deadline) {
		execution, err := GetWorkflowExecutionViaAPI(serverPort, executionID)
		if err != nil {
			// Execution might not exist yet, keep waiting
			time.Sleep(500 * time.Millisecond)
			continue
		}

		lastExecution = execution

		// Check if we've reached the target phase
		if execution.Status != nil && execution.Status.Phase == targetPhase {
			return execution, nil
		}

		// Check if execution is in a terminal failed state
		if execution.Status != nil && execution.Status.Phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED {
			return execution, fmt.Errorf("execution failed (target phase was %s)", targetPhase.String())
		}

		// Not there yet, wait and retry
		time.Sleep(500 * time.Millisecond)
	}

	// Timeout reached - include current phase for debugging
	currentPhase := "UNKNOWN"
	if lastExecution != nil && lastExecution.Status != nil {
		currentPhase = lastExecution.Status.Phase.String()
	}
	return nil, fmt.Errorf("timeout waiting for execution to reach phase %s after %v (stuck at phase: %s)", targetPhase.String(), timeout, currentPhase)
}

// GetAgentInstanceViaAPI queries an agent instance by ID via gRPC API
func GetAgentInstanceViaAPI(serverPort int, instanceID string) (*agentinstancev1.AgentInstance, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create agent instance query client
	client := agentinstancev1.NewAgentInstanceQueryControllerClient(conn)

	// Query the agent instance
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	instance, err := client.Get(ctx, &agentinstancev1.AgentInstanceId{Value: instanceID})
	if err != nil {
		return nil, fmt.Errorf("failed to get agent instance: %w", err)
	}

	return instance, nil
}

// GetWorkflowInstanceViaAPI queries a workflow instance by ID via gRPC API
func GetWorkflowInstanceViaAPI(serverPort int, instanceID string) (*workflowinstancev1.WorkflowInstance, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create workflow instance query client
	client := workflowinstancev1.NewWorkflowInstanceQueryControllerClient(conn)

	// Query the workflow instance
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	instance, err := client.Get(ctx, &workflowinstancev1.WorkflowInstanceId{Value: instanceID})
	if err != nil {
		return nil, fmt.Errorf("failed to get workflow instance: %w", err)
	}

	return instance, nil
}
