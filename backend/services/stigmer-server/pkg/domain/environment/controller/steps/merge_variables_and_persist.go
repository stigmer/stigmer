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
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// UpdatedEnvironmentKey is the context key for the modified environment after
// a merge or remove variables operation.
const UpdatedEnvironmentKey = "updatedEnvironment"

// mergeVariablesAndPersistStep merges incoming variables into the loaded
// environment's spec.data and persists the result. Keys in the request
// overwrite existing keys; keys not in the request are preserved.
//
// Incoming is_secret values are encrypted before assignment (oss#405) —
// this step is its own write boundary (sentinel guard, merge, and persist
// all live here), so it carries its own encrypt call rather than a separate
// pipeline step. Same ordering contract as create/update: sentinels first,
// then encrypt. This is the path OAuth-managed vendor tokens take
// (ManagedEnvironmentService.UpdateSecrets), so they rest encrypted too.
//
// Requires LoadEnvironmentByIDStep to have run first (reads from TargetResourceKey).
// Stores the modified environment under UpdatedEnvironmentKey.
type mergeVariablesAndPersistStep struct {
	store         store.Store
	secretService *encryption.SecretService
}

func NewMergeVariablesAndPersistStep(store store.Store, secretService *encryption.SecretService) *mergeVariablesAndPersistStep {
	return &mergeVariablesAndPersistStep{store: store, secretService: secretService}
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
		if val.GetIsSecret() && val.GetValue() != "" {
			if !s.secretService.IsEnabled() {
				log.Warn().Str("key", key).
					Msg("Encryption disabled: environment secret value will be stored in plaintext")
			} else {
				encrypted, err := s.secretService.Encrypt(val.GetValue())
				if err != nil {
					return grpclib.InternalError(err,
						fmt.Sprintf("failed to encrypt secret value for variable '%s'", key))
				}
				val = &environmentv1.EnvironmentValue{
					Value:       encrypted,
					IsSecret:    true,
					Description: val.GetDescription(),
				}
			}
		}
		env.Spec.Data[key] = val
	}

	log.Debug().
		Int("mergedCount", len(incoming)).
		Int("totalKeys", len(env.Spec.Data)).
		Str("environment_id", env.GetMetadata().GetId()).
		Msg("Merged variables into environment")

	if err := pipelinesteps.SetAuditFieldsForUpdate(env, pipelinesteps.SpecAudit); err != nil {
		return grpclib.InternalError(err, "failed to set audit fields")
	}

	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
	if err := s.store.SaveResource(ctx.Context(), kind, env.GetMetadata().GetId(), env); err != nil {
		return grpclib.InternalError(err, "failed to persist environment after merging variables")
	}

	ctx.Set(UpdatedEnvironmentKey, env)
	return nil
}
