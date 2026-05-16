/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/stigmer/stigmer/backend/services/workflow-runner/graphs/contributors>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package tasks

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"sync"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	workflowexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/config"
	workflowexecclient "github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/grpc_client"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

// ─────────────────────────────────────────────────────────────────────────────
// Signal Constants (HITL Phase 5.1)
// ─────────────────────────────────────────────────────────────────────────────

// SignalChildApprovalRequired is the Temporal signal name sent by child agent
// executions when they require approval. The parent workflow listens for this
// signal to update its task status to WAITING_APPROVAL.
//
// Signal Flow:
// 1. Child agent enters WAITING_FOR_APPROVAL phase
// 2. Java agent execution workflow sends this signal to parent workflow
// 3. Parent Go workflow receives signal and updates task status
// 4. UI can then show approval request at workflow level
const SignalChildApprovalRequired = "child_approval_required"

func init() {
	activitiesRegistry = append(activitiesRegistry, &CallAgentActivities{})
}

// CallAgentActivities implements the activity for executing agent calls from workflows.
type CallAgentActivities struct{}

// CallAgentActivity executes an agent call as part of a workflow using async completion.
//
// **Async Activity Completion Pattern** (Token Handshake):
// This activity uses Temporal's async completion pattern to avoid blocking worker
// threads during long-running agent execution (which can take minutes to hours).
//
// **Flow**:
// 1. Extract Temporal task token (unique identifier for this activity execution)
// 2. Resolve JIT secrets (${.secrets.KEY} → actual values)
// 3. Resolve agent slug to agent ID
// 4. Create AgentExecution with callback_token and parent_workflow_id
// 5. Return activity.ErrResultPending (activity paused, thread released)
// 6. [Agent executes asynchronously in Java/Python]
// 7. [If approval needed, Java signals parent via parent_workflow_id]
// 8. [Agent workflow completes and calls back using the token]
// 9. [Temporal resumes this activity with the result]
//
// **Key Points**:
// - Worker thread is NOT blocked during agent execution
// - Activity remains in "Running" state until callback
// - Token is durable in Temporal; survives restarts
// - Timeout configured via StartToCloseTimeout (should be 24+ hours)
// - Parent workflow ID enables events-based approval notification (Phase 5.1)
//
// **SECURITY CRITICAL**: Secrets are resolved HERE (in activity), never in workflow context.
// This ensures secrets don't appear in Temporal workflow history.
//
// @see ADR: docs/adr/20260122-async-agent-execution-temporal-token-handshake.md
// @see Temporal Docs: https://docs.temporal.io/activities#asynchronous-activity-completion
func (a *CallAgentActivities) CallAgentActivity(
	ctx context.Context,
	taskConfig *workflowtasks.AgentCallTaskConfig,
	input any,
	runtimeEnv map[string]any,
	parentWorkflowId string, // Phase 5.1: For events-based approval notification
) (any, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("⏳ Starting agent call activity (async completion pattern)",
		"agent", taskConfig.Agent,
		"org", taskConfig.Org)

	// **STEP 0: Extract Temporal Task Token** (for async completion)
	// This token uniquely identifies this activity execution and allows the agent
	// workflow to complete it asynchronously after agent execution finishes.
	activityInfo := activity.GetInfo(ctx)
	taskToken := activityInfo.TaskToken

	// Log token for debugging (Base64, truncated for security)
	// The full token is ~100-200 bytes; we log first 20 chars of Base64 encoding
	tokenBase64 := base64.StdEncoding.EncodeToString(taskToken)
	tokenPreview := tokenBase64
	if len(tokenPreview) > 20 {
		tokenPreview = tokenPreview[:20] + "..."
	}

	logger.Info("📝 Extracted Temporal task token for async completion",
		"token_preview", tokenPreview,
		"token_length", len(taskToken),
		"activity_id", activityInfo.ActivityID,
		"workflow_id", activityInfo.WorkflowExecution.ID)

	// **STEP 1: JIT Secret Resolution**
	// Resolve runtime placeholders just-in-time to prevent secret leakage.
	// Task has evaluated workflow expressions, but still contains placeholders like:
	//   - ${.secrets.API_KEY} → resolved to actual secret value
	//   - ${.env_vars.REGION} → resolved to actual environment value
	//
	// This ensures secrets NEVER appear in Temporal workflow history.
	resolvedConfig := taskConfig
	if runtimeEnv != nil && len(runtimeEnv) > 0 {
		logger.Debug("Resolving runtime placeholders in agent task", "env_count", len(runtimeEnv))

		var err error
		resolvedConfig, err = a.resolveRuntimePlaceholders(taskConfig, runtimeEnv)
		if err != nil {
			logger.Error("Failed to resolve runtime placeholders", "error", err)
			return nil, fmt.Errorf("failed to resolve runtime placeholders: %w", err)
		}

		logger.Debug("Runtime placeholders resolved successfully")
	}

	// Build authenticated context with user's Bearer token
	authCtx, err := buildAuthenticatedContext(ctx)
	if err != nil {
		logger.Error("Failed to build authenticated context", "error", err)
		return nil, fmt.Errorf("failed to build authenticated context: %w", err)
	}

	// **STEP 2: Agent Resolution**
	// Get org from task config (set by workflow definition)
	// Fall back to runtime environment if not explicitly set
	orgId := resolvedConfig.Org
	if orgId == "" {
		orgId = getOrgIdFromRuntimeEnv(runtimeEnv)
	}
	if orgId == "" {
		logger.Error("Organization ID not found in task config or runtime environment")
		return nil, fmt.Errorf("organization ID not available in workflow execution context")
	}

	// Resolve agent org/slug to full agent object (OBO context for user-facing read)
	agent, err := a.resolveAgent(authCtx, resolvedConfig.Agent, orgId)
	if err != nil {
		logger.Error("Failed to resolve agent", "agent", resolvedConfig.Agent, "org", orgId, "error", err)
		return nil, fmt.Errorf("agent '%s' not found in org '%s': %w", resolvedConfig.Agent, orgId, err)
	}
	agentId := agent.Metadata.Id
	defaultInstanceId := ""
	if agent.Status != nil {
		defaultInstanceId = agent.Status.DefaultInstanceId
	}
	logger.Debug("Agent resolved", "agent", resolvedConfig.Agent, "org", orgId,
		"agent_id", agentId, "default_instance_id", defaultInstanceId)

	// **STEP 3: Create Session** (unified with frontend two-step pattern)
	// Session owns harness, runner affinity, and workspace config.
	session, err := a.createSession(authCtx, orgId, defaultInstanceId,
		resolvedConfig.Harness, os.Getenv("STIGMER_RUNNER_ID"),
		resolvedConfig.Agent)
	if err != nil {
		logger.Error("❌ Failed to create session for agent call", "error", err)
		return nil, fmt.Errorf("failed to create session: %w", err)
	}
	logger.Info("Session created for agent call",
		"session_id", session.Metadata.Id,
		"harness", resolvedConfig.Harness,
		"runner_id", os.Getenv("STIGMER_RUNNER_ID"))

	// **STEP 4: Create Agent Execution** (with session_id from step 3)
	execution, err := a.createAgentExecution(authCtx, agentId, orgId, resolvedConfig,
		taskToken, parentWorkflowId, session.Metadata.Id)
	if err != nil {
		logger.Error("❌ Failed to create agent execution", "error", err)
		return nil, fmt.Errorf("failed to create agent execution: %w", err)
	}
	executionId := execution.Metadata.Id
	logger.Info("✅ Agent execution created with callback token and parent workflow context",
		"execution_id", executionId,
		"session_id", session.Metadata.Id,
		"token_preview", tokenPreview,
		"parent_workflow_id", parentWorkflowId)

	// **STEP 4: Return Pending** (async completion - activity paused, thread released)
	// The agent workflow will complete this activity asynchronously when it finishes.
	// Until then:
	// - This activity appears as "Running" in Temporal UI
	// - The worker thread is released (not blocked)
	// - The workflow is paused at this point
	// - Timeout is controlled by StartToCloseTimeout (should be 24+ hours)
	logger.Info("⏸️ Returning activity.ErrResultPending - activity paused for async completion",
		"execution_id", executionId,
		"activity_id", activityInfo.ActivityID,
		"workflow_id", activityInfo.WorkflowExecution.ID)

	return nil, activity.ErrResultPending

	// NOTE: The old polling logic (waitForCompletion) has been removed.
	// The agent workflow will now complete this activity asynchronously using
	// ActivityCompletionClient.complete(token, result) when it finishes.
	//
	// Output sanitization (secret leakage detection) will be handled by the
	// agent workflow before calling the completion callback.
}

