import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

/**
 * String literal alias for the proto {@link Harness} enum.
 *
 * Used on component props and hook options so platform builders
 * do not need to import proto enums to use the SDK. Exactly the
 * harnesses the proto names; it grows only when the proto enum does.
 * A named harness is not necessarily an offered one: the pickers offer
 * {@link HARNESS_OPTIONS}.
 */
export type HarnessOption = "stigmer" | "claude";

/**
 * The proto {@link Harness} member for each option — the one table the
 * option set is read from, so the SDK can never offer an engine the proto
 * does not name (stigmer/stigmer#1143: four extra options once mapped
 * silently to the Stigmer harness). Listed in proto enum order.
 */
const HARNESS_BY_OPTION = {
  stigmer: Harness.STIGMER,
  claude: Harness.CLAUDE,
} as const satisfies Record<HarnessOption, Exclude<Harness, Harness.UNSPECIFIED>>;

/**
 * The reverse of {@link HARNESS_BY_OPTION}, keyed by every engine the proto
 * names. Typed over the whole enum (minus UNSPECIFIED), so a member added
 * to the proto is a compile error here until it has an option — and then
 * in {@link HARNESS_BY_OPTION} and {@link HARNESS_META} until it has an
 * entry in each.
 */
const OPTION_BY_HARNESS: Readonly<Record<Exclude<Harness, Harness.UNSPECIFIED>, HarnessOption>> = {
  [Harness.STIGMER]: "stigmer",
  [Harness.CLAUDE]: "claude",
};

/** Display metadata for a single harness. */
export interface HarnessDisplayInfo {
  /** User-facing label shown in the harness dropdown. */
  readonly label: string;
  /** One-line description shown as a tooltip or subtitle. */
  readonly description: string;
}

/**
 * Display metadata for every named harness, offered or not (a session the
 * server ran on a harness this build does not offer still shows its name).
 *
 * Drives the harness dropdown in {@link ModelSelector} and provides
 * labels for the compact trigger button.
 */
export const HARNESS_META: Readonly<Record<HarnessOption, HarnessDisplayInfo>> = {
  stigmer: { label: "Stigmer", description: "Stigmer's own harness: runs any catalog model, open source end to end" },
  claude: { label: "Claude Agent", description: "Anthropic's Claude Agent SDK: Claude models on your Anthropic key" },
};

/**
 * The harnesses the platform offers, in proto enum order: what every
 * picker lists. Kept by hand because offering a harness is a product
 * decision, not a fact of the proto: a harness is named before it is
 * offered, and the server refuses one it does not offer. Every named
 * harness is offered today.
 */
export const HARNESS_OPTIONS: readonly HarnessOption[] = ["stigmer", "claude"];

/** Platform default — resolves to the Stigmer harness (`"stigmer"`). */
export const DEFAULT_HARNESS: HarnessOption = "stigmer";

/**
 * Whether a string names a harness the platform offers — the check for a
 * value the SDK did not write itself (a stored preference, a URL
 * parameter), which may name a harness this platform does not run or does
 * not offer yet; a picker must never preselect either.
 */
export function isHarnessOption(value: string): value is HarnessOption {
  return (HARNESS_OPTIONS as readonly string[]).includes(value);
}

/** Whether a string names a harness the proto names, offered or not (a registry entry's section). */
export function isNamedHarness(value: string): value is HarnessOption {
  return Object.hasOwn(HARNESS_BY_OPTION, value);
}

/** Convert a {@link HarnessOption} string to the proto {@link Harness} enum. */
export function toProtoHarness(h: HarnessOption): Harness {
  return HARNESS_BY_OPTION[h];
}

/**
 * Convert a proto {@link Harness} enum to a {@link HarnessOption} string.
 *
 * `UNSPECIFIED` and any unknown values map to `"stigmer"`.
 */
export function fromProtoHarness(h: Harness): HarnessOption {
  // A wire value may be UNSPECIFIED, or an engine newer than this build.
  const known: Partial<Record<Harness, HarnessOption>> = OPTION_BY_HARNESS;
  return known[h] ?? DEFAULT_HARNESS;
}
