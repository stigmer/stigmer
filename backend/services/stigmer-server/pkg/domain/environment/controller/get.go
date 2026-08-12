package environment

import (
	"context"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	envsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
)

// Get retrieves an environment by ID using the pipeline framework
//
// This implements the standard Get operation pattern:
// 1. ValidateProto - Validate input ApiResourceId (ensures value is not empty)
// 2. LoadTarget - Load environment from repository by ID
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// - ValidateProto: Validates buf.validate constraints on ApiResourceId
// - LoadTarget: Loads environment from SQLite by ID, returns NotFound if missing
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - ExtractResourceId step (not needed - ID is already in ApiResourceId.value)
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// The loaded environment is stored in context with key "targetResource" and
// returned by the handler with secret values redacted (both editions redact
// on read since oss#405 — getSecretValue is the reveal path).
func (c *EnvironmentController) Get(ctx context.Context, id *apiresource.ApiResourceId) (*environmentv1.Environment, error) {
	reqCtx := pipeline.NewRequestContext(ctx, id)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded environment from context
	environment := reqCtx.Get(steps.TargetResourceKey).(*environmentv1.Environment)
	envsteps.RedactEnvironmentSecrets(environment)
	return environment, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations
//
// This pipeline is generic and reusable across all resources.
// It uses standard steps from the pipeline/steps package.
func (c *EnvironmentController) buildGetPipeline() *pipeline.Pipeline[*apiresource.ApiResourceId] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*apiresource.ApiResourceId]("environment-get").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceId]()).                                 // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*apiresource.ApiResourceId, *environmentv1.Environment](c.store)). // 2. Load by ID
		Build()
}
