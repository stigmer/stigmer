package steps

import (
	"fmt"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// SecretValueKey is the context key for the decrypted EnvironmentValue result.
const SecretValueKey = "secretValue"

// extractAndDecryptSingleKeyStep finds a specific key in the loaded environment's
// spec.data map and decrypts it if it is a secret. The result is stored in context
// under SecretValueKey.
//
// Behavior:
//   - If the key does not exist in spec.data: returns NOT_FOUND
//   - If the key exists and is_secret=false: returns the value as-is
//   - If the key exists and is_secret=true: decrypts via SecretService and returns
type extractAndDecryptSingleKeyStep struct {
	secretService *encryption.SecretService
}

// NewExtractAndDecryptSingleKeyStep creates a step that extracts and optionally
// decrypts a single key from the loaded environment.
func NewExtractAndDecryptSingleKeyStep(secretService *encryption.SecretService) *extractAndDecryptSingleKeyStep {
	return &extractAndDecryptSingleKeyStep{secretService: secretService}
}

func (s *extractAndDecryptSingleKeyStep) Name() string {
	return "ExtractAndDecryptSingleKey"
}

func (s *extractAndDecryptSingleKeyStep) Execute(ctx *pipeline.RequestContext[*environmentv1.EnvironmentSecretValueInput]) error {
	key := ctx.Input().GetKey()

	env, ok := ctx.Get(pipelinesteps.TargetResourceKey).(*environmentv1.Environment)
	if !ok || env == nil {
		return grpclib.InternalError(fmt.Errorf("targetResource missing or wrong type"), "environment not loaded in context")
	}

	spec := env.GetSpec()
	if spec == nil {
		return grpclib.NotFoundError("environment key", key)
	}

	envValue, exists := spec.GetData()[key]
	if !exists {
		return grpclib.NotFoundError("environment key", key)
	}

	if envValue.GetIsSecret() && envValue.GetValue() != "" {
		decrypted, err := s.secretService.Decrypt(envValue.GetValue())
		if err != nil {
			log.Error().
				Err(err).
				Str("key", key).
				Msg("Failed to decrypt secret value")
			return grpclib.InternalError(err, "failed to decrypt secret value")
		}

		ctx.Set(SecretValueKey, &environmentv1.EnvironmentValue{
			Value:       decrypted,
			IsSecret:    true,
			Description: envValue.GetDescription(),
		})
		return nil
	}

	ctx.Set(SecretValueKey, envValue)
	return nil
}
