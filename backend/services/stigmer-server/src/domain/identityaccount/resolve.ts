/**
 * Subject → identity resolution (20260911.11; T01_0_plan.md Q-IA-2,
 * T01_1_review.md A1 and A6): the ONE statement of "what identityId does
 * this subject get stamped with", called by every verifier after its own
 * credential checks pass — the OIDC lane with the token's `sub`, the
 * API-key lane with the key's creator stamp.
 *
 * The rule is the cloud's direct-login posture (iam/direct/verifier.ts):
 * one primary-key read of the DIRECT account for the subject; a hit
 * stamps the account id, so the Authorizer, the audit actor and the
 * tuple lifecycle see one principal shape for every provisioned user; a
 * miss returns the subject unchanged, so an unprovisioned caller is
 * admitted idp-shaped and exactly two RPCs mean anything to them —
 * whoAmI (NOT_FOUND) and provisionMyAccount. No cache between the two
 * (Q5's liveness posture): a row that appears is seen by the very next
 * request, a row that is deleted stops resolving on the next.
 *
 * It lives in the domain, not in either verifier, because it is the
 * domain's knowledge that a subject and an account are two names for one
 * principal; a verifier only knows which string it was handed. Stated
 * once, both lanes cannot drift, and a stamp that is already an account
 * id needs no special case: no account carries an `ida_` as its subject,
 * so the read is a miss and the stamp is kept.
 *
 * Faults: a store failure propagates as the error it is — the chassis
 * maps a non-ConnectError to INTERNAL (pipeline/interceptors/auth.ts),
 * so an outage never reads as a bad credential. A hit whose row carries
 * no id is the one deliberate divergence from the cloud's inline
 * `metadata?.id ?? ""`: a `""` principal is the silent-junk failure the
 * oss#405 doctrine forbids, so it is a loud fault naming the subject.
 */
import type { IdentityAccountStore } from "./store.js";

/** The one read a verifier needs from the domain: the direct account for a subject. */
export type AccountsBySubject = Pick<IdentityAccountStore, "findDirectByIdpId">;

export async function identityIdForSubject(
  accounts: AccountsBySubject,
  subject: string,
): Promise<string> {
  const account = await accounts.findDirectByIdpId(subject);
  if (account === undefined) {
    return subject;
  }
  const id = account.metadata?.id ?? "";
  if (id === "") {
    throw new Error(
      `identity account for subject '${subject}' carries no id — refusing to stamp an empty principal`,
    );
  }
  return id;
}
