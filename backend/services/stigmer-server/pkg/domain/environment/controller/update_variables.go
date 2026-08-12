package environment

import (
	"context"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	envsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
)

// UpdateVariables adds or updates specific variables in an environment using
// a server-side merge. Existing variables not included in the request are
// preserved. This avoids the read-modify-write secret destruction problem
// inherent in the full-resource Update RPC.
//
// Pipeline:
//  1. ValidateProto    — validate environment_id and variables via buf constraints
//  2. LoadByEnvID      — load the existing environment from store
//  3. MergeAndPersist  — merge request variables into spec.data (encrypting
//     is_secret values), update audit, persist
func (c *EnvironmentController) UpdateVariables(ctx context.Context, req *environmentv1.UpdateEnvironmentVariablesRequest) (*environmentv1.Environment, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildUpdateVariablesPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	updated := reqCtx.Get(envsteps.UpdatedEnvironmentKey).(*environmentv1.Environment)
	envsteps.RedactEnvironmentSecrets(updated)
	return updated, nil
}

func (c *EnvironmentController) buildUpdateVariablesPipeline() *pipeline.Pipeline[*environmentv1.UpdateEnvironmentVariablesRequest] {
	return pipeline.NewPipeline[*environmentv1.UpdateEnvironmentVariablesRequest]("environment-update-variables").
		AddStep(steps.NewValidateProtoStep[*environmentv1.UpdateEnvironmentVariablesRequest]()).
		AddStep(envsteps.NewLoadEnvironmentByIDStep[*environmentv1.UpdateEnvironmentVariablesRequest](c.store)).
		AddStep(envsteps.NewMergeVariablesAndPersistStep(c.store, c.secretService)).
		Build()
}
