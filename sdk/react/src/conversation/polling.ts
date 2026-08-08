/**
 * Liveness for the conversation surface is HONEST POLLING (channel-
 * conversations DD-012) — no streaming or watch RPC exists on the
 * conversation query controller, and none ships until a revisit trigger
 * fires (a real push consumer, or sub-second liveness becoming a product
 * property). These constants are the deliberate transport seam: hooks
 * default to them, consumers may override per instance, and when
 * push-shaped liveness lands the defaults change here without touching a
 * consumer.
 *
 * The latency budget is a stated contract (DD-012 D-b), not an accident
 * of three numbers:
 *
 * | Surface                                  | Budget                       | Mechanism                                        |
 * | ---------------------------------------- | ---------------------------- | ------------------------------------------------ |
 * | Your own action (take over, hand back,   | immediate                    | command answer applied to the detail AND list    |
 * | dismiss, reply)                          |                              | `applyServerState` seams — zero polls involved   |
 * | The open conversation (row + timeline)   | ≤ 5s                         | detail polls                                     |
 * | The inbox list                           | ≤ 20s, immediate on refocus  | list poll + focus refetch                        |
 * | The nav badge                            | ≤ 60s, immediate on refocus  | count poll (the filtered list's `total_count`)   |
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

/**
 * Default poll interval for the sidebar's wants-human count. Deliberately
 * the slowest budget on the surface: a badge tolerates staleness an open
 * inbox does not, it renders on every console page in every tab, and each
 * tick pays an FGA ListObjects before the count (DD-011 D-g's stated
 * price). Focus refetch keeps it honest at the moment someone returns.
 */
export const CONVERSATION_BADGE_POLL_INTERVAL_MS = 60_000;
