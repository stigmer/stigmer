/**
 * The unattended model-pinning rule — ports
 * pkg/domain/schedule/temporal/modelpinning.go (stigmer/stigmer#362).
 *
 * A schedule whose fires would run the CURSOR harness must pin a model: an
 * empty model there selects Auto, whose price variant follows the provider
 * ACCOUNT's out-of-band default speed setting — nobody at a 3 AM fire is
 * watching a rate change. The native harness is exempt on purpose: an
 * empty model resolves to the platform's own registry-priced default at an
 * explicitly requested tier — deterministic, nothing to pin.
 *
 * Only an EXPLICIT cursor harness trips the rule in this edition: an unset
 * harness resolves to the OSS platform default (native), so there is no
 * cursor path to guard. The cloud edition additionally judges its
 * configured default harness (cursor there) — same contract, each
 * edition's own default-harness truth (the DD-015 divergence posture).
 *
 * Evaluated at write time (the controller's model-pinning validator
 * delegates here) AND as the run starter's launch backstop, so rows
 * written before the rule existed refuse at fire time instead of running
 * mispriced. Pure module (no node built-ins): the domain validator imports
 * it across the domain→clock boundary, exactly Go's controller →
 * scheduletemporal edge.
 */
import type { ScheduleSpec } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

/**
 * Returns the refusal copy, or "" when the fire is allowed (Go
 * ScheduleModelPinningRefusal — the copy is cross-edition byte contract).
 */
export function scheduleModelPinningRefusal(
  spec: ScheduleSpec | undefined,
): string {
  const agent = spec?.target.case === "agent" ? spec.target.value : undefined;
  if (agent?.harness !== Harness.CURSOR) {
    return "";
  }
  if ((agent.runConfig?.modelName ?? "").trim() !== "") {
    return "";
  }
  return (
    "spec.agent.run_config.model_name must name a pinned model when the run would use " +
    "the Cursor harness — with no pinned model Cursor runs Auto, whose price variant " +
    "follows the provider account's out-of-band default speed setting (stigmer/stigmer#362)"
  );
}
