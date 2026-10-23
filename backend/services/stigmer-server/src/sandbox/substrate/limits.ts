/**
 * The bounds the substrate driver's sweep and its configuration share.
 * First, how long a sandbox may stay paused before it is suspended.
 *
 * A paused actor's workspace lives only on its node until a suspend
 * commits it to storage (template.ts), so a node lost while a sandbox is
 * paused loses what its session wrote since its last suspend. The idle
 * windows may not hold a pause longer than this (config.ts). On Substrate
 * 0.3 a pause also froze the runner with its credential, and 30 minutes
 * was the longest a frozen runner could sleep and still renew a 4-hour
 * one; every wake now starts a fresh runner, and the bound stays for the
 * workspace's sake.
 */
export const MAX_IN_PLACE_PAUSE_SECONDS = 30 * 60;

/**
 * How far Substrate's clock and this server's may disagree. The sweep
 * compares Substrate's stamp of an actor's creation with its own clock
 * (when a session scan began), and leans the safe way by this much: a
 * sandbox created up to a minute before a scan counts as newer than it, so
 * it is never taken for an orphan.
 */
export const CLOCK_SKEW_ALLOWANCE_MS = 60_000;
