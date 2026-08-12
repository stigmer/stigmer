package executioncontext

import (
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	envsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
)

// RedactExecutionContextSecrets replaces every non-empty is_secret value
// with the redaction marker on the given execution context — called at
// every controller boundary that returns an ExecutionContext to a caller
// outside the runner lane: get, getByReference, the create/apply response
// echo, the delete response echo, and getByExecutionId for callers without
// a scope-bound runner token. The EC twin of the environment domain's
// RedactEnvironmentSecrets and the OSS mirror of the cloud edition's
// RedactExecutionContextValues (oss#535).
//
// The marker is imported from the environment domain so the sentinel has a
// single source of truth across both domains — the same move the cloud
// edition makes (its EC step reuses RedactSecretValues.REDACTED_MARKER).
//
// is_secret is preserved so clients know a hidden value exists; empty
// secret declarations stay empty (a marker would falsely signal a stored
// value). Redaction is representation-agnostic: it replaces whatever is
// stored (ciphertext or legacy pre-oss#535 plaintext).
//
// Mutates in place: callers hold either a fresh store unmarshal (reads) or
// the already-persisted new state (create echo), so the redaction never
// reaches the store. Runs strictly AFTER Persist and IndexSearch on the
// create path.
func RedactExecutionContextSecrets(ec *executioncontextv1.ExecutionContext) {
	if ec == nil || ec.GetSpec() == nil {
		return
	}
	for _, val := range ec.Spec.Data {
		if val.GetIsSecret() && val.GetValue() != "" {
			val.Value = envsteps.RedactedMarker
		}
	}
}
