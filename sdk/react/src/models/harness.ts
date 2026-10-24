import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

/**
 * String literal alias for the proto {@link Harness} enum.
 *
 * Used on component props and hook options so platform builders
 * do not need to import proto enums to use the SDK. Exactly the
 * engines the proto names; it grows only when the proto enum does.
 * A named engine is not necessarily an offered one: the pickers offer
 * {@link HARNESS_OPTIONS}.
 */
export type HarnessOption = "native" | "cursor" | "claude";

/**
 * The proto {@link Harness} member for each option — the one table the
 * option set is read from, so the SDK can never offer an engine the proto
 * does not name (stigmer/stigmer#1143: four extra options once mapped
 * silently to NATIVE). Listed in proto enum order.
 */
const HARNESS_BY_OPTION = {
  native: Harness.NATIVE,
  cursor: Harness.CURSOR,
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
  [Harness.NATIVE]: "native",
  [Harness.CURSOR]: "cursor",
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
 * server ran on an engine this build does not offer still shows its name).
 *
 * Drives the harness dropdown in {@link ModelSelector} and provides
 * labels for the compact trigger button.
 */
export const HARNESS_META: Readonly<Record<HarnessOption, HarnessDisplayInfo>> = {
  native: { label: "Stigmer", description: "Stigmer's native agent runtime" },
  cursor: { label: "Cursor", description: "Cursor IDE agent with codebase indexing" },
  claude: { label: "Claude", description: "Powered by Claude" },
};

/**
 * User-facing labels for each harness option.
 *
 * @deprecated Use {@link HARNESS_META} instead for full display metadata.
 * Kept for backward compatibility with existing consumers.
 */
export const HARNESS_LABELS: Readonly<Record<HarnessOption, string>> = Object.fromEntries(
  Object.entries(HARNESS_META).map(([k, v]) => [k, v.label]),
) as Record<HarnessOption, string>;

/**
 * The engines the platform offers, in proto enum order: what every picker
 * lists. A subset of the named engines, kept by hand because offering an
 * engine is a product decision, not a fact of the proto: Claude is named
 * but not offered until the server runs it, and the server refuses it
 * until then.
 */
export const HARNESS_OPTIONS: readonly HarnessOption[] = ["native", "cursor"];

/** Platform default — resolves to the native engine. */
export const DEFAULT_HARNESS: HarnessOption = "native";

/**
 * Whether a string names an engine the platform offers — the check for a
 * value the SDK did not write itself (a stored preference, a URL
 * parameter), which may name an engine this platform does not run or does
 * not offer yet; a picker must never preselect either.
 */
export function isHarnessOption(value: string): value is HarnessOption {
  return (HARNESS_OPTIONS as readonly string[]).includes(value);
}

/** Whether a string names an engine the proto names, offered or not (a registry entry's section). */
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
 * `UNSPECIFIED` and any unknown values map to `"native"`.
 */
export function fromProtoHarness(h: Harness): HarnessOption {
  // A wire value may be UNSPECIFIED, or an engine newer than this build.
  const known: Partial<Record<Harness, HarnessOption>> = OPTION_BY_HARNESS;
  return known[h] ?? DEFAULT_HARNESS;
}
