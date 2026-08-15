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
 * v1 translates thinking on the Cursor harness only (the explicit
 * `thinking` variant parameter, `execute-cursor/service-tier.ts`). No
 * native wire mapping exists yet — create-time validation refuses ENABLED
 * for native-harness models, mirroring the tier's #361 posture.
 */

import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
