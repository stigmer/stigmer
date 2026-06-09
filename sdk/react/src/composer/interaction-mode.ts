import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { InteractionModeOption } from "./InteractionModePicker";

/**
 * Convert an {@link InteractionModeOption} string to the proto
 * {@link InteractionMode} enum.
 *
 * Mirrors {@link toProtoHarness} — keeps the option-string <-> proto mapping
 * in one place so component props can stay framework-agnostic while execution
 * creation speaks proto.
 */
export function toProtoInteractionMode(
  mode: InteractionModeOption,
): InteractionMode {
  switch (mode) {
    case "plan":
      return InteractionMode.PLAN;
    case "agent":
    default:
      return InteractionMode.AGENT;
  }
}

/**
 * Convert a proto {@link InteractionMode} enum to an
 * {@link InteractionModeOption} string.
 *
 * `UNSPECIFIED` (and any unknown value) maps to `undefined` so callers can
 * decide their own default — the composer falls back to `"agent"`, matching
 * the proto contract (`UNSPECIFIED` resolves to `INTERACTION_MODE_AGENT`).
 */
export function fromProtoInteractionMode(
  mode: InteractionMode | undefined,
): InteractionModeOption | undefined {
  switch (mode) {
    case InteractionMode.AGENT:
      return "agent";
    case InteractionMode.PLAN:
      return "plan";
    default:
      return undefined;
  }
}
