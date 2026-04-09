package mcpserver

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"go.temporal.io/sdk/client"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	connectWorkflowName = "stigmer/mcp-server/connect"
	connectTimeout      = 45 * time.Second
	personalEnvLabel    = "stigmer.ai/personal"
)

// connectWorkflowInput matches the Python DiscoverMcpServerInput dataclass
// used by ConnectMcpServerWorkflow (discover + classify).
//
// Follows the slim-payload pattern: only reference IDs are passed through
// Temporal. The Python activity reads environment variables from the
// pre-created ExecutionContext, keeping secrets out of Temporal's durable
// workflow history.
type connectWorkflowInput struct {
	McpServerID              string `json:"mcp_server_id"`
	ExecutionContextID       string `json:"execution_context_id,omitempty"`
	InvokerIdentityAccountID string `json:"invoker_identity_account_id,omitempty"`
}

// connectWorkflowOutput matches the Python DiscoverMcpServerOutput dataclass.
type connectWorkflowOutput struct {
	Tools             []discoveredToolResult             `json:"tools"`
	ResourceTemplates []discoveredResourceTemplateResult `json:"resource_templates"`
}

type discoveredToolResult struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema,omitempty"`
}

type discoveredResourceTemplateResult struct {
	URITemplate string `json:"uri_template"`
	Name        string `json:"name"`
	Description string `json:"description"`
	MimeType    string `json:"mime_type"`
}

// Connect triggers server-side MCP discovery and tool approval classification
// via a Temporal workflow on the agent-runner.
//
// Lifecycle:
//  1. Resolve environment variables (from runtime_env or personal environment)
//  2. Create an ephemeral ExecutionContext with the resolved variables
//  3. Start the Temporal workflow with only the MCP server ID and EC ID
//  4. Block until the workflow completes
//  5. Delete the ExecutionContext (defer cleanup)
//  6. Store discovered capabilities on the McpServer resource
func (c *McpServerController) Connect(
	ctx context.Context,
	input *mcpserverv1.ConnectInput,
) (*mcpserverv1.McpServer, error) {
	if c.temporalClient == nil {
		return nil, grpclib.FailedPreconditionError(
			"connect is not available: Temporal not configured",
		)
	}

	mcpServerID := input.GetMcpServerId()
	if mcpServerID == "" {
		return nil, grpclib.InvalidArgumentError("mcp_server_id is required")
	}

	mcpServer := &mcpserverv1.McpServer{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, mcpServerID, mcpServer); err != nil {
		return nil, grpclib.NotFoundError("mcp_server", mcpServerID)
	}

	executionID := fmt.Sprintf("connect-%s-%s", mcpServerID, uuid.New().String()[:8])

	ecResourceID, err := c.createConnectExecutionContext(
		ctx, mcpServer, executionID, input.GetRuntimeEnv(),
	)
	if err != nil {
		return nil, err
	}

	if ecResourceID != "" {
		defer c.deleteConnectExecutionContext(ctx, ecResourceID, executionID)
	}

	wfInput := connectWorkflowInput{
		McpServerID:        mcpServerID,
		ExecutionContextID: executionID,
	}

	result, err := c.executeConnectWorkflow(ctx, mcpServerID, wfInput)
	if err != nil {
		return nil, err
	}

	capabilities := convertToDiscoveredCapabilities(result)
	if mcpServer.Status == nil {
		mcpServer.Status = &mcpserverv1.McpServerStatus{}
	}
	mcpServer.Status.DiscoveredCapabilities = capabilities

	if err := c.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, mcpServerID, mcpServer); err != nil {
		return nil, grpclib.InternalError(err, "failed to save mcp server after connect")
	}

	log.Info().
		Str("mcp_server_id", mcpServerID).
		Int("tools", len(capabilities.GetTools())).
		Int("resource_templates", len(capabilities.GetResourceTemplates())).
		Msg("MCP server connect completed and stored")

	return mcpServer, nil
}

