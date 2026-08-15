import {
  CursorMemberKeyState,
  type CursorAccountSummary,
  type CursorAccountView,
  type CursorMemberKeyView,
  type CursorTeamMemberView,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";

/**
 * The account's roster coverage, grouped for the operator table. Pure
 * regrouping of server-computed facts — the membership classification
 * (`CursorMemberKeyState`) and the spend joins are computed by the
 * backend on read (the same email rule key selection uses); this module
 * must never re-derive them from emails or role strings.
 */
export interface CursorAccountCoverage {
  /**
   * Whether a roster snapshot backs the classification. Before the first
   * sync every key reports "owner unknown" — that is missing data, not
   * "not on the team", so classification is withheld (`unclassified`)
   * until a sync has run.
   */
  readonly hasRoster: boolean;
  /** On the team, execution key held — the account's routable capacity. */
  readonly onTeamWithKey: readonly CursorMemberKeyView[];
  /**
   * On the team, no execution key — the coverage gap. Sessions can never
   * run under these members' identities or included quotas. Spend comes
   * server-joined so the operator can prioritize whose key to import.
   */
  readonly onTeamWithoutKey: readonly CursorTeamMemberView[];
  /**
   * Key held, owner not on the team: either left it (roster role
   * "removed") or never appeared in the roster — the per-key state
   * distinguishes the two. Resolving this category means inviting the
   * owner on the Cursor dashboard; the next sync reclassifies.
   */
  readonly offTeamWithKey: readonly CursorMemberKeyView[];
  /** Every key, only while no roster snapshot exists (empty otherwise). */
  readonly unclassified: readonly CursorMemberKeyView[];
}

/**
 * Group one account view into the three coverage categories (plus the
 * pre-first-sync "unclassified" holding state). Server order is
 * preserved within each group.
 */
export function deriveCoverage(view: CursorAccountView): CursorAccountCoverage {
  const hasRoster = view.snapshot !== undefined;

  if (!hasRoster) {
    return {
      hasRoster,
      onTeamWithKey: [],
      onTeamWithoutKey: [],
      offTeamWithKey: [],
      unclassified: view.keyViews,
    };
  }

  return {
    hasRoster,
    onTeamWithKey: view.keyViews.filter(
      (kv) => kv.state === CursorMemberKeyState.member_key_active,
    ),
    onTeamWithoutKey: view.membersWithoutKeysViews,
    offTeamWithKey: view.keyViews.filter(
      (kv) => kv.state !== CursorMemberKeyState.member_key_active,
    ),
    unclassified: [],
  };
}

/**
 * Fleet-wide health rolled up from the list summaries — the console's
 * answer to "can the platform serve right now, and from where?". Pure
 * aggregation of the server-computed routable/guard counts (the same
 * routability rule key selection uses); this module must never
 * re-derive routability client-side.
 *
 * <p>Why this exists: in the 2026-08-15 pool drain, the list showed
 * five accounts with healthy-looking enabled-key counts while exactly
 * one guard-tripped key could serve — the operator had to open every
 * account detail to see it. The rollup makes fleet exhaustion a
 * one-line fact.
 */
export interface CursorPoolHealth {
  /** Total accounts in the list. */
  readonly totalAccounts: number;
  /** Keys the routability rule would select for a new session, fleet-wide. */
  readonly totalRoutableKeys: number;
  /**
   * Enabled accounts with enabled keys but zero routable ones — every
   * key is dead (owner removed) or usage-drained. These are the rows
   * that look healthy at a glance and are not.
   */
  readonly drainedAccounts: number;
  /** Enabled keys excluded only by the usage guard, fleet-wide. */
  readonly guardTrippedKeys: number;
}

/** Aggregate the server-computed summary counts across the account list. */
export function derivePoolHealth(
  summaries: readonly CursorAccountSummary[],
): CursorPoolHealth {
  let totalRoutableKeys = 0;
  let drainedAccounts = 0;
  let guardTrippedKeys = 0;
  for (const summary of summaries) {
    totalRoutableKeys += summary.routableKeyCount;
    guardTrippedKeys += summary.guardTrippedKeyCount;
    if (
      summary.account?.enabled === true
      && summary.enabledKeyCount > 0
      && summary.routableKeyCount === 0
    ) {
      drainedAccounts += 1;
    }
  }
  return {
    totalAccounts: summaries.length,
    totalRoutableKeys,
    drainedAccounts,
    guardTrippedKeys,
  };
}
