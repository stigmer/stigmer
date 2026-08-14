package steps

import (
	"fmt"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// removeVariableKeysAndPersistStep deletes specified keys from the loaded
// environment's spec.data and persists the result. Keys that don't exist
// are silently ignored.
//
// Requires LoadEnvironmentByIDStep to have run first (reads from TargetResourceKey).
// Stores the modified environment under UpdatedEnvironmentKey.
type removeVariableKeysAndPersistStep struct {
	store store.Store
}

func NewRemoveVariableKeysAndPersistStep(store store.Store) *removeVariableKeysAndPersistStep {
	return &removeVariableKeysAndPersistStep{store: store}
}

func (s *removeVariableKeysAndPersistStep) Name() string {
	return "RemoveVariableKeysAndPersist"
}

func (s *removeVariableKeysAndPersistStep) Execute(ctx *pipeline.RequestContext[*environmentv1.RemoveEnvironmentVariablesRequest]) error {
	env, ok := ctx.Get(pipelinesteps.TargetResourceKey).(*environmentv1.Environment)
	if !ok || env == nil {
		return grpclib.InternalError(fmt.Errorf("targetResource missing or wrong type"), "environment not loaded in context")
	}

	keys := ctx.Input().GetKeys()
	removed := 0
	if env.Spec != nil && env.Spec.Data != nil {
		for _, key := range keys {
			if _, exists := env.Spec.Data[key]; exists {
				delete(env.Spec.Data, key)
				removed++
			}
		}
	}

	log.Debug().
		Int("requestedKeys", len(keys)).
		Int("removedCount", removed).
		Int("remainingKeys", len(env.GetSpec().GetData())).
		Str("environment_id", env.GetMetadata().GetId()).
		Msg("Removed variables from environment")

	if err := pipelinesteps.SetAuditFieldsForUpdate(env, pipelinesteps.SpecAudit); err != nil {
		return grpclib.InternalError(err, "failed to set audit fields")
	}

	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
	if err := s.store.SaveResource(ctx.Context(), kind, env.GetMetadata().GetId(), env); err != nil {
		return grpclib.InternalError(err, "failed to persist environment after removing variables")
	}

	ctx.Set(UpdatedEnvironmentKey, env)
	return nil
}
