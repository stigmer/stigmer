/**
 * The one bound the substrate driver's ensure and its configuration
 * share: how long a paused runner may sleep and still be woken in place.
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
