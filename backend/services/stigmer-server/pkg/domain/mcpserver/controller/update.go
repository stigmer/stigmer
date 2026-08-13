package mcpserver

import (
	"context"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Update updates an existing MCP server resource using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (buf.validate)
//     - server_type oneof must have exactly one field set (stdio, http, or docker)
//     - stdio.command is required
//     - http.url must be a valid URI
//     - docker.image is required with min length 1
//  2. ResolveSlug - Generate slug from metadata.name
//  3. LoadExisting - Load existing MCP server from repository by ID
//  4. BuildUpdateState - Merge spec, preserve IDs, update timestamps, clear computed fields
//     4b. ValidateDefaultEnabledTools - default_enabled_tools must name discovered tools
//     (validates against the OWN status BuildUpdateState just carried over;
//     skips servers never connected — create has no status, so only update wires this)
//  5. Persist - Save updated MCP server to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - Publish step (no event publishing in OSS)
//   - TransformResponse step (no response transformations in OSS)
func (c *McpServerController) Update(ctx context.Context, mcpServer *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	reqCtx := pipeline.NewRequestContext(ctx, mcpServer)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for MCP server update.
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *McpServerController) buildUpdatePipeline() *pipeline.Pipeline[*mcpserverv1.McpServer] {
	return pipeline.NewPipeline[*mcpserverv1.McpServer]("mcpserver-update").
		AddStep(steps.NewValidateProtoStep[*mcpserverv1.McpServer]()).                                       // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*mcpserverv1.McpServer]()).                                         // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*mcpserverv1.McpServer](c.store)).                                 // 3. Load existing MCP server
		AddStep(steps.NewBuildUpdateStateStep[*mcpserverv1.McpServer]()).                                    // 4. Build updated state
		AddStep(newValidateDefaultEnabledToolsStep()).                                                       // 4b. Validate default_enabled_tools against own capabilities
		AddStep(steps.NewNormalizeReferencesStep[*mcpserverv1.McpServer]()).                                 // 5. Normalize cross-references
		AddStep(steps.NewPersistStep[*mcpserverv1.McpServer](c.store)).                                      // 6. Persist MCP server
		AddStep(steps.NewIndexSearchStep[*mcpserverv1.McpServer](c.store, &extractor.McpServerExtractor{})). // 6. Update search index
		Build()
}
