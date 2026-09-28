/**
 * Harness-neutral thinking-mode semantics (stigmer/stigmer#772) — the
 * second variant dimension alongside `shared/service-tier.ts`.
 *
 * The platform contract mirrors the service tier's: the thinking pin is
 * ALWAYS explicit by the time a provider request leaves the runner.
 * UNSPECIFIED resolves to DISABLED here and ONLY here — every upstream
 * layer preserves the caller's raw enum so "user chose disabled" stays
 * distinguishable from "platform default" all the way to the ledger.
 *
 * Unlike the fast tier, thinking is NOT separately priced: Cursor bills
 * thinking variants at base per-token rates (ledger-verified 2026-08-15 —
 * 277 events at exactly base; thinking+fast at exactly the fast rate).
 * The cost of ENABLED is the extra reasoning tokens, billed as output.
 * Selection is therefore capability-gated (registry capabilities.thinking)
 * rather than pricing-gated, and the estimate/billing paths need no
 * thinking-specific rates.
 *
 * Each harness translates the mode in its own dialect: the Cursor harness
 * as the explicit `thinking` variant parameter
 * (`execute-cursor/service-tier.ts`), the native harness as Anthropic's
 * `thinking` request parameter in the form the model's native registry row
 * declares ({@link toAnthropicThinking}). ENABLED means "the model reasons
 * before it answers", whichever form the row takes.
 *
 * One model family breaks the "always explicit" rule on purpose: a row
 * that states `thinkingRequired` names a model that always thinks and
 * refuses `{type: "disabled"}` with a 400. Create-time validation refuses
 * an explicit DISABLED there, and the runner sends the model's thinking
 * form whatever the mode, so its reasoning streams as text rather than the
 * empty blocks the model's own `display` default produces.
 */

import type { ThinkingConfigParam } from "@anthropic-ai/sdk/resources/messages";
import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { NativeThinkingProfile } from "./model-registry.js";

/**
 * The effective mode after platform-default resolution: never UNSPECIFIED.
 */
export type EffectiveThinkingMode = ThinkingMode.DISABLED | ThinkingMode.ENABLED;

/**
 * Resolve the configured mode to its effective value. The single place in
 * the platform where UNSPECIFIED becomes DISABLED.
 */
export function resolveEffectiveThinkingMode(
  configured: ThinkingMode | undefined,
): EffectiveThinkingMode {
  return configured === ThinkingMode.ENABLED ? ThinkingMode.ENABLED : ThinkingMode.DISABLED;
}

/** Human-readable mode label for logs and error messages. */
export function thinkingModeLabel(mode: ThinkingMode): string {
  switch (mode) {
    case ThinkingMode.ENABLED:
      return "enabled";
    case ThinkingMode.DISABLED:
      return "disabled";
    default:
      return "unspecified";
  }
}

/**
 * The thinking budget sent to a model whose row declares the fixed-budget
 * form. One platform constant, not a user choice (per-execution budgets are
 * a later proto change): 16,000 tokens is room for a real plan while
 * leaving every budget row's output ceiling (64,000 on the smallest) most
 * of its length for the answer. The provider requires at least 1,024 and
 * less than `max_tokens`. No interleaved-thinking beta rides with it: the
 * hosted proxy forwards no `anthropic-beta` header, so these models think
 * at the start of each model call, not between tool calls.
 */
export const BUDGET_THINKING_TOKENS = 16_000;

/**
 * The native request's `thinking` parameter for an execution's effective
 * mode on a model's native row, or `undefined` to send none.
 *
 * - A row that requires thinking gets its thinking form whatever the mode;
 *   the model thinks either way, and `display: "summarized"` is what makes
 *   its reasoning readable (the newest models default to `"omitted"`).
 * - ENABLED gets the row's form: adaptive with `display: "summarized"`, or
 *   the fixed budget. A row that declares no form gets nothing; create-time
 *   validation refuses ENABLED there, so this is the fail-safe.
 * - DISABLED gets an explicit `{type: "disabled"}` only where the row
 *   declares a thinking form and states `thinkingRequired: false`. Where the
 *   flag was never assessed nothing is sent (the request as it was before),
 *   because sending `disabled` to a model that requires thinking fails every
 *   turn; a row with no thinking form has no parameter to pin.
 * - No row (an unreachable registry, an unknown model) sends nothing.
 */
export function toAnthropicThinking(
  mode: EffectiveThinkingMode,
  profile: NativeThinkingProfile | undefined,
): ThinkingConfigParam | undefined {
  if (profile === undefined) return undefined;
  if (profile.required === true || mode === ThinkingMode.ENABLED) {
    switch (profile.shape) {
      case "adaptive":
        return { type: "adaptive", display: "summarized" };
      case "budget":
        return { type: "enabled", budget_tokens: BUDGET_THINKING_TOKENS };
      case "none":
        return undefined;
    }
  }
  return profile.required === false && profile.shape !== "none" ? { type: "disabled" } : undefined;
}

/**
 * Whether a graph built on this row reasons natively: true exactly when
 * {@link toAnthropicThinking} asks for thinking. Derived from the same
 * mapping, never decided separately, so the `think` tool and the structured
 * output strategy can never disagree with the wire.
 */
export function graphThinks(
  mode: EffectiveThinkingMode,
  profile: NativeThinkingProfile | undefined,
): boolean {
  const thinking = toAnthropicThinking(mode, profile);
  return thinking !== undefined && thinking.type !== "disabled";
}
