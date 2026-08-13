package mcpserver

import (
	"context"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// GetByReference retrieves an MCP server by ApiResourceReference (slug-based lookup)
// using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate input ApiResourceReference
//  2. LoadByReference - Load MCP server by slug (with optional org filtering)
//  3. EnrichOAuthStatus - Populate response-only status.oauth_status from the
//     referenced OAuthApp (cloud parity, stigmer/stigmer#523)
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - TransformResponse step (no response transformations in OSS)
//
// Reference Lookup Logic (OSS):
//   - If ref.org is provided: queries MCP servers in that org with matching slug
//   - If ref.org is empty: queries identity-scoped MCP servers with matching slug
//   - Slug is matched against metadata.name (slug is normalized name)
//
// Note: In OSS, there is no tri-scope support (platform, org, identity_account)
// as implemented in the cloud version. All resources are effectively local.
//
// The loaded MCP server is stored in context with key "targetResource" and
// returned by the handler.
func (c *McpServerController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*mcpserverv1.McpServer, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded MCP server from context
	mcpServer := reqCtx.Get(steps.TargetResourceKey).(*mcpserverv1.McpServer)
	return mcpServer, nil
}

// buildGetByReferencePipeline constructs the pipeline for get-by-reference operations.
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *McpServerController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("mcpserver-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).      // 1. Validate input
		AddStep(steps.NewLoadByReferenceStep[*mcpserverv1.McpServer](c.store)).        // 2. Load by slug
		AddStep(newEnrichOAuthStatusStep[*apiresource.ApiResourceReference](c.store)). // 3. Enrich oauth_status
		Build()
}
