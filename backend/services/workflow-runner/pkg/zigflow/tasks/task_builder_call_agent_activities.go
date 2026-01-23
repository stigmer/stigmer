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
	"sync"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/config"
	"go.temporal.io/sdk/activity"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

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
// 4. Create AgentExecution with callback_token
// 5. Return activity.ErrResultPending (activity paused, thread released)
// 6. [Agent executes asynchronously in Java/Python]
// 7. [Agent workflow completes and calls back using the token]
// 8. [Temporal resumes this activity with the result]
//
// **Key Points**:
// - Worker thread is NOT blocked during agent execution
// - Activity remains in "Running" state until callback
// - Token is durable in Temporal; survives restarts
// - Timeout configured via StartToCloseTimeout (should be 24+ hours)
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
) (any, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("⏳ Starting agent call activity (async completion pattern)",
		"agent", taskConfig.Agent,
		"scope", taskConfig.Scope)

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

	// **STEP 2: Agent Resolution**
	// Extract org ID from runtime environment (set by workflow execution context)
	orgId := getOrgIdFromRuntimeEnv(runtimeEnv)
	if orgId == "" {
		logger.Error("Organization ID not found in runtime environment")
		return nil, fmt.Errorf("organization ID not available in workflow execution context")
	}

	// Resolve agent slug + scope to actual agent ID
	agentId, err := a.resolveAgent(ctx, resolvedConfig.Agent, resolvedConfig.Scope, orgId)
	if err != nil {
		logger.Error("Failed to resolve agent", "agent", resolvedConfig.Agent, "error", err)
		return nil, fmt.Errorf("agent '%s' not found: %w", resolvedConfig.Agent, err)
	}
	logger.Debug("Agent resolved", "agent", resolvedConfig.Agent, "agent_id", agentId)

	// **STEP 3: Create Agent Execution** (with callback token)
	execution, err := a.createAgentExecution(ctx, agentId, resolvedConfig, taskToken)
	if err != nil {
		logger.Error("❌ Failed to create agent execution", "error", err)
		return nil, fmt.Errorf("failed to create agent execution: %w", err)
	}
	executionId := execution.Metadata.Id
	logger.Info("✅ Agent execution created with callback token",
		"execution_id", executionId,
		"token_preview", tokenPreview)

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
		Scope:   config.Scope,
		Message: config.Message,
		Config:  config.Config,
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

// resolveAgent resolves an agent slug to an agent ID using the Agent query service.
// Uses ApiResourceReference to query by scope, org, and slug.
func (a *CallAgentActivities) resolveAgent(
	ctx context.Context,
	slug string,
	scope apiresource.ApiResourceOwnerScope,
	orgId string,
) (string, error) {
	logger := activity.GetLogger(ctx)

	// Build the ApiResourceReference
	// This tells the backend: "Find agent with this slug in this scope/org"
	reference := &apiresource.ApiResourceReference{
		Scope: scope,
		Org:   orgId,
		Kind:  apiresourcekind.ApiResourceKind_agent,
		Slug:  slug,
	}

	logger.Debug("Resolving agent by reference",
		"slug", slug,
		"scope", scope,
		"org", orgId)

	// Get gRPC client
	client, err := getAgentQueryClient()
	if err != nil {
		return "", fmt.Errorf("failed to create agent query client: %w", err)
	}

	// Query agent by reference
	agent, err := client.GetByReference(ctx, reference)
	if err != nil {
		return "", fmt.Errorf("getByReference failed: %w", err)
	}

	return agent.Metadata.Id, nil
}

// createAgentExecution creates a new agent execution through the AgentExecution command service.
// The callbackToken enables async activity completion pattern.
func (a *CallAgentActivities) createAgentExecution(
	ctx context.Context,
	agentId string,
	config *workflowtasks.AgentCallTaskConfig,
	callbackToken []byte,
) (*agentexecv1.AgentExecution, error) {
	logger := activity.GetLogger(ctx)

	// Convert env map to ExecutionValue format
	// ExecutionValue has {value: string, is_secret: bool}
	// We mark all env vars as non-secrets since actual secrets are already resolved
	runtimeEnv := make(map[string]*executioncontextv1.ExecutionValue)
	for key, value := range config.Env {
		runtimeEnv[key] = &executioncontextv1.ExecutionValue{
			Value:    value,
			IsSecret: false, // Secrets already resolved by this point
		}
	}

	// Build execution spec with callback token for async completion
	spec := &agentexecv1.AgentExecutionSpec{
		AgentId:       agentId,
		Message:       config.Message,
		RuntimeEnv:    runtimeEnv,
		CallbackToken: callbackToken, // 👈 Pass token for async completion
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
		Metadata:   &apiresource.ApiResourceMetadata{
			Name: executionName,
			// ID and Slug will be auto-generated by backend from Name
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
			return // Error stored in grpcConnErr
		}
		agentExecCommandClient = agentexecv1.NewAgentExecutionCommandControllerClient(conn)
	})

	if grpcConnErr != nil {
		return nil, grpcConnErr
	}

	return agentExecCommandClient, nil
}
