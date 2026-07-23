import {
  CursorMemberKeyState,
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