// resolveRuntimePlaceholders resolves JIT placeholders in the agent config.
// Returns a new config with placeholders replaced by actual values.
func (a *CallAgentActivities) resolveRuntimePlaceholders(
	config *workflowtasks.AgentCallTaskConfig,
	runtimeEnv map[string]any,
) (*workflowtasks.AgentCallTaskConfig, error) {
	// Clone the config to avoid modifying the original
	resolvedConfig := &workflowtasks.AgentCallTaskConfig{
		Agent:   config.Agent,
		Org:     config.Org,
		Message: config.Message,
		Config:  config.Config,
		Harness: config.Harness,
		Env:     make(map[string]string),
	}

	// Resolve placeholders in message
	if config.Message != "" {
		resolvedMessage, err := ResolvePlaceholders(config.Message, runtimeEnv)
		if err != nil {
			return nil, fmt.Errorf("error resolving message placeholders: %w", err)
		}
		resolvedConfig.Message = resolvedMessage
	}

	// Resolve placeholders in env vars
	for key, value := range config.Env {
		resolvedValue, err := ResolvePlaceholders(value, runtimeEnv)
		if err != nil {
			return nil, fmt.Errorf("error resolving env[%s] placeholders: %w", key, err)
		}
		resolvedConfig.Env[key] = resolvedValue
	}

	return resolvedConfig, nil
}

