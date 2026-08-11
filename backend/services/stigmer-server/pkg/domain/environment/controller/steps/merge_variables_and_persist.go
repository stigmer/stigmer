package steps

import (
	"fmt"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	commonspb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// UpdatedEnvironmentKey is the context key for the modified environment after
// a merge or remove variables operation.
const UpdatedEnvironmentKey = "updatedEnvironment"

// mergeVariablesAndPersistStep merges incoming variables into the loaded
// environment's spec.data and persists the result. Keys in the request
// overwrite existing keys; keys not in the request are preserved.
//
// Requires LoadEnvironmentByIDStep to have run first (reads from TargetResourceKey).
// Stores the modified environment under UpdatedEnvironmentKey.
type mergeVariablesAndPersistStep struct {
	store store.Store
}

func NewMergeVariablesAndPersistStep(store store.Store) *mergeVariablesAndPersistStep {
	return &mergeVariablesAndPersistStep{store: store}
}

func (s *mergeVariablesAndPersistStep) Name() string {
	return "MergeVariablesAndPersist"
}

func (s *mergeVariablesAndPersistStep) Execute(ctx *pipeline.RequestContext[*environmentv1.UpdateEnvironmentVariablesRequest]) error {
	env, ok := ctx.Get(pipelinesteps.TargetResourceKey).(*environmentv1.Environment)
	if !ok || env == nil {
		return grpclib.InternalError(fmt.Errorf("targetResource missing or wrong type"), "environment not loaded in context")
	}

	if env.Spec == nil {
		env.Spec = &environmentv1.EnvironmentSpec{}
	}
	if env.Spec.Data == nil {
		env.Spec.Data = make(map[string]*environmentv1.EnvironmentValue)
	}

	incoming := ctx.Input().GetVariables()
	for key, val := range incoming {
		if val.GetIsSecret() && val.GetValue() == RedactedMarker {
			if existing, ok := env.Spec.Data[key]; ok && existing.GetIsSecret() {
				log.Debug().Str("key", key).Msg("Preserved existing value for redacted secret variable")
				continue
			}
			return grpclib.InvalidArgumentError(
				"variable '%s': cannot use the redaction marker as a secret value", key)
		}
		// Ciphertext-shaped client input is rejected at every secret write
		// boundary (oss#395); see preserveRedactedSecretsStep for the full
		// rationale. Non-secret values are deliberately exempt (inert).
		if val.GetIsSecret() && encryption.IsCiphertextShaped(val.GetValue()) {
			return grpclib.InvalidArgumentError(
				"variable '%s' must be plaintext — values carrying the 'enc:' "+
					"encryption prefix are not accepted from clients", key)
		}
		env.Spec.Data[key] = val
	}

	log.Debug().
		Int("mergedCount", len(incoming)).
		Int("totalKeys", len(env.Spec.Data)).
		Str("environment_id", env.GetMetadata().GetId()).
		Msg("Merged variables into environment")

	updateSpecAudit(env)

	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
	if err := s.store.SaveResource(ctx.Context(), kind, env.GetMetadata().GetId(), env); err != nil {
		return grpclib.InternalError(err, "failed to persist environment after merging variables")
	}

	ctx.Set(UpdatedEnvironmentKey, env)
	return nil
}

// updateSpecAudit bumps spec_audit.updated_at and updated_by while
// preserving the original created_at / created_by.
func updateSpecAudit(env *environmentv1.Environment) {
	now := timestamppb.Now()
	actor := &commonspb.ApiResourceAuditActor{Id: "system"}

	if env.Status == nil {
		env.Status = &commonspb.ApiResourceAuditStatus{}
	}
	if env.Status.Audit == nil {
		env.Status.Audit = &commonspb.ApiResourceAudit{}
	}
	if env.Status.Audit.SpecAudit == nil {
		env.Status.Audit.SpecAudit = &commonspb.ApiResourceAuditInfo{
			CreatedBy: actor,
			CreatedAt: now,
		}
	}

	env.Status.Audit.SpecAudit.UpdatedBy = actor
	env.Status.Audit.SpecAudit.UpdatedAt = now
	env.Status.Audit.SpecAudit.Event = "updated"
}
