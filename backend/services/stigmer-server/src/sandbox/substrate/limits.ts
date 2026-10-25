/**
 * How far Substrate's clock and this server's may disagree. The sweep
 * compares Substrate's stamp of an actor's creation with its own clock
 * (when a session scan began), and leans the safe way by this much: a
 * sandbox created up to a minute before a scan counts as newer than it, so
 * it is never taken for an orphan.
 */
export const CLOCK_SKEW_ALLOWANCE_MS = 60_000;
