// Pins that every component reason has the sentence an adopter reads when a
// component has no more specific one, and that the list and the sentences
// name the same reasons, so a new constant cannot ship without words.

package v1

import "testing"

func TestEveryReasonHasASentence(t *testing.T) {
	all := AllComponentReasons()
	seen := map[ComponentReason]bool{}
	for _, r := range all {
		if seen[r] {
			t.Errorf("%s is listed twice", r)
		}
		seen[r] = true
		if ReasonMessages[r] == "" {
			t.Errorf("%s has no sentence in ReasonMessages", r)
		}
	}
	for r := range ReasonMessages {
		if !seen[r] {
			t.Errorf("ReasonMessages has %s, which AllComponentReasons does not list", r)
		}
	}
}

func TestHealthyAndWaitingAreNotFailures(t *testing.T) {
	for _, r := range []ComponentReason{ReasonHealthy, ReasonDeploying, ReasonWaitingForDependency, ReasonStartingUp, ReasonWaitingForSchema, ReasonCertificatePending, ReasonRealmConverging} {
		if r.IsFailure() {
			t.Errorf("%s reads as a failure; it is a wait", r)
		}
	}
	for _, r := range []ComponentReason{ReasonCrashLooping, ReasonSecretMissing, ReasonAnotherStigmer, ReasonPrerequisiteNotRunning} {
		if !r.IsFailure() {
			t.Errorf("%s does not read as a failure", r)
		}
	}
}
