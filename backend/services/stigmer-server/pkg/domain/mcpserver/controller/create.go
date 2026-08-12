package mcpserver

import (
	"context"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Create creates a new MCP server resource using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (buf.validate)
//     - server_type oneof must have exactly one field set (stdio, http, or docker)
//     - stdio.command is required
//     - http.url must be a valid URI
//     - docker.image is required with min length 1
//  2. ResolveSlug - Generate slug from metadata.name
//  3. CheckDuplicate - Verify no duplicate exists by slug
//  4. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event), default visibility
//  5. Persist - Save MCP server to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - CreateIamPolicies step (no IAM/FGA in OSS)
//   - Publish step (no event publishing in OSS)
//   - TransformResponse step (no response transformations in OSS)
//
// The proto validation (step 1) ensures exactly one server type is configured,
// which is enforced by the buf.validate oneof constraint in spec.proto.
func (c *McpServerController) Create(ctx context.Context, mcpServer *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	reqCtx := pipeline.NewRequestContext(ctx, mcpServer)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for MCP server creation.
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *McpServerController) buildCreatePipeline() *pipeline.Pipeline[*mcpserverv1.McpServer] {
	return pipeline.NewPipeline[*mcpserverv1.McpServer]("mcpserver-create").
		AddStep(steps.NewValidateProtoStep[*mcpserverv1.McpServer]()).                                       // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*mcpserverv1.McpServer]()).                                         // 2. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*mcpserverv1.McpServer](c.store)).                               // 3. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*mcpserverv1.McpServer]()).                                       // 4. Build new state
		AddStep(steps.NewNormalizeReferencesStep[*mcpserverv1.McpServer]()).                                 // 5. Normalize cross-references
		AddStep(steps.NewPersistStep[*mcpserverv1.McpServer](c.store)).                                      // 6. Persist MCP server
		AddStep(steps.NewIndexSearchStep[*mcpserverv1.McpServer](c.store, &extractor.McpServerExtractor{})). // 6. Update search index
		Build()
}
