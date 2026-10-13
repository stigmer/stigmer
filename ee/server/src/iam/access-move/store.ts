/**
 * The access move ticket store's port: a ticket lets the account that asked
 * for it move its access in one organization to the account that
 * organization's SSO provider signs the same person in as
 * (iam/access-move/handlers.ts). The host's Postgres adapter is
 * postgres-store.ts beside it; both answer the port's contract kit
 * (store-contract.ts).
 *
 * Only a hash of the ticket is kept, as a password is: whoever reads the
 * table cannot redeem what it holds. A ticket belongs to the first account
 * that redeems it (`claimFor`, one conditional write), so a second account
 * racing the first is refused before anything moves, while the same account
 * may redeem it again to finish a move that stopped partway. It is marked
 * redeemed once its move completes, and `markRedeemed` answers whether this
 * call marked it, so two redemptions by that account racing on it both
 * complete the same move (a move is re-runnable) and it closes once. A ticket
 * lives ten minutes; expired rows are swept when a new ticket is made, and
 * an organization's rows go with it through the identity unit's purge.
 */

/** One ticket as stored. */
export interface AccessMoveTicketRow {
  readonly tokenHash: string;
  /** The account whose access moves: the one that asked for the ticket. */
  readonly accountId: string;
  /** The organization the access moves inside (its id). */
  readonly org: string;
  readonly expiresAt: Date;
  /** When its move completed; undefined while it may still be redeemed. */
  readonly redeemedAt: Date | undefined;
  /** The account that first redeemed it, which alone may redeem it again; undefined until then. */
  readonly redeemerId: string | undefined;
}

export interface AccessMoveTicketStore {
  /** Adds a ticket; a hash already held is a programming error and throws. */
  insert(ticket: Omit<AccessMoveTicketRow, "redeemedAt" | "redeemerId">): Promise<void>;
  /** The ticket with this hash, redeemed or not; undefined when none. */
  findByHash(tokenHash: string): Promise<AccessMoveTicketRow | undefined>;
  /**
   * Binds the ticket to `redeemerId` unless another account holds it; true
   * when it is that account's now (this call bound it, or an earlier one
   * did), false when another account holds it or no ticket has the hash.
   */
  claimFor(tokenHash: string, redeemerId: string): Promise<boolean>;
  /** Marks the ticket redeemed at `at`; true only for the call that marked it. */
  markRedeemed(tokenHash: string, at: Date): Promise<boolean>;
  /** Removes every ticket that expired before `before`; answers how many went. */
  deleteExpired(before: Date): Promise<number>;
  /** Every ticket for an organization being deleted; answers how many went. Idempotent. */
  removeByOrgId(org: string): Promise<number>;
}
