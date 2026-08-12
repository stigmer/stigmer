package steps

import (
	"fmt"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// encryptSecretValuesStep encrypts every is_secret value in spec.data before
// persistence — the OSS mirror of the cloud edition's EncryptSecretValues
// step, closing oss#405 (environment secrets rested plaintext while oauthapp
// and channelapp secrets were encrypted in the same store).
//
// Ordering contract (the cloud "sentinels → encrypt" doc): this step MUST run
// after PreserveRedactedSecrets, which handles the two client sentinels —
// the ***REDACTED*** marker (restored to stored ciphertext) and forged
// enc:v<N>: input (rejected). By the time this step runs, every secret value
// is either fresh client plaintext (encrypt it) or marker-restored stored
// ciphertext (Encrypt's idempotent pass-through leaves it unchanged, so a
// round-tripped secret is never double-encrypted).
//
// When encryption is disabled (no key — effectively test-only, the OSS key
// auto-generates via NewSecretServiceFromEnv) values pass through plaintext
// with one WARN per request, the oss#394 convention shared with oauthapp and
// channelapp.
//
// Non-secret values are never touched: getSecretValue and the runtime
// resolution path gate decryption on is_secret, so encrypting a non-secret
// value would strand it as unreadable ciphertext.
type encryptSecretValuesStep struct {
	secretService *encryption.SecretService
}

func NewEncryptSecretValuesStep(secretService *encryption.SecretService) *encryptSecretValuesStep {
	return &encryptSecretValuesStep{secretService: secretService}
}

func (s *encryptSecretValuesStep) Name() string {
	return "EncryptSecretValues"
}

func (s *encryptSecretValuesStep) Execute(ctx *pipeline.RequestContext[*environmentv1.Environment]) error {
	env := ctx.NewState()
	if env == nil || env.GetSpec() == nil || len(env.GetSpec().GetData()) == 0 {
		return nil
	}

	if !s.secretService.IsEnabled() {
		if hasNonEmptySecret(env.GetSpec().GetData()) {
			log.Warn().
				Str("environment_id", env.GetMetadata().GetId()).
				Msg("Encryption disabled: environment secret values will be stored in plaintext")
		}
		return nil
	}

	encryptedCount := 0
	for key, val := range env.Spec.Data {
		if !val.GetIsSecret() || val.GetValue() == "" {
			continue
		}

		encrypted, err := s.secretService.Encrypt(val.GetValue())
		if err != nil {
			return grpclib.InternalError(err, fmt.Sprintf("failed to encrypt secret value for variable '%s'", key))
		}
		if encrypted != val.GetValue() {
			val.Value = encrypted
			encryptedCount++
		}
	}

	if encryptedCount > 0 {
		log.Debug().
			Int("encryptedCount", encryptedCount).
			Str("environment_id", env.GetMetadata().GetId()).
			Msg("Encrypted secret values before persistence")
	}

	return nil
}

// hasNonEmptySecret reports whether any entry would have been encrypted —
// keeps the disabled-encryption WARN honest (no warning for secret-free
// environments).
func hasNonEmptySecret(data map[string]*environmentv1.EnvironmentValue) bool {
	for _, val := range data {
		if val.GetIsSecret() && val.GetValue() != "" {
			return true
		}
	}
	return false
}
