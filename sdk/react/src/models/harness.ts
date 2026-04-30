import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

/**
 * String literal alias for the proto {@link Harness} enum.
 *
 * Used on component props and hook options so platform builders
 * do not need to import proto enums to use the SDK.
 */
export type HarnessOption = "native" | "cursor";

/** User-facing labels for each harness option. */
export const HARNESS_LABELS: Readonly<Record<HarnessOption, string>> = {
  native: "Stigmer",
  cursor: "Cursor",
};

/** Platform default — resolves to the native engine. */
export const DEFAULT_HARNESS: HarnessOption = "native";

/** Convert a {@link HarnessOption} string to the proto {@link Harness} enum. */
export function toProtoHarness(h: HarnessOption): Harness {
  switch (h) {
    case "cursor":
      return Harness.CURSOR;
    case "native":
    default:
      return Harness.NATIVE;
  }
}

/**
 * Convert a proto {@link Harness} enum to a {@link HarnessOption} string.
 *
 * `UNSPECIFIED` and any unknown values map to `"native"`.
 */
export function fromProtoHarness(h: Harness): HarnessOption {
  switch (h) {
    case Harness.CURSOR:
      return "cursor";
    case Harness.NATIVE:
    case Harness.UNSPECIFIED:
    default:
      return "native";
  }
}
