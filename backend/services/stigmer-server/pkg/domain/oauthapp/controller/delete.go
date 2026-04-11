package oauthapp

import (
	"context"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	oauthsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/oauthapp/controller/steps"
)

// Delete deletes an OAuthApp by ID using the pipeline pattern.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ApiResourceDeleteInput)
//  2. LoadExistingForDelete - Load OAuthApp from database (stores in context)
//  3. CheckNoReferencingMcpServers - Block deletion if any McpServer references this OAuthApp
//  4. DeleteResource - Delete OAuthApp from database
//
// Referential integrity: deletion is blocked with FAILED_PRECONDITION if any
// McpServer resource references this OAuthApp via spec.auth.oauth_app_ref.
// The referencing MCP servers must be updated or deleted first.
//
// Note: Unlike Stigmer Cloud, OSS excludes:
//   - Authorization step (no multi-user auth)
//   - IAM policy cleanup (no IAM system)
//   - Event publishing (no event system)
//   - DeleteSearchIndex (OAuthApp is not search-indexed)
//
// The deleted OAuthApp is returned for audit trail purposes (gRPC convention).
func (c *OAuthAppController) Delete(ctx context.Context, input *apiresource.ApiResourceDeleteInput) (*oauthappv1.OAuthApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Manually extract and store resource ID since ApiResourceDeleteInput uses
	// ResourceId field instead of Value field (which ExtractResourceIdStep expects)
	reqCtx.Set(steps.ResourceIdKey, input.ResourceId)

	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	deletedApp := reqCtx.Get(steps.ExistingResourceKey)
	if deletedApp == nil {
		return nil, grpclib.InternalError(nil, "deleted OAuthApp not found in context")
	}

	return deletedApp.(*oauthappv1.OAuthApp), nil
}

// buildDeletePipeline constructs the pipeline for delete operations.
//
// ExtractResourceIdStep is NOT used here because ApiResourceDeleteInput
// has ResourceId field (not Value), so we manually extract it in Delete method.
//
// CheckNoReferencingMcpServers runs after LoadExistingForDelete so it can
// read the OAuthApp's org and slug for the referential integrity check.
func (c *OAuthAppController) buildDeletePipeline() *pipeline.Pipeline[*apiresource.ApiResourceDeleteInput] {
	return pipeline.NewPipeline[*apiresource.ApiResourceDeleteInput]("oauthapp-delete").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceDeleteInput]()).                                      // 1. Validate field constraints
		AddStep(steps.NewLoadExistingForDeleteStep[*apiresource.ApiResourceDeleteInput, *oauthappv1.OAuthApp](c.store)). // 2. Load OAuthApp
		AddStep(oauthsteps.NewCheckNoReferencingMcpServersStep(c.store)).                                                // 3. Referential integrity check
		AddStep(steps.NewDeleteResourceStep[*apiresource.ApiResourceDeleteInput](c.store)).                              // 4. Delete from database
		Build()
}
