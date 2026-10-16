/**
 * The GrantStore PORT: the
 * storage contract the Grant domain writes and reads through, cut from
 * the cloud's row store (iam/grant/store.ts) to what BOTH editions call.
 * The second OSS domain whose persistence is a port rather than the
 * generic Store (the identity account was the first): the cloud serves the
 * same controller over its own `cloud.grant` table by registering an
 * implementation as `drivers.grantStore`, so the domain's grant path
 * and handlers take this interface, never `Store`. Open source's own
 * implementation is resource-store.ts over the generic Store.
 *
 * What the port deliberately does not carry: `markSynced` and
 * `findUnsynced` (the cloud's tuple-mirror bookkeeping and boot backfill;
 * its store keeps them as extras) and `findByIdentityAccountInOrg` (the
 * cloud's org-column arm of revocation — the column was never stamped by
 * any writer, so it matched nothing; dropped). A port does not
 * carry methods only one edition calls or no edition needs.
 * `findByResourceKindAndRelation` joined it when a second edition came to
 * call it: the boot reconcile that revokes the direct `owner` rows a kind
 * no longer admits runs in every host that serves federation issuers and
 * invitations, over this port.
 *
 * Contract every implementation must satisfy — proven by the port-contract
 * kit (store-contract.ts, exported), which the OSS adapter's test iterates
 * on both drivers and a composition's driver test iterates too:
 *   - `save` is create-only in effect: a save under a held ID raises
 *     DuplicateGrantError, never a silent overwrite. Under derived ids a
 *     held triple IS a held id, which is what the kit exercises; where a
 *     composition still holds legacy random ids, "one row per triple" is
 *     the grant path's by-triple read (grant-path.ts), not this promise;
 *   - `deleteById` of an unknown id resolves;
 *   - the finds answer rows by the axes named, exactly:
 *     `findByPrincipalAndResource` every relation on the pair;
 *     `findByResourceKindAndRelation` every row granting the relation on
 *     any resource of the kind, and nothing on another kind or relation;
 *     `findByResourceWithRelations` the allowlist only, an empty allowlist
 *     matching nothing; `countDistinctPrincipalsByResource` distinct
 *     (kind, id) principals — not rows — over the allowlist, `undefined`
 *     principal kind meaning any (callers normalize the wire's `""`);
 *     `findScopeTuple` the resource's one structural link — a principal
 *     that is not `identity_account` or `team` and a relation that is not
 *     `owner` or `creator`, the cloud SQL's exclusion arms verbatim (`team`
 *     is a Java-era name no ApiResourceKind carries; kept so the two
 *     editions' filters read alike);
 *   - a typed not-found reads as `undefined`; any other storage failure
 *     propagates as the infrastructure fault it is (the
 *     store-fault mapping — an outage must never read as "no grant");
 *   - a change record (change.ts) never changes what happens to the row:
 *     `save` and `deleteById` behave identically with and without one.
 *
 * The change record. The grant path hands one to `save` and `deleteById`
 * for every access row it writes or deletes. An implementation that keeps
 * a permission history writes exactly one entry for it in the SAME atomic
 * unit as the row change, and none when the row did not change: a held id
 * raises DuplicateGrantError before anything is written, and deleting an
 * id that is not held records nothing. History equals the row changes
 * exactly, with nothing to filter or heal. An implementation may keep no
 * history and ignore the record; the library's adapter keeps one only when
 * the composition opens it to (resource-store.ts), and on open source it
 * does not. A driver
 * written against the one-argument methods still satisfies this interface.
 *
 * Reading the history. Every edition above open source keeps a history and
 * serves it (the grant controller's `listAccessHistory`), so a
 * store composed there must keep one and read it back through
 * `listChanges`: each organization's changes numbered from 1 in commit
 * order with no gaps, and times that never go back, so "everything after
 * N", asked again later, never skips a change that committed late. A store
 * that keeps no history answers an empty list. The kit's history section
 * (`grantStoreContract` with `keepsHistory`) holds a store to this.
 *
 * Retention. A host may declare how long the history is kept; the
 * library's retention runner (history-retention.ts) then calls
 * `pruneChanges` with the cutoff, a batch at a time. A store removes the
 * changes recorded before it oldest first, by time, then organization,
 * then number. Because an organization's times never go back as its
 * numbers rise, what goes is a prefix of its numbers: its kept changes
 * stay one unbroken run ending at its newest, and "no gaps" holds above
 * the oldest kept change. The numbering is never reset, so the next
 * change continues it, and `lastChangeSequence` reads where it stands even
 * when every change has been removed. A store that keeps no history
 * answers 0 to both.
 */
