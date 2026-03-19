package environment

import (
	"context"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	envsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
)

// GetSecretValue retrieves a single unredacted secret value from an environment.
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate input EnvironmentSecretValueInput (environment_id, key)
// 2. LoadEnvironmentByID - Load environment from store by environment_id
// 3. ExtractAndDecryptSingleKey - Find the requested key, decrypt if secret
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - FGA can_read_secrets check (creator-only in Cloud)
//
// Single-key retrieval by design: limits blast radius if intercepted,
// enables per-key audit trails, and matches the industry-standard
// "reveal" UX pattern (AWS, GitHub, 1Password).
func (c *EnvironmentController) GetSecretValue(ctx context.Context, input *environmentv1.EnvironmentSecretValueInput) (*environmentv1.EnvironmentValue, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildGetSecretValuePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	value := reqCtx.Get(envsteps.SecretValueKey).(*environmentv1.EnvironmentValue)
	return value, nil
}

// buildGetSecretValuePipeline constructs the pipeline for single-key secret retrieval.
func (c *EnvironmentController) buildGetSecretValuePipeline() *pipeline.Pipeline[*environmentv1.EnvironmentSecretValueInput] {
	return pipeline.NewPipeline[*environmentv1.EnvironmentSecretValueInput]("environment-get-secret-value").
		AddStep(steps.NewValidateProtoStep[*environmentv1.EnvironmentSecretValueInput]()).
		AddStep(envsteps.NewLoadEnvironmentByIDStep(c.store)).
		AddStep(envsteps.NewExtractAndDecryptSingleKeyStep(c.secretService)).
		Build()
}
