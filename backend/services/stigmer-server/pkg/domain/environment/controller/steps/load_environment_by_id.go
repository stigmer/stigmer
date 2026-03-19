package steps

import (
	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// HasEnvironmentId is satisfied by any proto message containing an environment_id
// field. Protobuf code generation produces GetEnvironmentId() for all such messages.
type HasEnvironmentId interface {
	proto.Message
	GetEnvironmentId() string
}

// loadEnvironmentByIDStep loads an environment using the environment_id field.
// This is needed because the standard LoadTargetStep expects HasIdValue
// (GetValue()), but messages like EnvironmentSecretValueInput,
// UpdateEnvironmentVariablesRequest, and RemoveEnvironmentVariablesRequest
// carry the ID as GetEnvironmentId().
//
// The loaded environment is stored in context under TargetResourceKey.
type loadEnvironmentByIDStep[T HasEnvironmentId] struct {
	store store.Store
}

// NewLoadEnvironmentByIDStep creates a step that loads an environment by the
// environment_id field from the input message.
func NewLoadEnvironmentByIDStep[T HasEnvironmentId](store store.Store) *loadEnvironmentByIDStep[T] {
	return &loadEnvironmentByIDStep[T]{store: store}
}

func (s *loadEnvironmentByIDStep[T]) Name() string {
	return "LoadEnvironmentByID"
}

func (s *loadEnvironmentByIDStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	environmentID := ctx.Input().GetEnvironmentId()
	if environmentID == "" {
		return grpclib.InvalidArgumentError("environment_id is required")
	}

	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	log.Debug().
		Str("environment_id", environmentID).
		Msg("Loading environment by ID")

	env := &environmentv1.Environment{}
	if err := s.store.GetResource(ctx.Context(), kind, environmentID, env); err != nil {
		return grpclib.NotFoundError("environment", environmentID)
	}

	ctx.Set(pipelinesteps.TargetResourceKey, env)
	return nil
}