// createConnectExecutionContext builds and persists an ephemeral ExecutionContext
// for the connect activity.
//
// When runtime_env is provided, the values are used directly (one-time use).
// When runtime_env is empty, values are resolved from the user's personal environment.
// Returns the ExecutionContext resource ID (for cleanup) and an error.
// Returns ("", nil) when the MCP server has no env_spec and no runtime_env.
func (c *McpServerController) createConnectExecutionContext(
	ctx context.Context,
	mcpServer *mcpserverv1.McpServer,
	executionID string,
	runtimeEnv map[string]*executioncontextv1.ExecutionValue,
) (string, error) {
	var ecData map[string]*executioncontextv1.ExecutionValue

	if len(runtimeEnv) > 0 {
		ecData = runtimeEnv

		log.Info().
			Str("execution_id", executionID).
			Int("runtime_env_count", len(runtimeEnv)).
			Msg("Using runtime_env for connect ExecutionContext (one-time use)")
	} else {
		envSpec := mcpServer.GetSpec().GetEnvSpec()
		if envSpec == nil || len(envSpec.GetData()) == 0 {
			log.Debug().
				Str("execution_id", executionID).
				Msg("MCP server has no env_spec — skipping ExecutionContext creation")
			return "", nil
		}

		resolved, err := c.resolveFromPersonalEnvironment(
			ctx, mcpServer.GetMetadata().GetOrg(), envSpec,
		)
		if err != nil {
			return "", err
		}
		ecData = resolved

		log.Info().
			Str("execution_id", executionID).
			Int("resolved_count", len(resolved)).
			Msg("Resolved env vars from personal environment for connect ExecutionContext")
	}

	if len(ecData) == 0 {
		return "", nil
	}

	ec := &executioncontextv1.ExecutionContext{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "ExecutionContext",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: fmt.Sprintf("exec-ctx-%s", executionID),
			Org:  mcpServer.GetMetadata().GetOrg(),
		},
		Spec: &executioncontextv1.ExecutionContextSpec{
			ExecutionId: executionID,
			Data:        ecData,
		},
	}

	created, err := c.executionCtxClient.Create(ctx, ec)
	if err != nil {
		return "", grpclib.InternalError(err, "failed to create connect ExecutionContext")
	}

	resourceID := created.GetMetadata().GetId()
	log.Info().
		Str("execution_context_id", resourceID).
		Str("execution_id", executionID).
		Int("data_entries", len(ecData)).
		Msg("Created ephemeral ExecutionContext for MCP connect")

	return resourceID, nil
}

// resolveFromPersonalEnvironment reads the required environment variables from
// the user's personal environment (labeled stigmer.ai/personal=true). Returns
// ExecutionValue entries with is_secret derived from the MCP server's env_spec.
func (c *McpServerController) resolveFromPersonalEnvironment(
	ctx context.Context,
	org string,
	envSpec *environmentv1.EnvironmentSpec,
) (map[string]*executioncontextv1.ExecutionValue, error) {
	listResp, err := c.environmentClient.List(ctx, &environmentv1.ListEnvironmentsRequest{
		Org:    org,
		Labels: map[string]string{personalEnvLabel: "true"},
	})
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list personal environments")
	}
	if listResp.GetTotalCount() == 0 || len(listResp.GetItems()) == 0 {
		requiredKeys := make([]string, 0, len(envSpec.GetData()))
		for k := range envSpec.GetData() {
			requiredKeys = append(requiredKeys, k)
		}
		return nil, grpclib.FailedPreconditionError(
			"personal environment not found for org '%s'; save required credentials first: %v", org, requiredKeys,
		)
	}

	personalEnv := listResp.GetItems()[0]
	personalEnvID := personalEnv.GetMetadata().GetId()
	storedKeys := make(map[string]bool)
	for k := range personalEnv.GetSpec().GetData() {
		storedKeys[k] = true
	}

	result := make(map[string]*executioncontextv1.ExecutionValue, len(envSpec.GetData()))
	var missing []string

	for key, envVal := range envSpec.GetData() {
		if !storedKeys[key] {
			missing = append(missing, key)
			continue
		}

		secretVal, err := c.environmentClient.GetSecretValue(ctx, &environmentv1.EnvironmentSecretValueInput{
			EnvironmentId: personalEnvID,
			Key:           key,
		})
		if err != nil {
			log.Warn().Err(err).
				Str("key", key).
				Str("personal_env_id", personalEnvID).
				Msg("Failed to get secret value from personal environment")
			missing = append(missing, key)
			continue
		}
		if secretVal.GetValue() == "" {
			missing = append(missing, key)
			continue
		}

		result[key] = &executioncontextv1.ExecutionValue{
			Value:    secretVal.GetValue(),
			IsSecret: envVal.GetIsSecret(),
		}
	}

	if len(missing) > 0 {
		return nil, grpclib.FailedPreconditionError(
			"missing required credentials in personal environment: %v", missing,
		)
	}

	return result, nil
}

// deleteConnectExecutionContext removes the ephemeral ExecutionContext after
// the connect workflow completes. Failures are logged but not propagated,
// since the result is already stored.
func (c *McpServerController) deleteConnectExecutionContext(
	ctx context.Context,
	resourceID string,
	executionID string,
) {
	if _, err := c.executionCtxClient.Delete(ctx, resourceID); err != nil {
		log.Warn().Err(err).
			Str("resource_id", resourceID).
			Str("execution_id", executionID).
			Msg("Failed to delete connect ExecutionContext (non-fatal)")
		return
	}

	log.Debug().
		Str("resource_id", resourceID).
		Str("execution_id", executionID).
		Msg("Deleted ephemeral connect ExecutionContext")
}

