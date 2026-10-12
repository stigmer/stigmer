/**
 * The Team row store's port: what the team lanes, the grant gate and the
 * removals read and write. The host's Postgres adapter is postgres-store.ts
 * beside it.
 *
 * A slug collision is the store's own typed outcome, so the handler maps it
 * to ALREADY_EXISTS without reading a driver's error. Membership is not
 * here: it is IamPolicy rows on the team, so a team row is only what
 * describes the team.
 *
 * `findAll` is a deliberate full-table read for the boot's
 * organization-link reconcile, which must see every row an organization's
 * admins manage; teams are few per organization and die with it.
 */
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";

/** The insert's two outcomes; nothing else about a new row can be in question. */
export type TeamInsertOutcome =
  | { readonly kind: "inserted" }
  | { readonly kind: "slug-taken" };

export interface TeamStore {
  /** Adds a team; `slug-taken` when the organization already holds the slug. */
  insert(team: Team): Promise<TeamInsertOutcome>;
  /** Replaces a held team's payload; the lookup columns never change after create. */
  replace(team: Team): Promise<void>;
  findById(id: string): Promise<Team | undefined>;
  /** The teams of these ids that exist, in no particular order. */
  findByIds(ids: ReadonlyArray<string>): Promise<ReadonlyArray<Team>>;
  /** The organization's teams, newest first. */
  listByOrg(org: string): Promise<ReadonlyArray<Team>>;
  /** The ids of the organization's teams (the organization delete's sweep). */
  findIdsByOrg(org: string): Promise<ReadonlyArray<string>>;
  /** Every team, oldest first (the boot's organization-link reconcile). */
  findAll(): Promise<ReadonlyArray<Team>>;
  /** Unknown id is a no-op. */
  deleteById(id: string): Promise<void>;
}