// resolveAgent resolves an agent slug to the full Agent object using the Agent query service.
// Returns the complete agent including status (needed for default_instance_id).
func (a *CallAgentActivities) resolveAgent(
	ctx context.Context,
	slug string,
	orgId string,
) (*agentv1.Agent, error) {
	logger := activity.GetLogger(ctx)

	reference := &apiresource.ApiResourceReference{
		Org:  orgId,
		Kind: apiresourcekind.ApiResourceKind_agent,
		Slug: slug,
	}

	logger.Debug("Resolving agent by reference",
		"slug", slug,
		"org", orgId)

	client, err := getAgentQueryClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create agent query client: %w", err)
	}

	agent, err := client.GetByReference(ctx, reference)
	if err != nil {
		return nil, fmt.Errorf("getByReference failed: %w", err)
	}

	return agent, nil
}

// createAgentExecution creates a new agent execution through the AgentExecution command service.
// The session must be created before calling this (two-step pattern matching frontend flow).
func (a *CallAgentActivities) createAgentExecution(
	ctx context.Context,
	agentId string,
	orgId string,
	config *workflowtasks.AgentCallTaskConfig,
	callbackToken []byte,
	parentWorkflowId string,
	sessionId string,
) (*agentexecv1.AgentExecution, error) {
	logger := activity.GetLogger(ctx)

	runtimeEnv := make(map[string]*executioncontextv1.ExecutionValue)
	for key, value := range config.Env {
		runtimeEnv[key] = &executioncontextv1.ExecutionValue{
			Value:    value,
			IsSecret: false,
		}
	}

	spec := &agentexecv1.AgentExecutionSpec{
		SessionId:        sessionId,
		AgentId:          agentId,
		Message:          config.Message,
		RuntimeEnv:       runtimeEnv,
		CallbackToken:    callbackToken,
		ParentWorkflowId: parentWorkflowId,
	}

	// Add execution config if provided
	if config.Config != nil {
		spec.ExecutionConfig = &agentexecv1.ExecutionConfig{
			ModelName: config.Config.Model,
			// Note: timeout is for activity timeout, not agent execution timeout
			// Agent execution timeout is handled by agent-runner
		}
	}

	// Build full AgentExecution message
	// Generate a name for the execution (backend will slugify it)
	// Format: {agent-slug}-execution-{timestamp}
	executionName := fmt.Sprintf("%s-execution-%d", config.Agent, time.Now().Unix())

	execution := &agentexecv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: executionName,
			Org:  orgId,
		},
		Spec: spec,
	}

	logger.Debug("Creating agent execution", "agent_id", agentId)

	// Get gRPC client
	client, err := getAgentExecutionCommandClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create agent execution command client: %w", err)
	}

	// Create the execution
	createdExecution, err := client.Create(ctx, execution)
	if err != nil {
		return nil, fmt.Errorf("create agent execution failed: %w", err)
	}

	return createdExecution, nil
}

