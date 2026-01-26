package mcpserver

import (
	"context"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes an MCP server by ID using the pipeline pattern.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ApiResourceDeleteInput)
//  2. LoadExistingForDelete - Load MCP server from database (stores in context)
//  3. DeleteResource - Delete MCP server from database
//
// Note: Unlike Stigmer Cloud, OSS excludes:
//   - Authorization step (no multi-user auth)
//   - IAM policy cleanup (no IAM system)
//   - Event publishing (no event system)
//
// The deleted MCP server is returned for audit trail purposes (gRPC convention).
func (c *McpServerController) Delete(ctx context.Context, input *apiresource.ApiResourceDeleteInput) (*mcpserverv1.McpServer, error) {
	// Create request context with the delete input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Manually extract and store resource ID since ApiResourceDeleteInput uses
	// ResourceId field instead of Value field (which ExtractResourceIdStep expects)
	reqCtx.Set(steps.ResourceIdKey, input.ResourceId)

	// Build and execute pipeline
	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get deleted MCP server from context (set by LoadExistingForDelete step before deletion)
	deletedMcpServer := reqCtx.Get(steps.ExistingResourceKey)
	if deletedMcpServer == nil {
		return nil, grpclib.InternalError(nil, "deleted mcp server not found in context")
	}

	return deletedMcpServer.(*mcpserverv1.McpServer), nil
}

// buildDeletePipeline constructs the pipeline for delete operations.
//
// Note: ExtractResourceIdStep is NOT used here because ApiResourceDeleteInput
// has ResourceId field (not Value), so we manually extract it in Delete method.
func (c *McpServerController) buildDeletePipeline() *pipeline.Pipeline[*apiresource.ApiResourceDeleteInput] {
	return pipeline.NewPipeline[*apiresource.ApiResourceDeleteInput]("mcpserver-delete").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceDeleteInput]()).                                        // 1. Validate field constraints
		AddStep(steps.NewLoadExistingForDeleteStep[*apiresource.ApiResourceDeleteInput, *mcpserverv1.McpServer](c.store)). // 2. Load MCP server
		AddStep(steps.NewDeleteResourceStep[*apiresource.ApiResourceDeleteInput](c.store)).                                // 3. Delete from database
		Build()
}
