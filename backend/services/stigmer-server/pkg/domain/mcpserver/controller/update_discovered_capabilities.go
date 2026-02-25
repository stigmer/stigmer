package mcpserver

import (
	"context"
	"fmt"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

const mcpServerKey = "mcpServer"

// UpdateDiscoveredCapabilities updates the discovered tools and resource
// templates for an MCP server. This is a targeted status update — it only
// modifies status.discovered_capabilities, leaving spec, validation state,
// and other status fields untouched.
func (c *McpServerController) UpdateDiscoveredCapabilities(
	ctx context.Context,
	input *mcpserverv1.UpdateDiscoveredCapabilitiesInput,
) (*mcpserverv1.McpServer, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildUpdateDiscoveredCapabilitiesPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	mcpServer := reqCtx.Get(mcpServerKey).(*mcpserverv1.McpServer)
	return mcpServer, nil
}

func (c *McpServerController) buildUpdateDiscoveredCapabilitiesPipeline() *pipeline.Pipeline[*mcpserverv1.UpdateDiscoveredCapabilitiesInput] {
	return pipeline.NewPipeline[*mcpserverv1.UpdateDiscoveredCapabilitiesInput]("mcpserver-update-discovered-capabilities").
		AddStep(steps.NewValidateProtoStep[*mcpserverv1.UpdateDiscoveredCapabilitiesInput]()).
		AddStep(c.newLoadMcpServerByIdStep()).
		AddStep(c.newSetDiscoveredCapabilitiesStep()).
		AddStep(c.newPersistMcpServerStep()).
		Build()
}

// loadMcpServerByIdStep loads the MCP server from the store using
// input.mcp_server_id. Unlike LoadTargetStep, this works with
// UpdateDiscoveredCapabilitiesInput which uses mcp_server_id instead
// of the standard value field.
type loadMcpServerByIdStep struct {
	store store.Store
}

func (c *McpServerController) newLoadMcpServerByIdStep() *loadMcpServerByIdStep {
	return &loadMcpServerByIdStep{store: c.store}
}

func (s *loadMcpServerByIdStep) Name() string {
	return "LoadMcpServerById"
}

func (s *loadMcpServerByIdStep) Execute(ctx *pipeline.RequestContext[*mcpserverv1.UpdateDiscoveredCapabilitiesInput]) error {
	input := ctx.Input()

	mcpServer := &mcpserverv1.McpServer{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_mcp_server, input.GetMcpServerId(), mcpServer)
	if err != nil {
		return grpclib.NotFoundError("mcp_server", input.GetMcpServerId())
	}

	ctx.Set(mcpServerKey, mcpServer)
	return nil
}

// setDiscoveredCapabilitiesStep applies the incoming discovered capabilities
// onto the loaded MCP server's status and updates audit fields.
type setDiscoveredCapabilitiesStep struct{}

func (c *McpServerController) newSetDiscoveredCapabilitiesStep() *setDiscoveredCapabilitiesStep {
	return &setDiscoveredCapabilitiesStep{}
}

func (s *setDiscoveredCapabilitiesStep) Name() string {
	return "SetDiscoveredCapabilities"
}

func (s *setDiscoveredCapabilitiesStep) Execute(ctx *pipeline.RequestContext[*mcpserverv1.UpdateDiscoveredCapabilitiesInput]) error {
	input := ctx.Input()
	mcpServer := ctx.Get(mcpServerKey).(*mcpserverv1.McpServer)

	if mcpServer.Status == nil {
		mcpServer.Status = &mcpserverv1.McpServerStatus{}
	}

	mcpServer.Status.DiscoveredCapabilities = input.GetDiscoveredCapabilities()

	if err := steps.SetAuditFieldsForUpdate(mcpServer); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(mcpServerKey, mcpServer)
	return nil
}

// persistMcpServerStep saves the updated MCP server back to the store.
// Unlike PersistStep, this reads from a context key rather than NewState().
type persistMcpServerStep struct {
	store store.Store
}

func (c *McpServerController) newPersistMcpServerStep() *persistMcpServerStep {
	return &persistMcpServerStep{store: c.store}
}

func (s *persistMcpServerStep) Name() string {
	return "PersistMcpServer"
}

func (s *persistMcpServerStep) Execute(ctx *pipeline.RequestContext[*mcpserverv1.UpdateDiscoveredCapabilitiesInput]) error {
	mcpServer := ctx.Get(mcpServerKey).(*mcpserverv1.McpServer)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_mcp_server, mcpServer.GetMetadata().GetId(), mcpServer)
	if err != nil {
		return grpclib.InternalError(err, "failed to save mcp server")
	}

	return nil
}
