import type { ServiceTierOption } from "../models/service-tier.js";

/**
 * Owner-pinned execution config for a session surface
 * (stigmer/stigmer#664) — the client-side subset of the platform
 * `RunConfig` that AgentShare and AgentChannel specs pin server-side
 * (stigmer/stigmer#360). Budget clamps (`max_cost_usd`,
 * `max_tool_rounds`) are deliberately absent: those are enforcement,
 * which only the server can own.
 *
 * Passed to `SessionViewer` / `NewSessionViewer` (or the underlying
 * flow hooks) by embedders whose product — not the end user — decides
 * what serves the conversation: every execution on the surface (first
 * message, follow-ups, retries) carries the pinned values, and the
 * model picker hides automatically (a control that has no effect must
 * not render).
 *
 * This is presentation-level pinning for product-embedded sessions,
 * not a security boundary — a caller with the session's credentials
 * can still create executions directly. Share/channel surfaces, where
 * the audience is untrusted, get the server-enforced `RunConfig` on
 * their specs instead.
 *
 * Ignored entirely for the `"guest"` audience: guest execution config
 * is owned by the server-side share policy, and guest sends carrying
 * no `modelName` is a pinned invariant.
 */
export interface SessionRunConfig {
  /**
   * Model every execution runs, as a plain `modelId` from the model
   * registry. Wins over the composer's selection, the persisted
   * Console preference, and the last execution's model.
   */
  readonly modelName?: string;
  /**
   * Service tier for every execution. `"fast"` requires
   * {@link modelName}: the fast tier is a per-model price (the server
   * refuses it fail-closed for Auto), so a tier pin without a model
   * pin is a host configuration error and throws at submit.
   */
  readonly serviceTier?: ServiceTierOption;
}

/**
 * Fail fast on the one statically-wrong shape: `serviceTier: "fast"`
 * with no pinned model. Every layer below (composer gate, server
 * validation) would refuse it anyway — but those surface as an end
 * user's failed send, while this names the embedder's bug at the
 * seam where it was written.
 */
export function assertValidRunConfig(runConfig: SessionRunConfig): void {
  if (runConfig.serviceTier === "fast" && !runConfig.modelName) {
    throw new Error(
      "SessionRunConfig: serviceTier \"fast\" requires modelName — the fast "
        + "tier is a per-model price and Auto (no pinned model) has no tier "
        + "dimension. Pin the model the surface should run.",
    );
  }
}