// createSession creates a new session for an agent call, matching the frontend
// two-step pattern. Session owns harness (execution engine) and runner affinity.
func (a *CallAgentActivities) createSession(
	ctx context.Context,
	orgId string,
	instanceId string,
	harness sessionv1.Harness,
	runnerId string,
	agentSlug string,
) (*sessionv1.Session, error) {
	client, err := getSessionCommandClient()
	if err != nil {
		return nil, fmt.Errorf("failed to get session command client: %w", err)
	}

	sessionName := fmt.Sprintf("wf-%s-%d", agentSlug, time.Now().Unix())
	session := &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: sessionName,
			Org:  orgId,
		},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: instanceId,
			Subject:         fmt.Sprintf("Workflow: %s", agentSlug),
			Harness:         harness,
		},
	}

	if runnerId != "" {
		session.Spec.RunnerId = runnerId
	}

	created, err := client.Create(ctx, session)
	if err != nil {
		return nil, fmt.Errorf("create session failed: %w", err)
	}

	return created, nil
}

// waitForCompletion polls the agent execution status until it reaches a terminal state.
// Returns the agent's final response or an error if execution failed.
func (a *CallAgentActivities) waitForCompletion(
	ctx context.Context,
	executionId string,
) (any, error) {
	logger := activity.GetLogger(ctx)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	// Get query client
	client, err := getAgentExecutionQueryClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create agent execution query client: %w", err)
	}

	for {
		select {
		case <-ticker.C:
			// Send heartbeat to prevent activity timeout
			activity.RecordHeartbeat(ctx, "waiting for agent execution")

			// Query execution status
			execution, err := client.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionId})
			if err != nil {
				return nil, fmt.Errorf("failed to query execution status: %w", err)
			}

			phase := execution.Status.Phase
			logger.Debug("Agent execution status", "phase", phase)

			// Check if terminal
			if isTerminalPhase(phase) {
				if phase == agentexecv1.ExecutionPhase_EXECUTION_FAILED {
					return nil, fmt.Errorf("agent execution failed: %s", execution.Status.Error)
				}
				if phase == agentexecv1.ExecutionPhase_EXECUTION_CANCELLED {
					return nil, fmt.Errorf("agent execution was cancelled")
				}

				// Extract final response from messages
				response := extractAgentResponse(execution.Status.Messages)
				logger.Info("Agent execution completed successfully")
				return response, nil
			}

		case <-ctx.Done():
			return nil, fmt.Errorf("activity context cancelled: %w", ctx.Err())
		}
	}
}

// isTerminalPhase checks if an execution phase is terminal (completed/failed/cancelled).
func isTerminalPhase(phase agentexecv1.ExecutionPhase) bool {
	return phase == agentexecv1.ExecutionPhase_EXECUTION_COMPLETED ||
		phase == agentexecv1.ExecutionPhase_EXECUTION_FAILED ||
		phase == agentexecv1.ExecutionPhase_EXECUTION_CANCELLED
}

// extractAgentResponse extracts the final AI response from execution messages.
// Returns the last AI message content, or a map of all messages if no AI message found.
func extractAgentResponse(messages []*agentexecv1.AgentMessage) any {
	if len(messages) == 0 {
		return map[string]any{"content": "", "messages": []any{}}
	}

	// Find the last AI message (agent's final response)
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Type == agentexecv1.MessageType_MESSAGE_AI {
			// Return just the content as a simple string for workflow use
			// Workflows typically just need the text response
			return messages[i].Content
		}
	}

	// No AI message found - return all messages as structured data
	// This handles edge cases where execution completed without AI message
	allMessages := make([]map[string]any, len(messages))
	for i, msg := range messages {
		allMessages[i] = map[string]any{
			"type":      msg.Type.String(),
			"content":   msg.Content,
			"timestamp": msg.Timestamp,
		}
	}

	return map[string]any{
		"content":  "", // No AI response
		"messages": allMessages,
	}
}

// getOrgIdFromRuntimeEnv extracts the organization ID from the runtime environment.
// The org ID is injected by the workflow execution when it starts, based on the
// WorkflowExecution.metadata.org field.
func getOrgIdFromRuntimeEnv(runtimeEnv map[string]any) string {
	if runtimeEnv == nil {
		return ""
	}

	// The org ID is stored as __stigmer_org_id in the runtime environment
	// This is set by the workflow execution in temporal_workflow.go
	if orgId, ok := runtimeEnv["__stigmer_org_id"]; ok {
		if orgIdStr, ok := orgId.(string); ok {
			return orgIdStr
		}
		// Handle case where it might be wrapped in ExecutionValue structure
		if orgIdMap, ok := orgId.(map[string]interface{}); ok {
			if value, ok := orgIdMap["value"].(string); ok {
				return value
			}
		}
	}

	return ""
}

