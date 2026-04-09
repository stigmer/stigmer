package mcpserver

import (
	"context"

	"github.com/rs/zerolog/log"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates an MCP server based on whether it already exists.
//
// This implements declarative "apply" semantics (similar to kubectl apply):
//   - Checks if resource exists by slug
//   - If exists → delegates to Update()
//   - If not exists → delegates to Create()
//
// Pipeline (minimal - just for existence check):
//  1. ValidateProto - Validate field constraints
//  2. ResolveSlug - Generate slug from metadata.name
//  3. LoadForApply - Attempt to load existing (doesn't fail if not found)
//  4. Delegate decision based on context flags
//
// The heavy lifting (validation, persistence, etc.) is handled by
// the delegated Create or Update handlers.
//
// Apply is the recommended method for CLI usage as it provides idempotent
// behavior - the same configuration can be applied multiple times with
// consistent results.
func (c *McpServerController) Apply(ctx context.Context, mcpServer *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	reqCtx := pipeline.NewRequestContext(ctx, mcpServer)

	// Build and execute minimal apply pipeline
	p := c.buildApplyPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Check shouldCreate flag set by LoadForApplyStep
	shouldCreateVal := reqCtx.Get(steps.ShouldCreateKey)
	if shouldCreateVal == nil {
		log.Error().Msg("Apply pipeline did not set shouldCreate flag")
		return nil, grpclib.InternalError(nil, "apply operation failed to determine create vs update")
	}

	shouldCreate := shouldCreateVal.(bool)

	// Delegate to appropriate handler
	var result *mcpserverv1.McpServer
	var applyErr error

	if shouldCreate {
		log.Info().
			Str("slug", mcpServer.GetMetadata().GetName()).
			Msg("Resource does not exist - delegating to CREATE")
		result, applyErr = c.Create(ctx, mcpServer)
	} else {
		log.Info().
			Str("slug", mcpServer.GetMetadata().GetName()).
			Str("id", mcpServer.GetMetadata().GetId()).
			Msg("Resource exists - delegating to UPDATE")
		result, applyErr = c.Update(ctx, mcpServer)
	}

	if applyErr != nil {
		return nil, applyErr
	}

	// Fire-and-forget best-effort connect after successful apply.
	// Triggers server-side discovery and tool approval classification via
	// the agent-runner Temporal workflow. Uses context.Background()
	// internally since the originating gRPC ctx will be cancelled once
	// Apply returns.
	go c.StartBestEffortConnect(result)

	return result, nil
}

// buildApplyPipeline constructs the minimal pipeline for apply operations.
//
// This pipeline only determines whether to create or update.
// It does NOT perform the actual create/update - that's delegated.
func (c *McpServerController) buildApplyPipeline() *pipeline.Pipeline[*mcpserverv1.McpServer] {
	return pipeline.NewPipeline[*mcpserverv1.McpServer]("mcpserver-apply").
		AddStep(steps.NewValidateProtoStep[*mcpserverv1.McpServer]()).       // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*mcpserverv1.McpServer]()).         // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*mcpserverv1.McpServer](c.store)). // 3. Check existence
		Build()
}
