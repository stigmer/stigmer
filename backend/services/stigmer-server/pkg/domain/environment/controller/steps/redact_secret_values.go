package steps

import (
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
)

// RedactEnvironmentSecrets replaces every non-empty is_secret value with
// RedactedMarker on the given environment — called at every controller
// boundary that returns an Environment (get, getByReference, list, create,
// update, updateVariables, removeVariables, updateVisibility, delete; apply
// inherits via delegation). The RedactChannelApp / oauthapp shape, and the
// OSS mirror of the cloud edition's RedactSecretValues step.
//
// getSecretValue is the sanctioned single-key reveal path and stays
// unredacted. Server-internal consumers that need real values (execution
// context builds) go through the environment RuntimeResolutionService, not
// the RPC surface.
//
// is_secret and description are preserved so clients know a hidden value
// exists; empty secret declarations stay empty (a marker would falsely
// signal a stored value). Sending the marker back on update means "keep the
// existing secret" — preserveRedactedSecretsStep completes the round-trip.
//
// Mutates in place: callers hold either a fresh store unmarshal (reads) or
// the already-persisted new state (writes), so the redaction never reaches
// the store. Runs strictly AFTER Persist on write paths.
func RedactEnvironmentSecrets(env *environmentv1.Environment) {
	if env == nil || env.GetSpec() == nil {
		return
	}
	for _, val := range env.Spec.Data {
		if val.GetIsSecret() && val.GetValue() != "" {
			val.Value = RedactedMarker
		}
	}
}
