// How long something took or has been going, as every surface says it (the
// session view, the terminal, the CLI). A module of its own, with nothing
// else in it, so a surface that only says a duration loads only this.

/**
 * A span of time in at most two units, the larger first, the smaller always
 * two digits so a ticking time keeps its width: "42s", "1m 05s", "15m 00s",
 * "1h 03m", "2d 05h". Every surface that says how long something took or has
 * been going says it this way (the session view, the terminal, the CLI).
 * Seconds are floored, so a span never reads longer than it was; a negative
 * span reads "0s".
 */
export function formatElapsed(ms: number): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${two(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${two(minutes % 60)}m`;
  return `${Math.floor(hours / 24)}d ${two(hours % 24)}h`;
}
