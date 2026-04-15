package root

import (
	"context"
	"fmt"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"google.golang.org/grpc"
)

// CreateAgentExecutionInput holds the parameters for creating an agent execution.
//
// At least one of AgentID or SessionID must be provided (both may be set):
//   - AgentID only: starts a new session (backend auto-creates it).
//   - SessionID only: follow-up execution; the backend infers the agent.
//   - Both: execution within an existing session with explicit agent metadata.
type CreateAgentExecutionInput struct {
	AgentID           string
	SessionID         string
	OrgID             string
	Message           string
	RuntimeEnv        envfile.EnvMap
	Attachments       []*agentexecutionv1.Attachment
	WorkspaceFileRefs []string
	Model             string
	AutoApproveAll    bool
	Conn              *grpc.ClientConn
}

// createAgentExecution creates a new agent execution.
//
// Both SessionID and AgentID are set on the spec when available.
// The backend requires at least one and uses SessionID for session
// resolution when present; AgentID is preserved as metadata for
// downstream consumers (e.g., session subject generation).
func createAgentExecution(input CreateAgentExecutionInput) (*agentexecutionv1.AgentExecution, error) {
	message := input.Message
	if message == "" {
		message = "execute"
	}

	executionName := fmt.Sprintf("execution-%d", time.Now().UnixMicro())

	spec := &agentexecutionv1.AgentExecutionSpec{
		Message:           message,
		RuntimeEnv:        input.RuntimeEnv,
		Attachments:       input.Attachments,
		WorkspaceFileRefs: input.WorkspaceFileRefs,
		AutoApproveAll:    input.AutoApproveAll,
	}

	if input.SessionID != "" {
		spec.SessionId = input.SessionID
	}
	if input.AgentID != "" {
		spec.AgentId = input.AgentID
	}

	if input.Model != "" {
		spec.ExecutionConfig = &agentexecutionv1.ExecutionConfig{
			ModelName: input.Model,
		}
	}

	execution := &agentexecutionv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: executionName,
			Org:  input.OrgID,
		},
		Spec: spec,
	}

	client := agentexecutionv1.NewAgentExecutionCommandControllerClient(input.Conn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := client.Create(ctx, execution)
	if err != nil {
		return nil, fmt.Errorf("failed to create execution: %w", err)
	}

	return result, nil
}

// createSessionForAgent creates a new session with workspace entries.
//
// This is used when the CLI needs explicit control over session creation
// (e.g., to set workspace entries), bypassing the backend's auto-create flow
// which has no workspace passthrough. The session subject uses the same
// sentinel as the backend auto-create, so the LLM-generated title activity
// will replace it asynchronously.
func createSessionForAgent(agentInstanceID, orgID string, entries []*sessionv1.WorkspaceEntry, conn *grpc.ClientConn) (*sessionv1.Session, error) {
	client := sessionv1.NewSessionCommandControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	session := &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: fmt.Sprintf("session-%d", time.Now().UnixMilli()),
			Org:  orgID,
		},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId:  agentInstanceID,
			Subject:          "Auto-created session",
			WorkspaceEntries: entries,
		},
	}

	result, err := client.Create(ctx, session)
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
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
