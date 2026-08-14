/**
 * Harness-neutral service-tier semantics (stigmer/stigmer#357, extended to
 * the native harness by #361).
 *
 * The platform contract: an execution's price-bearing tier is ALWAYS
 * explicit by the time a provider request leaves the runner. UNSPECIFIED
 * resolves to STANDARD here and ONLY here — every upstream layer preserves
 * the caller's raw enum so "user chose standard" stays distinguishable
 * from "platform default" all the way to the ledger.
 *
 * Each harness owns its translation of the EFFECTIVE tier into provider
 * wire terms:
 *   - Cursor: explicit `ModelSelection.params` pinning the price-bearing
 *     variant booleans (`execute-cursor/service-tier.ts`).
 *   - Native: the provider's own request parameter, mapped in
 *     `model-client.ts` (`toOpenAiServiceTier` / `toAnthropicServiceTier`
 *     below) so no construction site can invent a third mapping.
 */

import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * The effective tier after platform-default resolution: never UNSPECIFIED.
 */
export type EffectiveServiceTier = ServiceTier.STANDARD | ServiceTier.FAST;

/**
 * Resolve the configured tier to its effective value. The single place in
 * the platform where UNSPECIFIED becomes STANDARD.
 */
export function resolveEffectiveServiceTier(
  configured: ServiceTier | undefined,
): EffectiveServiceTier {
  return configured === ServiceTier.FAST ? ServiceTier.FAST : ServiceTier.STANDARD;
}

/** Human-readable tier label for logs and error messages. */
export function serviceTierLabel(tier: ServiceTier): string {
  switch (tier) {
    case ServiceTier.FAST:
      return "fast";
    case ServiceTier.STANDARD:
      return "standard";
    default:
      return "unspecified";
  }
}

/**
 * OpenAI's `service_tier` request parameter for the effective tier.
 *
 * STANDARD maps to "default", NOT "auto": "auto" lets the ACCOUNT's
 * project settings pick the processing tier — the exact
 * account-default-decides-the-price hole #357 closed on the Cursor
 * harness. FAST maps to "priority" (pay-as-you-go priority processing);
 * create-time validation makes FAST unreachable until a registry entry
 * prices it, so today's traffic always sends "default". "flex" (cheaper,
 * slower) is a possible future tier, deliberately unmapped.
 */
export function toOpenAiServiceTier(tier: EffectiveServiceTier): "default" | "priority" {
  return tier === ServiceTier.FAST ? "priority" : "default";
}

/**
 * Anthropic's `service_tier` request parameter for the effective tier.
 *
 * STANDARD maps to "standard_only": never consume priority-tier capacity,
 * so the bill is the public standard rate regardless of what the account
 * has purchased. FAST maps to "auto" — Anthropic's priority tier is
 * PURCHASED capacity, and "auto" means "use it when available"; the
 * response's `usage.service_tier` reports what actually served, which is
 * what billing reconciles against. FAST is unreachable until a registry
 * entry prices it (and the platform buys priority capacity — the #361
 * half-2 hold).
 */
export function toAnthropicServiceTier(tier: EffectiveServiceTier): "auto" | "standard_only" {
  return tier === ServiceTier.FAST ? "auto" : "standard_only";
}
