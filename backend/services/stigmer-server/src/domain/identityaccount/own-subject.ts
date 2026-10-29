/**
 * Whether an account's subject is the platform's own: the one rule that
 * decides both which account a raw subject resolves to and which keys an
 * account owns by its subject.
 *
 * A direct lookup (a verifier's subject resolve, `getByEmail`;
 * `resource-store.ts`) answers only such an account, and a key stamped with
 * a raw subject speaks for the account that lookup answers. The key-owner
 * names (`../apikey/queries.ts` `ownerNamesOf`) read the same rule, so a key
 * that authenticates as an account is also listed for it and deleted with
 * it. Two copies of the rule could drift, leaving a key that works for an
 * account but that account never sees.
 *
 * The rule is a deny-list: a subject is the platform's own unless someone
 * else chose it. A federated account's subject is its provider's (it carries
 * a `federation_issuer_ref`, which open source never writes, so that arm is
 * the port's contract stated); an app user's is the mint's, whose email and
 * name the product asserted; a service account signs in through nothing. A
 * composition's system account records no mode, and its subject is the
 * server's own, so it answers too (the port contract kit,
 * `store-contract.ts`, pins that).
 */
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";

/** True when a raw subject equal to the account's `idp_id` names this account. */
export function subjectIsOwn(account: IdentityAccount): boolean {
  const mode = account.spec?.provisioningMode;
  return (
    account.spec?.federationIssuerRef === undefined &&
    mode !== IdentityAccountProvisioningMode.federated &&
    mode !== IdentityAccountProvisioningMode.app_user &&
    mode !== IdentityAccountProvisioningMode.service_account
  );
}
