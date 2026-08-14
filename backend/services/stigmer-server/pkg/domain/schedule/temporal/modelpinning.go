package temporal

import (
	"strings"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
)

// ScheduleModelPinningRefusal is this edition's one statement of the
// unattended model-pinning rule (stigmer/stigmer#362): a schedule whose
// fires would run the CURSOR harness must pin a model. An empty model
// there selects Auto, whose price variant follows the provider ACCOUNT's
// out-of-band default speed setting — nobody at a 3 AM fire is watching a
// rate change. The native harness is exempt on purpose: an empty model
// resolves to the platform's own registry-priced default at an explicitly
// requested tier — deterministic, nothing to pin.
//
// Only an EXPLICIT cursor harness trips the rule in this edition: an
// unset harness resolves to the OSS platform default (native), so there
// is no cursor path to guard. The cloud edition additionally judges its
// configured default harness (cursor there) through its
// UnattendedModelPinningPolicy — same contract, each edition's own
// default-harness truth (the DD-015 divergence posture). The copy
// mirrors the cloud policy's core sentence minus its cloud-only
// remediation tail (OSS schedules have no platform execution-profile
// model to fall back on).
//
// Evaluated at write time (the controller's validateScheduleModelPinning
// delegates here) AND as the run starter's launch backstop, so rows
// written before the rule existed refuse at fire time instead of running
// mispriced. Returns the refusal copy, or "" when the fire is allowed.
func ScheduleModelPinningRefusal(spec *schedulev1.ScheduleSpec) string {
	if spec.GetAgent().GetHarness() != sessionv1.Harness_HARNESS_CURSOR {
		return ""
	}
	if strings.TrimSpace(spec.GetAgent().GetRunConfig().GetModelName()) != "" {
		return ""
	}
	return "spec.agent.run_config.model_name must name a pinned model when the run would use " +
		"the Cursor harness — with no pinned model Cursor runs Auto, whose price variant " +
		"follows the provider account's out-of-band default speed setting (stigmer/stigmer#362)"
}
