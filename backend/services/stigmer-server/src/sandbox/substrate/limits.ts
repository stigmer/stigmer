/**
 * The bounds the substrate driver's ensure, its sweep and its configuration
 * share. First, how long a paused runner may sleep and still be woken in
 * place.
 *
 * A paused actor keeps its runner's memory, and with it the runner's
 * credential. A running runner renews a renewable credential once it has
 * lived 80% of its issued lifetime (the runner's
 * sandbox-token-renewal.ts), so a renewable 4-hour credential always has
 * at least 48 minutes left; a frozen runner renews nothing. A pause no
 * longer than 30 minutes therefore always wakes a runner whose credential
 * is still renewable. An older pause is suspended to storage and started
 * fresh instead, with the credential the waking turn pushes, and the
 * idle windows may not hold a pause longer than this (config.ts).
 */
export const MAX_IN_PLACE_PAUSE_SECONDS = 30 * 60;

/**
 * How far Substrate's clock and this server's may disagree. The driver
 * compares Substrate's stamps (an actor's creation, its pause) with its own
 * clock (when a session scan began, when this process started), and leans
 * the safe way by this much: a sandbox created up to a minute before a scan
 * counts as newer than it, so it is never taken for an orphan; a pause up to
 * a minute after this process started counts as older, so it is started
 * fresh rather than thawed.
 */
export const CLOCK_SKEW_ALLOWANCE_MS = 60_000;
