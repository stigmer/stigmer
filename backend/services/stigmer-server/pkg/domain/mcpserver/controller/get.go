package mcpserver

import (
	"context"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves an MCP server by ID using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate input ApiResourceId (ensures value is not empty)
//  2. LoadTarget - Load MCP server from repository by ID, returns NotFound if missing
//  3. EnrichOAuthStatus - Populate response-only status.oauth_status from the
//     referenced OAuthApp (cloud parity, stigmer/stigmer#523)
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - TransformResponse step (no response transformations in OSS)
//
// The loaded MCP server is stored in context with key "targetResource" and
// returned by the handler.
func (c *McpServerController) Get(ctx context.Context, id *apiresource.ApiResourceId) (*mcpserverv1.McpServer, error) {
	reqCtx := pipeline.NewRequestContext(ctx, id)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded MCP server from context
	mcpServer := reqCtx.Get(steps.TargetResourceKey).(*mcpserverv1.McpServer)
	return mcpServer, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations.
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *McpServerController) buildGetPipeline() *pipeline.Pipeline[*apiresource.ApiResourceId] {
	return pipeline.NewPipeline[*apiresource.ApiResourceId]("mcpserver-get").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceId]()).                             // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*apiresource.ApiResourceId, *mcpserverv1.McpServer](c.store)). // 2. Load by ID
		AddStep(newEnrichOAuthStatusStep[*apiresource.ApiResourceId](c.store)).                        // 3. Enrich oauth_status
		Build()
}
