package steps

import (
	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// loadEnvironmentByIDStep loads an environment using the environment_id field
// from EnvironmentSecretValueInput. This is needed because the standard
// LoadTargetStep expects HasIdValue (GetValue()), but EnvironmentSecretValueInput
// uses GetEnvironmentId().
type loadEnvironmentByIDStep struct {
	store store.Store
}

// NewLoadEnvironmentByIDStep creates a step that loads an environment by the
// environment_id field from the input message.
func NewLoadEnvironmentByIDStep(store store.Store) *loadEnvironmentByIDStep {
	return &loadEnvironmentByIDStep{store: store}
}

func (s *loadEnvironmentByIDStep) Name() string {
	return "LoadEnvironmentByID"
}

func (s *loadEnvironmentByIDStep) Execute(ctx *pipeline.RequestContext[*environmentv1.EnvironmentSecretValueInput]) error {
	environmentID := ctx.Input().GetEnvironmentId()
	if environmentID == "" {
		return grpclib.InvalidArgumentError("environment_id is required")
	}

	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	log.Debug().
		Str("environment_id", environmentID).
		Msg("Loading environment by ID for secret value retrieval")

	env := &environmentv1.Environment{}
	if err := s.store.GetResource(ctx.Context(), kind, environmentID, env); err != nil {
		return grpclib.NotFoundError("environment", environmentID)
	}

	ctx.Set(pipelinesteps.TargetResourceKey, env)
	return nil
}
