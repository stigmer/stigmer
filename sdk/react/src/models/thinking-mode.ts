import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
