/**
 * The Team row store's port: what the team lanes, the grant gate and the
 * removals read and write. The host's Postgres adapter is postgres-store.ts
 * beside it.
 *
 * A slug collision is the store's own typed outcome, so the handler maps it
 * to ALREADY_EXISTS without reading a driver's error. Membership is not
 * here: it is Grant rows on the team, so a team row is only what
 * describes the team.
 *
 * A team's slug is rename's alone (`@stigmer/server`'s rename chain over
 * `modifyById`). The update chain writes through the guarded write
 * (`readForWrite` and `swap`, `@stigmer/server`'s store/guarded-port.ts):
 * the swap lands only while the row is as the chain read it, so a rename
 * or any other write in between makes the update run again from a fresh
 * read rather than be undone.
 *
 * `findAll` is a deliberate full-table read for the boot's
 * organization-link reconcile, which must see every row an organization's
 * admins manage; teams are few per organization and die with it.
 *
 * `pageByOrg` is the organization's list as a row source for the library's
 * page loop (`readPage`): newest first, ties broken by id in byte order,
 * continuing strictly after a cursor. The cursor comes back from the client
 * inside an unsigned page token, so it can be any text: one the store would
 * never render continues nothing, an empty page, rather than a fault.
 */
import type { Team } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import type { GuardedWritePort, ListIndexCursor, ListIndexRow } from "@stigmer/server";

/** The insert's two outcomes; nothing else about a new row can be in question. */
export type TeamInsertOutcome =
  | { readonly kind: "inserted" }
  | { readonly kind: "slug-taken" };

export interface TeamStore extends GuardedWritePort<Team> {
  /** Adds a team; `slug-taken` when the organization already holds the slug. */
  insert(team: Team): Promise<TeamInsertOutcome>;
  /**
   * Atomic read-modify-write by id under the row's lock: `modify` mutates
   * the stored team in place (synchronously), and the payload and the slug
   * column are written together. Answers the written team; an unknown id
   * answers undefined and writes nothing.
   */
  modifyById(
    id: string,
    modify: (team: Team) => void,
  ): Promise<Team | undefined>;
  findById(id: string): Promise<Team | undefined>;
  /** The teams of these ids that exist, in no particular order. */
  findByIds(ids: ReadonlyArray<string>): Promise<ReadonlyArray<Team>>;
  /**
   * The organization's rows after `after` (from the newest when undefined),
   * newest first and ids in byte order, at most `limit` (every one when
   * undefined): the list's row source.
   */
  pageByOrg(
    org: string,
    after: ListIndexCursor | undefined,
    limit: number | undefined,
  ): Promise<ReadonlyArray<ListIndexRow>>;
  /** The ids of the organization's teams (the organization delete's sweep). */
  findIdsByOrg(org: string): Promise<ReadonlyArray<string>>;
  /** Every team, oldest first (the boot's organization-link reconcile). */
  findAll(): Promise<ReadonlyArray<Team>>;
  /** Unknown id is a no-op. */
  deleteById(id: string): Promise<void>;
}
