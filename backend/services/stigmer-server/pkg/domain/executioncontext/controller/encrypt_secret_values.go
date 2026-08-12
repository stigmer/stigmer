package executioncontext

import (
	"fmt"

	"github.com/rs/zerolog/log"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// rejectCiphertextShapedStep refuses client-supplied values that look like
// stored ciphertext (the enc:v<N>: prefix family) — the EC flavor of the
// oss#395 / cloud#229 write-boundary guard. Without it, the encrypt step's
// idempotent pass-through would let a caller smuggle a forged or replayed
// ciphertext blob into the store, where the runner lane would later try to
// decrypt it.
//
// ExecutionContext is create-only with no redaction round-trip (unlike
// Environment, whose PreserveRedactedSecrets restores ***REDACTED*** markers
// on update), so this guard is the whole boundary: every legitimate creator
// — the agent/workflow builders, the MCP connect handler, an SDK caller —
// supplies plaintext.
type rejectCiphertextShapedStep struct{}

func newRejectCiphertextShapedStep() *rejectCiphertextShapedStep {
	return &rejectCiphertextShapedStep{}
}

func (s *rejectCiphertextShapedStep) Name() string {
	return "RejectCiphertextShapedValues"
}

func (s *rejectCiphertextShapedStep) Execute(ctx *pipeline.RequestContext[*executioncontextv1.ExecutionContext]) error {
	ec := ctx.Input()
	for key, val := range ec.GetSpec().GetData() {
		if encryption.IsCiphertextShaped(val.GetValue()) {
			return grpclib.InvalidArgumentError(
				"value for '%s' looks like stored ciphertext (enc:v<N>: prefix); supply the plaintext value", key)
		}
	}
	return nil
}

// encryptSecretValuesStep encrypts every non-empty is_secret value in
// spec.data before persistence — the EC twin of the environment domain's
// step of the same name and the OSS mirror of the cloud edition's
// EncryptExecutionContextValues, closing the at-rest half of oss#535 (the
// merged EC — decrypted environment secrets, runtime_env overrides,
// injected OAuth tokens — rested plaintext for each run's duration, the
// same backup-exposure class oss#405 closed for environments).
//
// Runs after rejectCiphertextShapedStep, so every secret value reaching it
// is client plaintext; Encrypt's idempotent pass-through is therefore never
// exercised by design, but keeps a double application harmless.
//
// When encryption is disabled (no key — effectively test-only, the key
// auto-generates via NewSecretServiceFromEnv) values pass through plaintext
// with one WARN per request, the oss#394 convention shared with the
// environment, oauthapp, and channelapp domains.
//
// Non-secret values are never touched: the read paths gate decryption on
// is_secret, so encrypting a non-secret value would strand it as unreadable
// ciphertext.
type encryptSecretValuesStep struct {
	secretService *encryption.SecretService
}

func newEncryptSecretValuesStep(secretService *encryption.SecretService) *encryptSecretValuesStep {
	return &encryptSecretValuesStep{secretService: secretService}
}

func (s *encryptSecretValuesStep) Name() string {
	return "EncryptSecretValues"
}

func (s *encryptSecretValuesStep) Execute(ctx *pipeline.RequestContext[*executioncontextv1.ExecutionContext]) error {
	ec := ctx.NewState()
	if ec == nil || ec.GetSpec() == nil || len(ec.GetSpec().GetData()) == 0 {
		return nil
	}

	if !s.secretService.IsEnabled() {
		if hasNonEmptySecret(ec.GetSpec().GetData()) {
			log.Warn().
				Str("execution_id", ec.GetSpec().GetExecutionId()).
				Msg("Encryption disabled: execution context secret values will be stored in plaintext")
		}
		return nil
	}

	encryptedCount := 0
	for key, val := range ec.Spec.Data {
		if !val.GetIsSecret() || val.GetValue() == "" {
			continue
		}

		encrypted, err := s.secretService.Encrypt(val.GetValue())
		if err != nil {
			return grpclib.InternalError(err, fmt.Sprintf("failed to encrypt secret value for '%s'", key))
		}
		if encrypted != val.GetValue() {
			val.Value = encrypted
			encryptedCount++
		}
	}

	if encryptedCount > 0 {
		log.Debug().
			Int("encryptedCount", encryptedCount).
			Str("execution_id", ec.GetSpec().GetExecutionId()).
			Msg("Encrypted execution context secret values before persistence")
	}

	return nil
}

// hasNonEmptySecret reports whether any entry would have been encrypted —
// keeps the disabled-encryption WARN honest (no warning for secret-free
// execution contexts).
func hasNonEmptySecret(data map[string]*executioncontextv1.ExecutionValue) bool {
	for _, val := range data {
		if val.GetIsSecret() && val.GetValue() != "" {
			return true
		}
	}
	return false
}
