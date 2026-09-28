import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { ModelInfo } from "./registry.js";

/**
 * String form of the thinking mode for component props and hook inputs
 * (stigmer/stigmer#772). Mirrors {@link ServiceTierOption}: components
 * speak strings, execution creation speaks proto.
 *
 * "disabled" is the model's base variant; "enabled" is the model's
 * extended-reasoning variant — selectable only for models whose
 * {@link ModelInfo.thinkingCapable} is true. Unlike the fast tier,
 * thinking bills at base per-token rates; enabled turns simply consume
 * more output (reasoning) tokens.
 */
export type ThinkingModeOption = "disabled" | "enabled";

/**
 * Convert a {@link ThinkingModeOption} string to the proto enum.
 */
export function toProtoThinkingMode(mode: ThinkingModeOption): ThinkingMode {
  switch (mode) {
    case "enabled":
      return ThinkingMode.ENABLED;
    case "disabled":
    default:
      return ThinkingMode.DISABLED;
  }
}

/**
 * Convert a proto {@link ThinkingMode} enum to its string form.
 *
 * `UNSPECIFIED` (and any unknown value) maps to `undefined` so callers can
 * decide their own default — matching the proto contract (`UNSPECIFIED`
 * resolves to `THINKING_MODE_DISABLED` in the runner, never the provider
 * account default).
 */
export function fromProtoThinkingMode(
  mode: ThinkingMode | undefined,
): ThinkingModeOption | undefined {
  switch (mode) {
    case ThinkingMode.DISABLED:
      return "disabled";
    case ThinkingMode.ENABLED:
      return "enabled";
    default:
      return undefined;
  }
}

/**
 * Whether the thinking switch may act on this model: the model's registry
 * entry declares a thinking form ({@link ModelInfo.thinkingCapable}). The
 * entry belongs to the harness the model runs on, so the answer holds on
 * either harness; there is no separate harness check. The one gate every
 * control and submit path uses, so a switch never renders where the server
 * would refuse the selection.
 */
export function thinkingSelectable(model: ModelInfo): boolean {
  return model.thinkingCapable === true;
}

/**
 * Whether the model always thinks ({@link ModelInfo.thinkingRequired}):
 * its switch shows on and cannot be turned off, and a submit carries
 * "enabled" for it, never "disabled", which the server refuses for such a
 * model.
 */
export function thinkingLocked(model: ModelInfo): boolean {
  return model.thinkingRequired === true;
}
