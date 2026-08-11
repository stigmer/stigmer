package steps

import (
	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// RedactedMarker is the sentinel string used by the response pipeline to
// replace secret values before they leave the server. If a client sends
// this value back in an update request, the intent is "keep the existing
// secret" — not "store the literal marker".
const RedactedMarker = "***REDACTED***"

// preserveRedactedSecretsStep handles client-supplied secret SENTINELS on
// write — the mirror of the cloud edition's PreserveRedactedSecrets step,
// serving both the create and full-resource update pipelines:
//
//   - A secret whose incoming value is the ***REDACTED*** marker is
//     restored from the existing resource (update). When there is nothing
//     to preserve — a create, or an update for a key that had no prior
//     secret — the marker is meaningless and rejected with
//     INVALID_ARGUMENT rather than stored literally.
//   - A secret carrying the ciphertext-shaped enc:v<N>: prefix is rejected
//     with INVALID_ARGUMENT (oss#395): the prefix is server-reserved, so a
//     prefixed request value is forged ciphertext or an attempt to plant a
//     value that getSecretValue would later decrypt with the deployment
//     key. The marker arm must run FIRST — after preservation, legitimate
//     stored ciphertext is present by design and must not hit this arm.
//   - Non-secret values pass through untouched. They are exempt from the
//     prefix rejection deliberately: every decrypt path gates on
//     is_secret && IsEncrypted, so a non-secret prefixed string is inert,
//     and flipping it to secret later re-enters this guard.
//
// Runs while spec.data is still raw client input: after BuildUpdateState
// (update; requires LoadExistingStep) or after BuildNewState (create,
// where ExistingResourceKey is absent and every marker is rejected).
type preserveRedactedSecretsStep struct{}

func NewPreserveRedactedSecretsStep() *preserveRedactedSecretsStep {
	return &preserveRedactedSecretsStep{}
}

func (s *preserveRedactedSecretsStep) Name() string {
	return "PreserveRedactedSecrets"
}

func (s *preserveRedactedSecretsStep) Execute(ctx *pipeline.RequestContext[*environmentv1.Environment]) error {
	newState := ctx.NewState()
	if newState == nil || newState.GetSpec() == nil || len(newState.GetSpec().GetData()) == 0 {
		return nil
	}

	// Absent existing resource (the create pipeline) means there is nothing
	// to preserve: fall through with an empty map so every marker is
	// rejected instead of silently skipping the guards.
	existingData := map[string]*environmentv1.EnvironmentValue{}
	if existing, ok := ctx.Get(pipelinesteps.ExistingResourceKey).(*environmentv1.Environment); ok && existing != nil {
		if data := existing.GetSpec().GetData(); data != nil {
			existingData = data
		}
	}

	preservedCount := 0
	for key, val := range newState.Spec.Data {
		if !val.GetIsSecret() {
			continue
		}

		if val.GetValue() == RedactedMarker {
			existingEntry, found := existingData[key]
			if found && existingEntry.GetIsSecret() {
				newState.Spec.Data[key] = existingEntry
				preservedCount++
				continue
			}
			return grpclib.InvalidArgumentError(
				"variable '%s': cannot use the redaction marker as a secret value", key)
		}

		// Unconditional (not gated on encryption being enabled): the prefix
		// is server-reserved regardless of key state.
		if encryption.IsCiphertextShaped(val.GetValue()) {
			return grpclib.InvalidArgumentError(
				"variable '%s' must be plaintext — values carrying the 'enc:' "+
					"encryption prefix are not accepted from clients", key)
		}
	}

	if preservedCount > 0 {
		log.Debug().
			Int("preservedCount", preservedCount).
			Str("environment_id", newState.GetMetadata().GetId()).
			Msg("Preserved existing secret values for redacted entries")
	}

	return nil
}