import type { Grant } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";

import type {
  GrantChange,
  GrantChangePage,
  GrantChangeRecord,
} from "./change.js";

/**
 * Raised by `save` when the id is already held, so the grant path runs its
 * race arm (re-read the winner by triple; answer it as the duplicate).
 * `cause` carries a driver's own error (the cloud's SQLSTATE 23505) for
 * the logs; the message is the port's.
 */
export class DuplicateGrantError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DuplicateGrantError";
  }
}

export interface GrantStore {
  /** Insert; a held id raises DuplicateGrantError. `record`: the change to keep, when the row grants access. */
  save(grant: Grant, record?: GrantChangeRecord): Promise<void>;
  /** Removes the row; no error when it does not exist. `record`: as for `save`, kept only when a row was removed. */
  deleteById(id: string, record?: GrantChangeRecord): Promise<void>;
  findById(id: string): Promise<Grant | undefined>;
  /** Every row naming the principal — the cleanup's principal-side arm. */
  findByPrincipal(
    principalKind: string,
    principalId: string,
  ): Promise<ReadonlyArray<Grant>>;
  /** Every row on the resource — the cleanup's resource-side arm. */
  findByResource(
    resourceKind: string,
    resourceId: string,
  ): Promise<ReadonlyArray<Grant>>;
  /** Every relation the principal holds on the resource — the by-triple read's candidates. */
  findByPrincipalAndResource(
    principalKind: string,
    principalId: string,
    resourceKind: string,
    resourceId: string,
  ): Promise<ReadonlyArray<Grant>>;
  /** Rows on the resource whose relation is in the allowlist (the assignable roles); an empty allowlist matches nothing. */
  findByResourceWithRelations(
    resourceKind: string,
    resourceId: string,
    relations: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<Grant>>;
  /** Distinct (kind, id) principals holding an allowlisted relation on the resource; `undefined` kind = any. */
  countDistinctPrincipalsByResource(
    resourceKind: string,
    resourceId: string,
    principalKind: string | undefined,
    relations: ReadonlyArray<string>,
  ): Promise<number>;
  /**
   * Every row granting `relation` on any resource of `resourceKind` — a
   * boot reconcile's read, asked once per kind, never per request.
   */
  findByResourceKindAndRelation(
    resourceKind: string,
    relation: string,
  ): Promise<ReadonlyArray<Grant>>;
  /**
   * The resource's scope tuple (the hierarchy walk's one step): a grant
   * on the resource whose principal is structural (not identity_account
   * or team) and whose relation is structural (not owner or creator).
   */
  findScopeTuple(
    resourceKind: string,
    resourceId: string,
  ): Promise<Grant | undefined>;
  /**
   * One organization's recorded changes: newest first below `page.before`,
   * or oldest first above `page.after`, at most `page.limit`; empty for a
   * store that keeps no history. A limit that is not a positive integer
   * rejects.
   */
  listChanges(
    org: string,
    page: GrantChangePage,
  ): Promise<ReadonlyArray<GrantChange>>;
  /**
   * Retention's removal: at most `limit` recorded changes from before
   * `before`, across organizations, oldest first by time, then
   * organization, then number; answers how many it removed. The numbering
   * continues after a removal. 0 for a store that keeps no history. A
   * limit that is not a positive integer rejects.
   */
  pruneChanges(before: Date, limit: number): Promise<number>;
  /**
   * The last number the organization's history handed out; 0 when it has
   * recorded none, and for a store that keeps no history. A removal never
   * lowers it.
   */
  lastChangeSequence(org: string): Promise<bigint>;
}