// executeConnectWorkflow starts the Python DiscoverMcpServerWorkflow on
// the runner queue and blocks until it completes or times out.
func (c *McpServerController) executeConnectWorkflow(
	ctx context.Context,
	mcpServerID string,
	input connectWorkflowInput,
) (*connectWorkflowOutput, error) {
	workflowID := fmt.Sprintf("%s/%s/%s", connectWorkflowName, mcpServerID, uuid.New().String()[:8])

	options := client.StartWorkflowOptions{
		ID:                 workflowID,
		TaskQueue:          c.runnerQueue,
		WorkflowRunTimeout: connectTimeout,
	}

	run, err := c.temporalClient.ExecuteWorkflow(ctx, options, connectWorkflowName, input)
	if err != nil {
		log.Error().Err(err).
			Str("workflow_id", workflowID).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to start MCP connect workflow")
		return nil, grpclib.InternalError(err, "failed to start connect workflow")
	}

	log.Info().
		Str("workflow_id", workflowID).
		Str("mcp_server_id", mcpServerID).
		Str("runner_queue", c.runnerQueue).
		Msg("Started MCP connect workflow")

	var result connectWorkflowOutput
	if err := run.Get(ctx, &result); err != nil {
		log.Error().Err(err).
			Str("workflow_id", workflowID).
			Str("mcp_server_id", mcpServerID).
			Msg("MCP connect workflow failed")
		return nil, status.Errorf(codes.DeadlineExceeded,
			"connect did not complete: %v", err,
		)
	}

	return &result, nil
}

// convertToDiscoveredCapabilities converts the Temporal workflow output
// to the proto DiscoveredCapabilities message.
func convertToDiscoveredCapabilities(output *connectWorkflowOutput) *mcpserverv1.DiscoveredCapabilities {
	capabilities := &mcpserverv1.DiscoveredCapabilities{
		LastDiscoveredAt: timestamppb.Now(),
	}

	for _, t := range output.Tools {
		tool := &mcpserverv1.DiscoveredTool{
			Name:        t.Name,
			Description: t.Description,
		}
		if t.InputSchema != nil {
			if s, err := structpb.NewStruct(t.InputSchema); err == nil {
				tool.InputSchema = s
			}
		}
		capabilities.Tools = append(capabilities.Tools, tool)
	}

	for _, rt := range output.ResourceTemplates {
		capabilities.ResourceTemplates = append(capabilities.ResourceTemplates, &mcpserverv1.DiscoveredResourceTemplate{
			UriTemplate: rt.URITemplate,
			Name:        rt.Name,
			Description: rt.Description,
			MimeType:    rt.MimeType,
		})
	}

	return capabilities
}

// StartBestEffortConnect starts the connect workflow asynchronously
// without blocking. Used by the apply handler for auto-discovery on create.
// Failures are logged but do not propagate.
//
// Skips when the MCP server defines an env_spec, because creating an
// ExecutionContext requires the caller's gRPC context (for personal
// environment resolution), which is unavailable in a fire-and-forget
// goroutine. Users must trigger manual connect for these servers.
//
// Uses context.Background() because this runs in a fire-and-forget goroutine
// after the originating gRPC request has already returned.
func (c *McpServerController) StartBestEffortConnect(
	mcpServer *mcpserverv1.McpServer,
) {
	if c.temporalClient == nil {
		return
	}

	envSpec := mcpServer.GetSpec().GetEnvSpec()
	if envSpec != nil && len(envSpec.GetData()) > 0 {
		log.Debug().
			Str("mcp_server_id", mcpServer.GetMetadata().GetId()).
			Int("env_spec_keys", len(envSpec.GetData())).
			Msg("Skipping best-effort auto-connect: MCP server has env_spec (requires manual connect)")
		return
	}

	mcpServerID := mcpServer.GetMetadata().GetId()

	wfInput := connectWorkflowInput{
		McpServerID: mcpServerID,
	}

	workflowID := fmt.Sprintf("%s/%s/%s", connectWorkflowName, mcpServerID, uuid.New().String()[:8])

	options := client.StartWorkflowOptions{
		ID:                 workflowID,
		TaskQueue:          c.runnerQueue,
		WorkflowRunTimeout: connectTimeout,
	}

	_, err := c.temporalClient.ExecuteWorkflow(context.Background(), options, connectWorkflowName, wfInput)
	if err != nil {
		log.Warn().Err(err).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to start best-effort connect workflow (non-fatal)")
		return
	}

	log.Info().
		Str("workflow_id", workflowID).
		Str("mcp_server_id", mcpServerID).
		Msg("Started best-effort auto-connect workflow (fire-and-forget)")
}
