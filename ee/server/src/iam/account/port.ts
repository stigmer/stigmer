/**
 * The account surface the identity lanes depend on, apart from the
 * adapters that implement it. The federated verifier
 * (../federation/verifier.ts) and the IdentityFederation capability
 * (../identity-federation.ts) take these types, as do a host's own per-org
 * system-account lanes; a host's implementations (the create, update and
 * delete pipelines, the `@clients` machine-account rule, the account rows)
 * are its own and are wired only by its IAM unit. Kept in a file of its own
 * so code that must not depend on a host's adapters can depend on the
 * surface (the host's boundary test holds that line).
 *
 * The store is the library's `IdentityAccountStore` port, which carries
 * every read these lanes make: the federated natural key (the provider that
 * vouches for a subject, and the subject), which federation reads, and
 * every account one provider vouches for, which the provider's removal
 * reads. A host keeps its own reads on its own store type, never here.
 *
 * The service's contract, which every host's implementation meets and the
 * kit in port-contract.ts holds:
 *   - `createAccount` throws `DuplicateAccountError` when the account is
 *     already held (by its id or its natural key), so each lane resolves a
 *     lost race by reading the winner back (`resolveCreateRace`), however
 *     the host's create path reports a duplicate;
 *   - `updateAccount` applies the change to the stored account and writes
 *     it through the store's guarded write, so a write that lands between
 *     its read and its write is never undone, email included: a person's
 *     changed email at their provider reaches Stigmer;
 *   - `deleteAccount` removes the account's keys, every policy row naming
 *     it (acting for `actingFor`, so the permission history names who
 *     caused it) and its row, failing closed, so an account provisioned
 *     again under the same id finds nothing of the old one alive.
 */
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccountSpec } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import type { IdentityAccountStore } from "@stigmer/server";
import { DuplicateAccountError } from "@stigmer/server";

export interface NewAccountRequest {
  /**
   * The account's id, when the lane derives it (the system lanes take
   * `accountIdFor` of their own subject, so the primary key holds one row
   * per org per lane); absent, a fresh `ida_<ulid>`.
   */
  readonly id?: string;
  /** metadata fields the caller controls (org/slug/name/labels). */
  readonly org?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly spec: IdentityAccountSpec;
}

export interface IdentityAccountService {
  /**
   * The create pipeline: build → persist → self-owner grant, acting for
   * `actingFor` when a principal is behind the create (a federated
   * account's identity provider). Throws DuplicateAccountError when the
   * account is held (callers resolve the race winner themselves, since
   * each lane's natural key differs).
   */
  createAccount(request: NewAccountRequest, actingFor?: string): Promise<IdentityAccount>;
  /**
   * A profile update: `change` is applied to the stored account, its spec
   * audit stamped, and the result written by compare-and-swap, read again
   * and re-applied while another write lands in between
   * (`@stigmer/server`'s changeThroughGuardedPort). `change` is synchronous
   * and may run more than once; the identity keys (idp_id, provider ref,
   * provisioning mode) are the caller's to leave alone, since the account's
   * identity rests on them. Answers the written account, or undefined when
   * the account is gone.
   */
  updateAccount(
    id: string,
    change: (account: IdentityAccount) => void,
  ): Promise<IdentityAccount | undefined>;
  /**
   * The delete pipeline: the account's keys, the policy cleanup
   * (bidirectional: the account as principal AND as resource), then the
   * row, acting for `actingFor` when a principal is behind the delete.
   */
  deleteAccount(account: IdentityAccount, actingFor?: string): Promise<void>;
  readonly store: IdentityAccountStore;
}

/**
 * The concurrent-create resolution idiom every account lane uses: on a lost
 * insert race, read the winner back by the lane's natural key; anything
 * else (or a missing winner) rethrows.
 */
export async function resolveCreateRace(
  error: unknown,
  findWinner: () => Promise<IdentityAccount | undefined>,
): Promise<IdentityAccount> {
  if (!(error instanceof DuplicateAccountError)) {
    throw error;
  }
  const winner = await findWinner();
  if (winner === undefined) {
    throw error;
  }
  return winner;
}
