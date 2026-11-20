/**
 * What both store drivers share about resource names (interface.ts,
 * `ResourceNameStore`): the rules a driver checks before it writes, and the
 * stamps it writes, kept in one place so the two engines cannot disagree.
 * The drivers own the SQL.
 */
import type { ResourceNameRename } from "./interface.js";

/**
 * How long a rename's table move holds the names it demotes before the
 * rename commits (`commitRename`) or is undone (`revertRename`): 10 minutes.
 * A rename moves its names, writes its row, then commits or reverts, all
 * within one request, so only a rename whose process died between the two
 * steps ever waits this long; until then nothing it set aside can be taken
 * by another resource (#2926). Far beyond one attempt, so a slow database
 * does not reopen the window; short, so a crashed rename reserves a name
 * for minutes, not for good.
 */
export const UNCOMMITTED_RENAME_HOLD_MS = 10 * 60 * 1000;

/**
 * Refuses a rename onto its own name, which would leave the resource with
 * no current name: the write makes `to` current and then `from` previous,
 * and they would be the same row.
 */
export function assertRenameMoves(rename: ResourceNameRename): void {
  if (rename.from === rename.to) {
    throw new Error(
      `resource name rename of '${rename.id}' names '${rename.from}' as both its old and new name`,
    );
  }
}

/**
 * The expiry a rename's table move stamps on every name it demotes, until
 * the rename commits or is undone: held for good when the caller holds them
 * for good (""), otherwise the later of the caller's own expiry and
 * `now + UNCOMMITTED_RENAME_HOLD_MS`. A caller whose hold is that long or
 * longer (a 30-day slug) gets its own stamp at once, verbatim, and its
 * commit changes nothing.
 *
 * Both engines compare `expires_at` as text, so the times are compared
 * parsed and the provisional stamp is written as `toISOString()` writes
 * it, the format every caller's `fromExpiresAt` already has; commit and
 * revert match the exact string the move stored.
 */
export function provisionalHoldOf(rename: ResourceNameRename): string {
  if (rename.fromExpiresAt === "") {
    return "";
  }
  const provisional = Date.parse(rename.now) + UNCOMMITTED_RENAME_HOLD_MS;
  if (!(provisional > Date.parse(rename.fromExpiresAt))) {
    return rename.fromExpiresAt;
  }
  return new Date(provisional).toISOString();
}
