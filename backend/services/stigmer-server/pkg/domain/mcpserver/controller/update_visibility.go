package mcpserver

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// UpdateVisibility updates the visibility of an existing MCP server.
//
// This is a targeted metadata update — it only modifies metadata.visibility,
// leaving spec, status, and other metadata fields untouched.
func (c *McpServerController) UpdateVisibility(
	ctx context.Context,
	input *apiresourcepb.UpdateVisibilityInput,
) (*mcpserverv1.McpServer, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildUpdateVisibilityPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	mcpServer := reqCtx.Get(updateVisibilityMcpServerKey).(*mcpserverv1.McpServer)
	return mcpServer, nil
}

const updateVisibilityMcpServerKey = "updateVisibilityMcpServer"

func (c *McpServerController) buildUpdateVisibilityPipeline() *pipeline.Pipeline[*apiresourcepb.UpdateVisibilityInput] {
	return pipeline.NewPipeline[*apiresourcepb.UpdateVisibilityInput]("mcpserver-update-visibility").
		AddStep(steps.NewValidateProtoStep[*apiresourcepb.UpdateVisibilityInput]()).
		AddStep(c.newLoadMcpServerForVisibilityUpdateStep()).
		AddStep(steps.NewValidateVisibilityUpdateStep()). // Reject unsupported levels (after load: NOT_FOUND wins, as in Cloud)
		AddStep(c.newSetMcpServerVisibilityStep()).
		AddStep(c.newPersistMcpServerForVisibilityUpdateStep()).
		AddStep(c.newIndexMcpServerAfterVisibilityUpdateStep()).
		Build()
}

// loadMcpServerForVisibilityUpdateStep loads the MCP server by resource_id.
type loadMcpServerForVisibilityUpdateStep struct {
	store store.Store
}

func (c *McpServerController) newLoadMcpServerForVisibilityUpdateStep() *loadMcpServerForVisibilityUpdateStep {
	return &loadMcpServerForVisibilityUpdateStep{store: c.store}
}

func (s *loadMcpServerForVisibilityUpdateStep) Name() string {
	return "LoadMcpServerForVisibilityUpdate"
}

func (s *loadMcpServerForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()

	mcpServer := &mcpserverv1.McpServer{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_mcp_server, input.GetResourceId(), mcpServer)
	if err != nil {
		return grpclib.NotFoundError("mcp_server", input.GetResourceId())
	}

	ctx.Set(updateVisibilityMcpServerKey, mcpServer)
	return nil
}

// setMcpServerVisibilityStep sets metadata.visibility and updates audit fields.
type setMcpServerVisibilityStep struct{}

func (c *McpServerController) newSetMcpServerVisibilityStep() *setMcpServerVisibilityStep {
	return &setMcpServerVisibilityStep{}
}

func (s *setMcpServerVisibilityStep) Name() string {
	return "SetMcpServerVisibility"
}

func (s *setMcpServerVisibilityStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()
	mcpServer := ctx.Get(updateVisibilityMcpServerKey).(*mcpserverv1.McpServer)

	mcpServer.Metadata.Visibility = input.GetVisibility()

	if err := steps.SetAuditFieldsForUpdate(mcpServer, steps.StatusAudit); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(updateVisibilityMcpServerKey, mcpServer)
	return nil
}

// persistMcpServerForVisibilityUpdateStep saves the updated MCP server.
type persistMcpServerForVisibilityUpdateStep struct {
	store store.Store
}

func (c *McpServerController) newPersistMcpServerForVisibilityUpdateStep() *persistMcpServerForVisibilityUpdateStep {
	return &persistMcpServerForVisibilityUpdateStep{store: c.store}
}

func (s *persistMcpServerForVisibilityUpdateStep) Name() string {
	return "PersistMcpServerForVisibilityUpdate"
}

func (s *persistMcpServerForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	mcpServer := ctx.Get(updateVisibilityMcpServerKey).(*mcpserverv1.McpServer)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_mcp_server, mcpServer.GetMetadata().GetId(), mcpServer)
	if err != nil {
		return grpclib.InternalError(err, "failed to save mcp server")
	}

	return nil
}

// indexMcpServerAfterVisibilityUpdateStep updates the search index.
type indexMcpServerAfterVisibilityUpdateStep struct {
	store store.Store
}

func (c *McpServerController) newIndexMcpServerAfterVisibilityUpdateStep() *indexMcpServerAfterVisibilityUpdateStep {
	return &indexMcpServerAfterVisibilityUpdateStep{store: c.store}
}

func (s *indexMcpServerAfterVisibilityUpdateStep) Name() string {
	return "IndexMcpServerAfterVisibilityUpdate"
}

func (s *indexMcpServerAfterVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	mcpServer := ctx.Get(updateVisibilityMcpServerKey).(*mcpserverv1.McpServer)

	ext := &extractor.McpServerExtractor{}
	entry := ext.GetSearchIndexEntry(mcpServer)
	if entry == nil {
		log.Warn().Str("id", mcpServer.Metadata.Id).Msg("IndexMcpServerAfterVisibilityUpdate: extractor returned nil, skipping")
		return nil
	}

	if err := s.store.UpsertSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_mcp_server, mcpServer.Metadata.Id, entry); err != nil {
		log.Warn().Err(err).Str("id", mcpServer.Metadata.Id).Msg("IndexMcpServerAfterVisibilityUpdate: failed (best-effort)")
	}

	return nil
}
