package environment

import (
	"context"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	envsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
)

// RemoveVariables removes specific variables from an environment by key.
// Keys that don't exist are silently ignored. Returns the updated environment.
//
// Pipeline:
// 1. ValidateProto    — validate environment_id and keys (min 1) via buf constraints
// 2. LoadByEnvID      — load the existing environment from store
// 3. RemoveAndPersist — delete specified keys from spec.data, update audit, persist
func (c *EnvironmentController) RemoveVariables(ctx context.Context, req *environmentv1.RemoveEnvironmentVariablesRequest) (*environmentv1.Environment, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildRemoveVariablesPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	updated := reqCtx.Get(envsteps.UpdatedEnvironmentKey).(*environmentv1.Environment)
	envsteps.RedactEnvironmentSecrets(updated)
	return updated, nil
}

func (c *EnvironmentController) buildRemoveVariablesPipeline() *pipeline.Pipeline[*environmentv1.RemoveEnvironmentVariablesRequest] {
	return pipeline.NewPipeline[*environmentv1.RemoveEnvironmentVariablesRequest]("environment-remove-variables").
		AddStep(steps.NewValidateProtoStep[*environmentv1.RemoveEnvironmentVariablesRequest]()).
		AddStep(envsteps.NewLoadEnvironmentByIDStep[*environmentv1.RemoveEnvironmentVariablesRequest](c.store)).
		AddStep(envsteps.NewRemoveVariableKeysAndPersistStep(c.store)).
		Build()
}
