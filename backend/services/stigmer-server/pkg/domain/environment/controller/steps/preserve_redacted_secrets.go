package steps

import (
	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// RedactedMarker is the sentinel string used by the response pipeline to
// replace secret values before they leave the server. If a client sends
// this value back in an update request, the intent is "keep the existing
// secret" — not "store the literal marker".
const RedactedMarker = "***REDACTED***"

// preserveRedactedSecretsStep is a defense-in-depth step for the
// Environment full-resource update pipeline. After BuildUpdateState
// replaces the spec wholesale, this step detects any EnvironmentValue
// whose value equals the redaction marker and restores the pre-update
// encrypted value from the existing resource.
//
// Requires LoadExistingStep and BuildUpdateStateStep to have run first.
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

	existingVal := ctx.Get(pipelinesteps.ExistingResourceKey)
	existing, ok := existingVal.(*environmentv1.Environment)
	if !ok || existing == nil {
		return nil
	}

	existingData := existing.GetSpec().GetData()
	if existingData == nil {
		existingData = map[string]*environmentv1.EnvironmentValue{}
	}

	preservedCount := 0
	for key, val := range newState.Spec.Data {
		if !val.GetIsSecret() || val.GetValue() != RedactedMarker {
			continue
		}

		existingEntry, found := existingData[key]
		if found && existingEntry.GetIsSecret() {
			newState.Spec.Data[key] = existingEntry
			preservedCount++
			continue
		}

		return grpclib.InvalidArgumentError(
			"variable '%s': cannot use the redaction marker as a secret value", key)
	}

	if preservedCount > 0 {
		log.Debug().
			Int("preservedCount", preservedCount).
			Str("environment_id", newState.GetMetadata().GetId()).
			Msg("Preserved existing secret values for redacted entries")
	}

	return nil
}