// ─────────────────────────────────────────────────────────────────────────────
// Local Activities for Workflow Approval Status (HITL Phase 5.1)
//
// These activities update the WorkflowExecution status when child agents
// require or resolve approval. They run in-process without task queue overhead.
// ─────────────────────────────────────────────────────────────────────────────

// getLocalActivityOptions returns options for local activities.
// Local activities run in-process without going through Temporal task queues,
// which is ideal for quick RPC calls like status updates.
func getLocalActivityOptions() workflow.LocalActivityOptions {
	return workflow.LocalActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 2 * time.Second,
		},
	}
}

// UpdateWorkflowTaskApprovalStatus updates the workflow execution to reflect
// that a child agent task is waiting for approval. This is called when the
// child agent signals that it has entered WAITING_FOR_APPROVAL phase.
//
// This local activity:
// 1. Builds pending_approvals from the ChildApprovalNotification
// 2. Updates the WorkflowExecution status via gRPC
// 3. Enables UI to display approval requests at workflow level
//
// The status update is additive - it only sets the pending_approvals field
// without clearing other status fields like tasks[] or phase.
func (a *CallAgentActivities) UpdateWorkflowTaskApprovalStatus(
	ctx context.Context,
	executionId string,
	taskName string,
	notification *agentexecv1.ChildApprovalNotification,
) error {
	logger := activity.GetLogger(ctx)

	pendingCount := len(notification.PendingApprovals)
	logger.Info("Updating workflow execution with pending approvals",
		"execution_id", executionId,
		"task_name", taskName,
		"agent_execution_id", notification.ExecutionId,
		"pending_count", pendingCount)

	// Get workflow execution client
	client, err := workflowexecclient.GetWorkflowExecutionCommandClient()
	if err != nil {
		logger.Error("Failed to get workflow execution client", "error", err)
		return fmt.Errorf("failed to get workflow execution client: %w", err)
	}

	// Wrap each PendingApproval from the notification in a WorkflowPendingApproval
	// with the child execution ID for routing.
	pendingApprovals := make([]*workflowexecv1.WorkflowPendingApproval, 0, pendingCount)
	for _, pa := range notification.PendingApprovals {
		entry := &workflowexecv1.WorkflowPendingApproval{
			Approval:              pa,
			ChildAgentExecutionId: notification.ExecutionId,
		}
		pendingApprovals = append(pendingApprovals, entry)
	}

	status := &workflowexecv1.WorkflowExecutionStatus{
		PendingApprovals: pendingApprovals,
	}

	// Update workflow execution status
	_, err = client.UpdateStatus(ctx, executionId, status)
	if err != nil {
		logger.Error("Failed to update workflow execution status",
			"execution_id", executionId,
			"error", err)
		return fmt.Errorf("failed to update workflow execution status: %w", err)
	}

	logger.Info("Successfully updated workflow execution with pending approvals",
		"execution_id", executionId,
		"pending_count", pendingCount)

	return nil
}

// ClearWorkflowApprovalStatus clears pending approvals on a workflow execution
// when the child agent task completes. Sends an empty list via the full-replace
// protocol — the server unconditionally replaces the stored list.
func (a *CallAgentActivities) ClearWorkflowApprovalStatus(
	ctx context.Context,
	executionId string,
) error {
	logger := activity.GetLogger(ctx)

	client, err := workflowexecclient.GetWorkflowExecutionCommandClient()
	if err != nil {
		logger.Error("Failed to get workflow execution client", "error", err)
		return fmt.Errorf("failed to get workflow execution client: %w", err)
	}

	status := &workflowexecv1.WorkflowExecutionStatus{
		PendingApprovals: []*workflowexecv1.WorkflowPendingApproval{},
	}

	_, err = client.UpdateStatus(ctx, executionId, status)
	if err != nil {
		logger.Warn("Failed to clear workflow pending approvals",
			"execution_id", executionId,
			"error", err)
		return fmt.Errorf("failed to clear workflow pending approvals: %w", err)
	}

	logger.Debug("Cleared pending approvals on workflow execution",
		"execution_id", executionId)

	return nil
}

