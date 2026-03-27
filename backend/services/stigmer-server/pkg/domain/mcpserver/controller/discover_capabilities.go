package mcpserver

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"go.temporal.io/sdk/client"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	discoverWorkflowName = "stigmer/mcp-server/discover"
	personalEnvLabel     = "stigmer.ai/personal"
	discoverTimeout      = 45 * time.Second
)

// discoverWorkflowInput matches the Python DiscoverMcpServerInput dataclass.
type discoverWorkflowInput struct {
	McpServerID              string            `json:"mcp_server_id"`
	EnvVars                  map[string]string `json:"env_vars"`
	InvokerIdentityAccountID string            `json:"invoker_identity_account_id,omitempty"`
}

// discoverWorkflowOutput matches the Python DiscoverMcpServerOutput dataclass.
type discoverWorkflowOutput struct {
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

// DiscoverCapabilities triggers server-side MCP discovery via a Temporal workflow
// on the agent-runner. The handler resolves credentials from the user's personal
// environment, starts the workflow, blocks until it completes, and stores the result.
func (c *McpServerController) DiscoverCapabilities(
	ctx context.Context,
	input *mcpserverv1.DiscoverCapabilitiesInput,
) (*mcpserverv1.McpServer, error) {
	if c.temporalClient == nil || c.envClient == nil {
		return nil, grpclib.FailedPreconditionError(
			"server-side discovery is not available: Temporal or environment service not configured",
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

	envVars, err := c.resolveEnvVars(ctx, mcpServer)
	if err != nil {
		return nil, err
	}

	wfInput := discoverWorkflowInput{
		McpServerID: mcpServerID,
		EnvVars:     envVars,
	}

	result, err := c.executeDiscoverWorkflow(ctx, mcpServerID, wfInput)
	if err != nil {
		return nil, err
	}

	capabilities := convertToDiscoveredCapabilities(result)
	if mcpServer.Status == nil {
		mcpServer.Status = &mcpserverv1.McpServerStatus{}
	}
	mcpServer.Status.DiscoveredCapabilities = capabilities

	if err := c.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, mcpServerID, mcpServer); err != nil {
		return nil, grpclib.InternalError(err, "failed to save mcp server after discovery")
	}

	log.Info().
		Str("mcp_server_id", mcpServerID).
		Int("tools", len(capabilities.GetTools())).
		Int("resource_templates", len(capabilities.GetResourceTemplates())).
		Msg("MCP server discovery completed and stored")

	return mcpServer, nil
}

// resolveEnvVars reads the personal environment and extracts the env vars
// required by the MCP server's env_spec. Returns an empty map if no env_spec
// is defined. Returns FAILED_PRECONDITION if required vars are missing.
func (c *McpServerController) resolveEnvVars(
	ctx context.Context,
	mcpServer *mcpserverv1.McpServer,
) (map[string]string, error) {
	envSpec := mcpServer.GetSpec().GetEnvSpec()
	if envSpec == nil || len(envSpec.GetData()) == 0 {
		return map[string]string{}, nil
	}

	listResp, err := c.envClient.List(ctx, &environmentv1.ListEnvironmentsRequest{
		Org:    mcpServer.GetMetadata().GetOrg(),
		Labels: map[string]string{personalEnvLabel: "true"},
	})
	if err != nil {
		log.Warn().Err(err).Msg("Failed to list personal environments for discovery")
		return map[string]string{}, nil
	}

	if listResp.GetTotalCount() == 0 || len(listResp.GetItems()) == 0 {
		requiredKeys := make([]string, 0, len(envSpec.GetData()))
		for k := range envSpec.GetData() {
			requiredKeys = append(requiredKeys, k)
		}
		return nil, grpclib.FailedPreconditionError(
			fmt.Sprintf("personal environment not found; required env vars: %v", requiredKeys),
		)
	}

	personalEnv := listResp.GetItems()[0]
	personalEnvID := personalEnv.GetMetadata().GetId()
	result := make(map[string]string)
	var missing []string

	for key := range envSpec.GetData() {
		storedData := personalEnv.GetSpec().GetData()
		if storedData == nil {
			missing = append(missing, key)
			continue
		}
		if _, exists := storedData[key]; !exists {
			missing = append(missing, key)
			continue
		}

		val, err := c.envClient.GetSecretValue(ctx, &environmentv1.EnvironmentSecretValueInput{
			EnvironmentId: personalEnvID,
			Key:           key,
		})
		if err != nil {
			log.Warn().Err(err).Str("key", key).Msg("Failed to get secret value for discovery")
			missing = append(missing, key)
			continue
		}
		if val.GetValue() != "" {
			result[key] = val.GetValue()
		} else {
			missing = append(missing, key)
		}
	}

	if len(missing) > 0 {
		return nil, grpclib.FailedPreconditionError(
			fmt.Sprintf("missing required credentials in personal environment: %v", missing),
		)
	}

	return result, nil
}

// executeDiscoverWorkflow starts the Python DiscoverMcpServerWorkflow on
// the runner queue and blocks until it completes or times out.
func (c *McpServerController) executeDiscoverWorkflow(
	ctx context.Context,
	mcpServerID string,
	input discoverWorkflowInput,
) (*discoverWorkflowOutput, error) {
	workflowID := fmt.Sprintf("%s/%s/%s", discoverWorkflowName, mcpServerID, uuid.New().String()[:8])

	options := client.StartWorkflowOptions{
		ID:                 workflowID,
		TaskQueue:          c.runnerQueue,
		WorkflowRunTimeout: discoverTimeout,
	}

	run, err := c.temporalClient.ExecuteWorkflow(ctx, options, discoverWorkflowName, input)
	if err != nil {
		log.Error().Err(err).
			Str("workflow_id", workflowID).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to start MCP discovery workflow")
		return nil, grpclib.InternalError(err, "failed to start discovery workflow")
	}

	log.Info().
		Str("workflow_id", workflowID).
		Str("mcp_server_id", mcpServerID).
		Str("runner_queue", c.runnerQueue).
		Msg("Started MCP discovery workflow")

	var result discoverWorkflowOutput
	if err := run.Get(ctx, &result); err != nil {
		log.Error().Err(err).
			Str("workflow_id", workflowID).
			Str("mcp_server_id", mcpServerID).
			Msg("MCP discovery workflow failed")
		return nil, status.Errorf(codes.DeadlineExceeded,
			"discovery did not complete: %v", err,
		)
	}

	return &result, nil
}

// convertToDiscoveredCapabilities converts the Temporal workflow output
// to the proto DiscoveredCapabilities message.
func convertToDiscoveredCapabilities(output *discoverWorkflowOutput) *mcpserverv1.DiscoveredCapabilities {
	capabilities := &mcpserverv1.DiscoveredCapabilities{
		LastDiscoveredAt: timestamppb.Now(),
		DiscoveredBy:     mcpserverv1.DiscoverySource_api,
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

// StartBestEffortDiscovery starts the discovery workflow asynchronously
// without blocking. Used by the apply handler for auto-discovery.
// Failures are logged but do not propagate.
func (c *McpServerController) StartBestEffortDiscovery(
	ctx context.Context,
	mcpServer *mcpserverv1.McpServer,
) {
	if c.temporalClient == nil || c.envClient == nil {
		return
	}

	mcpServerID := mcpServer.GetMetadata().GetId()

	envVars, err := c.resolveEnvVars(ctx, mcpServer)
	if err != nil {
		log.Debug().
			Err(err).
			Str("mcp_server_id", mcpServerID).
			Msg("Skipping best-effort discovery: credentials not available")
		return
	}

	wfInput := discoverWorkflowInput{
		McpServerID: mcpServerID,
		EnvVars:     envVars,
	}

	workflowID := fmt.Sprintf("%s/%s/%s", discoverWorkflowName, mcpServerID, uuid.New().String()[:8])

	options := client.StartWorkflowOptions{
		ID:                 workflowID,
		TaskQueue:          c.runnerQueue,
		WorkflowRunTimeout: discoverTimeout,
	}

	_, err = c.temporalClient.ExecuteWorkflow(ctx, options, discoverWorkflowName, wfInput)
	if err != nil {
		log.Warn().Err(err).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to start best-effort discovery workflow (non-fatal)")
		return
	}

	log.Info().
		Str("workflow_id", workflowID).
		Str("mcp_server_id", mcpServerID).
		Msg("Started best-effort auto-discovery workflow (fire-and-forget)")
}
