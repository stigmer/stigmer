/**
 * Ask AI wiring constants.
 *
 * `ORG`/`AGENT` name the public AgentShare and `APP_ORIGIN` the Stigmer app
 * that hosts its chat page — they mirror the deployed share definition in
 * `docs-agent/shares/stigmer-docs.yaml` (the source of truth; change that
 * first, then this). Hardcoded absolutes, matching the `ScenarEmbed`
 * precedent: the docs site is a single-origin static export with no
 * environment plumbing, and a relative or env-derived value would only add a
 * way to be wrong.
 */

export const ASK_AI_ORG = "stigmer";
export const ASK_AI_AGENT = "stigmer-docs";
export const ASK_AI_APP_ORIGIN = "https://app.stigmer.ai";

/**
 * How long to wait for the embed's `stigmer:ready` / `stigmer:refused`
 * signal before declaring the chat unavailable. `ready` fires on the guest
 * token mint (fast), not on the agent's first answer (slow) — so this only
 * trips when the hosted app is unreachable and the iframe would otherwise
 * sit blank forever.
 */
export const ASK_AI_READY_TIMEOUT_MS = 15_000;
