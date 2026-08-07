/**
 * Liveness for the conversation surface is POLLING in v1 — no streaming
 * or watch RPC exists on the conversation query controller. These two
 * constants are the deliberate seam the liveness task (channel
 * conversations T05) replaces with its event contract: hooks default to
 * them, consumers may override per instance, and when push-shaped
 * liveness lands the defaults change here without touching a consumer.
 */

/** Default poll interval for the org-wide conversation list. */
export const CONVERSATION_LIST_POLL_INTERVAL_MS = 20_000;

/**
 * Default poll interval for the OPEN conversation (its row and its
 * timeline head). Tighter than the list on purpose: this is where a
 * teammate's takeover or the customer's next message must appear while
 * a human is watching.
 */
export const CONVERSATION_DETAIL_POLL_INTERVAL_MS = 5_000;
