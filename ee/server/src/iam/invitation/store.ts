/**
 * The Invitation row store's port: what the invitation lanes and the
 * removals read and write. The host's Postgres adapter is postgres-store.ts
 * beside it.
 *
 * recordRedemption is THE load-bearing method, because two concurrent
 * redemptions of the last seat must not both succeed: increment, append,
 * and, when the PERSISTED count reaches the max, flip to fully_redeemed,
 * atomically, guarded on still-active-and-under-max (the guard reads the
 * persisted row, never the caller's stale copy). A `refused` answer means
 * the guard rejected: the slot race was lost or the invitation was
 * concurrently revoked or deleted.
 *
 * revoke writes the revoked state onto the row under the same row lock, so
 * a redemption recorded between the revoke's read and its write is never
 * undone (nor counted twice): it answers the revoked post-image, the row as
 * it was when it was already revoked, or undefined when the row is gone.
 *
 * releaseRedemption is its undo, for a redemption whose grant failed after
 * it was recorded (the handler records before it grants): atomically it
 * removes one ledger entry matching the person and the recorded instant,
 * decrements the count, and returns a fully_redeemed latch to active only
 * when this removal brings the count back under the limit. It never reopens
 * a revoked row, and an expired one stays refused by its expiry. The ledger
 * keeps whole seconds (`ledgerSeconds`), so two entries by one person in
 * one second are identical, and removing either is the same act. A row
 * that is gone, or holds no such entry, is answered `absent` and nothing is
 * written.
 *
 * `pageByOrg` is the organization's list as a row source for the library's
 * page loop (`readPage`): newest first, ties broken by id in byte order,
 * continuing strictly after a cursor. The cursor comes back from the
 * client inside an unsigned page token, so it can be any text: one the
 * store would never render continues nothing, an empty page, rather than a
 * fault the page loop would report as INTERNAL. `findIdsByOrg` is the
 * organization delete's sweep. `findAll` is a deliberate full-table read
 * for the boot's organization-link reconcile, which must see every row an
 * organization's admins manage; invitations are few per organization and
 * die with it.
 */
import type { ListIndexCursor, ListIndexRow } from "@stigmer/server";

import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";

/** A redemption's record: the persisted post-image, or the guard's refusal. */
export type RedemptionOutcome =
  | { readonly kind: "recorded"; readonly invitation: Invitation }
  | { readonly kind: "refused" };

/** A release: the entry removed, or no row or entry to remove. */
export type ReleaseOutcome = { readonly kind: "released" } | { readonly kind: "absent" };

export interface InvitationStore {
  save(invitation: Invitation): Promise<void>;
  /** The row revoked under its lock (see above); undefined when it is gone. */
  revoke(invitationId: string): Promise<Invitation | undefined>;
  deleteById(id: string): Promise<void>;
  findById(id: string): Promise<Invitation | undefined>;
  findByToken(token: string): Promise<Invitation | undefined>;
  /**
   * The organization's rows after `after` (from the newest when
   * undefined), newest first and ids in byte order, at most `limit` (every
   * one when undefined): the list's row source.
   */
  pageByOrg(
    org: string,
    after: ListIndexCursor | undefined,
    limit: number | undefined,
  ): Promise<ReadonlyArray<ListIndexRow>>;
  /** The ids of the organization's invitations (the organization delete's sweep). */
  findIdsByOrg(org: string): Promise<ReadonlyArray<string>>;
  /** Every invitation, for the boot's organization-link reconcile. */
  findAll(): Promise<ReadonlyArray<Invitation>>;
  /**
   * The guarded atomic redemption. Answers the persisted post-image, or
   * `refused` when the guard rejected (lost slot race / concurrent
   * revoke / concurrent delete).
   */
  recordRedemption(
    invitationId: string,
    identityAccountId: string,
    redeemedAt: Date,
  ): Promise<RedemptionOutcome>;
  /** Undoes one recorded redemption whose grant failed; `absent` writes nothing. */
  releaseRedemption(
    invitationId: string,
    identityAccountId: string,
    redeemedAt: Date,
  ): Promise<ReleaseOutcome>;
}

/** The ledger's instant: whole seconds, the precision the record keeps. */
export function ledgerSeconds(at: Date): bigint {
  return BigInt(Math.floor(at.getTime() / 1000));
}
