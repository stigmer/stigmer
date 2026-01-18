/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/graphs/contributors>
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
	"fmt"
	"sync"
	"time"

	agentv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	executioncontextv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	workflowtasks "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/config"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"go.temporal.io/sdk/activity"
)

func init() {
	activitiesRegistry = append(activitiesRegistry, &CallAgentActivities{})
}

// CallAgentActivities implements the activity for executing agent calls from workflows.
type CallAgentActivities struct{}

// CallAgentActivity executes an agent call as part of a workflow.
// It handles:
// 1. JIT secret resolution (${.secrets.KEY} → actual secret value)
// 2. Agent slug resolution (agent name → agent ID)
// 3. Agent execution creation
// 4. Waiting for execution to complete
// 5. Returning the agent's response
//
// SECURITY CRITICAL: Secrets are resolved HERE (in activity), never in workflow context.
// This ensures secrets don't appear in Temporal workflow history.
func (a *CallAgentActivities) CallAgentActivity(
	ctx context.Context,
	taskConfig *workflowtasks.AgentCallTaskConfig,
	input any,
	runtimeEnv map[string]any,
) (any, error) {
	logger := activity.GetLogger(ctx)
	logger.Debug("Running call agent activity",
		"agent", taskConfig.Agent,
		"scope", taskConfig.Scope)

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

	// **STEP 3: Create Agent Execution**
	execution, err := a.createAgentExecution(ctx, agentId, resolvedConfig)
	if err != nil {
		logger.Error("Failed to create agent execution", "error", err)
		return nil, fmt.Errorf("failed to create agent execution: %w", err)
	}
	executionId := execution.Metadata.Id
	logger.Info("Agent execution created", "execution_id", executionId)

	// **STEP 4: Wait for Completion**
	result, err := a.waitForCompletion(ctx, executionId)
	if err != nil {
		logger.Error("Agent execution failed", "execution_id", executionId, "error", err)
		return nil, fmt.Errorf("agent execution failed: %w", err)
	}
	logger.Info("Agent execution completed", "execution_id", executionId)

	// **STEP 5: Sanitize Output** (Security Check)
	// Detect if agent response accidentally contains secret values
	if runtimeEnv != nil && len(runtimeEnv) > 0 {
		warnings := SanitizeOutput(result, runtimeEnv)
		for _, warning := range warnings {
			logger.Warn("Potential secret leakage detected in agent response", "warning", warning)
		}
	}

	return result, nil
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
func (a *CallAgentActivities) createAgentExecution(
	ctx context.Context,
	agentId string,
	config *workflowtasks.AgentCallTaskConfig,
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

	// Build execution spec
	spec := &agentexecv1.AgentExecutionSpec{
		AgentId:    agentId,
		Message:    config.Message,
		RuntimeEnv: runtimeEnv,
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
	execution := &agentexecv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			// Name will be auto-generated by backend
			// ID will be auto-generated by backend
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
