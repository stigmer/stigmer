import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

/**
 * String literal alias for the proto {@link Harness} enum.
 *
 * Used on component props and hook options so platform builders
 * do not need to import proto enums to use the SDK.
 *
 * This union grows as new execution engines are integrated.
 * Each value must have a corresponding entry in {@link HARNESS_META}.
 */
export type HarnessOption =
  | "native"
  | "cursor"
  | "copilot"
  | "claude_code"
  | "codex"
  | "devin";

/** Display metadata for a single harness. */
export interface HarnessDisplayInfo {
  /** User-facing label shown in the harness dropdown. */
  readonly label: string;
  /** One-line description shown as a tooltip or subtitle. */
  readonly description: string;
}

/**
 * Display metadata for all registered harnesses.
 *
 * Drives the harness dropdown in {@link ModelSelector} and provides
 * labels for the compact trigger button.
 */
export const HARNESS_META: Readonly<Record<HarnessOption, HarnessDisplayInfo>> = {
  native: { label: "Stigmer", description: "Stigmer's native agent runtime" },
  cursor: { label: "Cursor", description: "Cursor IDE agent with codebase indexing" },
  copilot: { label: "GitHub Copilot", description: "GitHub-native sub-agent orchestration" },
  claude_code: { label: "Claude Agent SDK", description: "Anthropic's agent SDK with built-in tools" },
  codex: { label: "OpenAI Codex", description: "Thread-based execution with structured output" },
  devin: { label: "Devin", description: "Full autonomous engineer, session-based" },
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

/** Ordered list of all registered harness IDs. */
export const HARNESS_OPTIONS: readonly HarnessOption[] = [
  "native",
  "cursor",
  "copilot",
  "claude_code",
  "codex",
  "devin",
];

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
