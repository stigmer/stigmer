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
 * Unlike the fast tier, thinking is NOT separately priced: the cost of ENABLED is the extra reasoning tokens, billed as output.
 * Selection is therefore capability-gated (registry capabilities.thinking)
 * rather than pricing-gated, and the estimate/billing paths need no
 * thinking-specific rates.
 *
 * Each harness translates the mode in its own dialect: the Stigmer harness
 * as its provider's request parameter in the form the model's
 * Stigmer-harness registry row declares (Anthropic's `thinking`,
 * {@link toAnthropicThinking}; Google's thinking budget,
 * {@link toGoogleThinking}; `model-client.ts` picks by provider). ENABLED
 * means "the model reasons before it answers", whichever form the row takes.
 *
 * One model family breaks the "always explicit" rule on purpose: a row
 * that states `thinkingRequired` names a model that always thinks and
 * refuses `{type: "disabled"}` with a 400. Create-time validation refuses
 * an explicit DISABLED there, and the runner sends the model's thinking
 * form whatever the mode, so its reasoning streams as text rather than the
 * empty blocks the model's own `display` default produces.
 */

import type { ThinkingConfigParam } from "@anthropic-ai/sdk/resources/messages";
import type { ChatGoogleParams } from "@langchain/google";
import { ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import type { LlmProvider } from "./llm-proxy.js";
import type { ThinkingProfile } from "./model-registry.js";

/** An execution's thinking, as a model is built for it: the effective mode and the model's Stigmer row. */
export interface ThinkingRequest {
  readonly mode: EffectiveThinkingMode;
  readonly profile: ThinkingProfile | undefined;
}

/**
 * Google's thinking, as LangChain's Google client takes it: a token budget.
 * The client writes the request's `thinkingConfig` from it, per model
 * generation (`thinkingBudget` for Gemini 2.5, the matching `thinkingLevel`
 * for Gemini 3), with `includeThoughts` on unless the budget is zero; the
 * client's own `thinkingConfig` field never reaches the request.
 */
export type GoogleThinking = Required<Pick<ChatGoogleParams, "thinkingBudget">>;

/** Google's budget for "the model picks its own depth" (dynamic thinking). */
export const GOOGLE_DYNAMIC_THINKING_BUDGET = -1;

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
 * The Stigmer harness's request `thinking` parameter for an execution's
 * effective mode on a model's Stigmer row, or `undefined` to send none.
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
  profile: ThinkingProfile | undefined,
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
 * Google's thinking for an execution's effective mode on a model's Stigmer
 * row, or `undefined` to send none, by the same rules as
 * {@link toAnthropicThinking}:
 *
 * - A row that requires thinking, or ENABLED, gets the row's form: adaptive
 *   is the model picking its own depth ({@link GOOGLE_DYNAMIC_THINKING_BUDGET}),
 *   the fixed budget is {@link BUDGET_THINKING_TOKENS}. Either way the
 *   model's reasoning streams back with its answer.
 * - DISABLED gets a zero budget only where the row declares a form and
 *   states `thinkingRequired: false`; a Gemini model that cannot stop
 *   thinking is a row that says it requires it.
 * - No row sends nothing, and the model thinks by its own default.
 */
export function toGoogleThinking(
  mode: EffectiveThinkingMode,
  profile: ThinkingProfile | undefined,
): GoogleThinking | undefined {
  if (profile === undefined) return undefined;
  if (profile.required === true || mode === ThinkingMode.ENABLED) {
    switch (profile.shape) {
      case "adaptive":
        return { thinkingBudget: GOOGLE_DYNAMIC_THINKING_BUDGET };
      case "budget":
        return { thinkingBudget: BUDGET_THINKING_TOKENS };
      case "none":
        return undefined;
    }
  }
  return profile.required === false && profile.shape !== "none" ? { thinkingBudget: 0 } : undefined;
}

/**
 * Whether a provider refuses a forced tool choice while its model thinks:
 * Anthropic does, on every platform and model, so a thinking graph there
 * answers structured output in the provider's own JSON form; Google's
 * function calling takes a forced choice with thinking on. OpenAI keeps the
 * answer it has always had here: it has no thinking mapping on this harness
 * (`model-client.ts` refuses one), and its structured output under thinking
 * is stigmer#3322.
 */
const REFUSES_FORCED_TOOL_WHILE_THINKING: Readonly<Record<LlmProvider, boolean>> = {
  anthropic: true,
  openai: true,
  google: false,
};

/**
 * Whether a graph on this provider and row must answer structured output
 * without a forced tool: it thinks, and its provider refuses a forced tool
 * while it does.
 */
export function thinkingRefusesForcedTool(provider: LlmProvider, mode: EffectiveThinkingMode, profile: ThinkingProfile | undefined): boolean {
  return REFUSES_FORCED_TOOL_WHILE_THINKING[provider] && graphThinks(mode, profile);
}

/**
 * Whether a graph built on this row reasons natively: true exactly when
 * {@link toAnthropicThinking} asks for thinking. Derived from the same
 * mapping, never decided separately, so the structured output strategy can
 * never disagree with the wire. {@link toGoogleThinking} asks for thinking
 * on exactly the same rows.
 */
export function graphThinks(
  mode: EffectiveThinkingMode,
  profile: ThinkingProfile | undefined,
): boolean {
  const thinking = toAnthropicThinking(mode, profile);
  return thinking !== undefined && thinking.type !== "disabled";
}
