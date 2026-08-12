package executioncontext

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/rs/zerolog/log"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"google.golang.org/grpc/metadata"
)

// resolveValuesForCaller decides — by presented credential — whether a
// getByExecutionId response carries decrypted or redacted secret values,
// and applies the corresponding transform in place. The OSS mirror of the
// cloud edition's ResolveExecutionContextValuesForCaller (oss#535, porting
// the stigmer-cloud#152 contract: no read RPC hands plaintext secrets to a
// caller outside the runner lane).
//
// # The lane
//
// getByExecutionId is the runner's secret-delivery path. OSS has no caller
// identity, so the runner distinguishes itself with an execution-scoped
// token minted by GetRunnerScopedToken and presented as a Bearer
// authorization header (the same header shape a cloud runner uses for its
// sandbox credential). Decrypt requires the FULL binding: a valid,
// unexpired token whose execution_id claim equals this EC's
// spec.execution_id. Everything else — no header, malformed or expired
// token, or a token minted for a different execution — falls closed to the
// same redaction get/getByReference apply, as a successful response, not an
// error.
//
// # Decrypt error doctrine (the oss#405 runtime-resolution doctrine)
//
//   - Undecryptable ciphertext (tampered/truncated/wrong-key) is scoped to
//     one value: WARN and drop that key rather than failing the read.
//   - encryption.ErrEncryptionDisabled fails the request: the stored
//     ciphertext may be perfectly valid (key file lost), and dropping it
//     would start the execution silently missing a credential — a confusing
//     downstream failure instead of a clear one here.
//   - Legacy pre-oss#535 plaintext rows pass through undecorated (Decrypt
//     is a pass-through for non-ciphertext), so old stores serve without
//     migration.
func (c *ExecutionContextController) resolveValuesForCaller(ctx context.Context, ec *executioncontextv1.ExecutionContext) error {
	if executionID, ok := c.verifyRunnerToken(ctx, ec); ok {
		log.Debug().
			Str("execution_id", executionID).
			Msg("Scope-bound runner token presented - decrypting execution context secrets")
		return c.decryptSecretValues(ec)
	}

	RedactExecutionContextSecrets(ec)
	return nil
}

// verifyRunnerToken reports whether the caller presented a valid runner
// token bound to exactly this execution context. Every failure mode answers
// false — the caller falls closed to redaction — with the mismatch case
// WARN-logged because a runner reading across executions indicates a bug,
// while an absent header is just an ordinary user-shaped read.
func (c *ExecutionContextController) verifyRunnerToken(ctx context.Context, ec *executioncontextv1.ExecutionContext) (string, bool) {
	if c.runnerAuth == nil {
		return "", false
	}

	token := bearerToken(ctx)
	if token == "" {
		return "", false
	}

	tokenExecutionID, err := c.runnerAuth.Verify(token)
	if err != nil {
		log.Debug().Msg("Presented runner token failed verification - redacting execution context secrets")
		return "", false
	}

	if tokenExecutionID != ec.GetSpec().GetExecutionId() {
		log.Warn().
			Str("token_execution_id", tokenExecutionID).
			Str("execution_id", ec.GetSpec().GetExecutionId()).
			Msg("Runner token is not scope-bound to this execution context - redacting secrets")
		return "", false
	}

	return tokenExecutionID, true
}

// bearerToken extracts the Bearer credential from the request's
// authorization metadata; empty when absent or differently shaped.
func bearerToken(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	values := md.Get("authorization")
	if len(values) == 0 {
		return ""
	}
	const prefix = "bearer "
	if len(values[0]) <= len(prefix) || !strings.EqualFold(values[0][:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(values[0][len(prefix):])
}

// decryptSecretValues walks spec.data and decrypts every encrypted
// is_secret value in place, per the doctrine documented on
// resolveValuesForCaller.
func (c *ExecutionContextController) decryptSecretValues(ec *executioncontextv1.ExecutionContext) error {
	executionID := ec.GetSpec().GetExecutionId()
	for key, val := range ec.GetSpec().GetData() {
		if !val.GetIsSecret() || !c.secretService.IsEncrypted(val.GetValue()) {
			continue
		}

		decrypted, err := c.secretService.Decrypt(val.GetValue())
		if err != nil {
			if errors.Is(err, encryption.ErrEncryptionDisabled) {
				return grpclib.InternalError(err, fmt.Sprintf(
					"execution context for %s holds encrypted secret '%s' but no encryption key is configured",
					executionID, key))
			}
			log.Warn().Err(err).
				Str("key", key).
				Str("execution_id", executionID).
				Msg("Undecryptable ciphertext in execution context — dropping this value from the runner read")
			delete(ec.Spec.Data, key)
			continue
		}
		val.Value = decrypted
	}
	return nil
}