// buildAuthenticatedContext creates a gRPC context with the user's Bearer token
// from STIGMER_TOKEN (injected by the sandbox launcher).
func buildAuthenticatedContext(ctx context.Context) (context.Context, error) {
	cfg, err := config.LoadStigmerConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load stigmer config: %w", err)
	}

	authCtx := ctx
	if cfg.APIKey != "" {
		authCtx = metadata.AppendToOutgoingContext(authCtx, "authorization", "Bearer "+cfg.APIKey)
	}

	return authCtx, nil
}

// gRPC client accessors
// These are lazy-initialized and cached at package level for efficient reuse across activity invocations.
// Thread-safe initialization is guaranteed by sync.Once.

var (
	// Package-level gRPC connection (shared for all clients)
	grpcConnOnce sync.Once
	grpcConn     *grpc.ClientConn
	grpcConnErr  error

	// Lazy-initialized gRPC clients
	agentQueryClientOnce sync.Once
	agentQueryClient     agentv1.AgentQueryControllerClient

	agentExecQueryClientOnce sync.Once
	agentExecQueryClient     agentexecv1.AgentExecutionQueryControllerClient

	agentExecCommandClientOnce sync.Once
	agentExecCommandClient     agentexecv1.AgentExecutionCommandControllerClient

	sessionCommandClientOnce sync.Once
	sessionCommandClient     sessionv1.SessionCommandControllerClient
)

// initGrpcConnection initializes the shared gRPC connection.
// This is called once per process and reused by all clients.
func initGrpcConnection() (*grpc.ClientConn, error) {
	grpcConnOnce.Do(func() {
		// Load Stigmer config from environment
		cfg, err := config.LoadStigmerConfig()
		if err != nil {
			grpcConnErr = fmt.Errorf("failed to load stigmer config: %w", err)
			return
		}

		var opts []grpc.DialOption

		// Configure TLS
		if cfg.UseTLS {
			creds := credentials.NewTLS(nil)
			opts = append(opts, grpc.WithTransportCredentials(creds))
		} else {
			opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
		}

		// Create connection
		grpcConn, grpcConnErr = grpc.NewClient(cfg.Endpoint, opts...)
		if grpcConnErr != nil {
			grpcConnErr = fmt.Errorf("failed to create gRPC client: %w", grpcConnErr)
		}
	})

	return grpcConn, grpcConnErr
}

func getAgentQueryClient() (agentv1.AgentQueryControllerClient, error) {
	agentQueryClientOnce.Do(func() {
		conn, err := initGrpcConnection()
		if err != nil {
			return // Error stored in grpcConnErr
		}
		agentQueryClient = agentv1.NewAgentQueryControllerClient(conn)
	})

	if grpcConnErr != nil {
		return nil, grpcConnErr
	}

	return agentQueryClient, nil
}

func getAgentExecutionQueryClient() (agentexecv1.AgentExecutionQueryControllerClient, error) {
	agentExecQueryClientOnce.Do(func() {
		conn, err := initGrpcConnection()
		if err != nil {
			return // Error stored in grpcConnErr
		}
		agentExecQueryClient = agentexecv1.NewAgentExecutionQueryControllerClient(conn)
	})

	if grpcConnErr != nil {
		return nil, grpcConnErr
	}

	return agentExecQueryClient, nil
}

func getAgentExecutionCommandClient() (agentexecv1.AgentExecutionCommandControllerClient, error) {
	agentExecCommandClientOnce.Do(func() {
		conn, err := initGrpcConnection()
		if err != nil {
			return
		}
		agentExecCommandClient = agentexecv1.NewAgentExecutionCommandControllerClient(conn)
	})

	if grpcConnErr != nil {
		return nil, grpcConnErr
	}

	return agentExecCommandClient, nil
}

func getSessionCommandClient() (sessionv1.SessionCommandControllerClient, error) {
	sessionCommandClientOnce.Do(func() {
		conn, err := initGrpcConnection()
		if err != nil {
			return
		}
		sessionCommandClient = sessionv1.NewSessionCommandControllerClient(conn)
	})

	if grpcConnErr != nil {
		return nil, grpcConnErr
	}

	return sessionCommandClient, nil
}
