/**
 * How far Substrate's clock and this server's may disagree. The sweep
 * compares Substrate's stamp of an actor's creation with its own clock
 * (when a session scan began), and leans the safe way by this much: a
 * sandbox created up to a minute before a scan counts as newer than it, so
 * it is never taken for an orphan.
 */
export const CLOCK_SKEW_ALLOWANCE_MS = 60_000;

/**
 * How long after this server first sees a sandbox's worker draining it
 * waits for the session to go quiet before storing the sandbox anyway,
 * ending the turn in flight (idle-decision.ts). Substrate gives a leaving
 * worker's actors 30 minutes to be suspended (its API guide, "Eviction");
 * twenty leaves room for a sweep pass to see the drain late and for the
 * durable suspend's upload. Substrate records no drain time, so the clock
 * starts at this process's first sight of the drain (driver.ts,
 * `draining`).
 */
export const DRAIN_DEADLINE_MS = 20 * 60_000;
