/**
 * The trusted-local operator account (20260911.11, T01_1_review.md A2,
 * A5): under the posture with no authentication, the server knows its one
 * principal from config, so the server states the fact at boot instead of
 * asking three clients to provision it (the console's gate is off on the
 * laptop and the desktop has none).
 *
 * `ensureOperatorAccount` is create-if-absent under the derived id of
 * `local|<operator email, or "system">`, through the domain's ONE create
 * path AS the trusted-local identity, so the row is stamped, derived and
 * tuple-lifecycled exactly like every other account. Create-if-absent
 * means a later boot never touches the row: preferences set through
 * `update` survive a reboot, and a changed display name is edited like
 * any profile, never re-synced from config. A changed operator email is a
 * different subject and therefore a different account — the platform
 * already treats the email as the identity (boot/config.ts
 * loadOperatorIdentity). Two replicas ensuring at once converge by
 * primary key: a lost race reads the winner back.
 *
 * The operator arrives from the SAME seam the interceptor stamps the
 * caller from (pipeline/interceptors/auth.ts operatorIdentitySnapshot,
 * read by the composition root), and the account is created AS the
 * identity that seam yields for it (trustedLocalIdentityFor — the one
 * construction of that principal), never from config directly: one
 * source, so the row, its audit stamp and the per-request caller cannot
 * disagree (A5).
 *
 * Whether this runs at all — only when no authentication posture is on —
 * is the composition root's decision (boot/compose.ts); the cloud and an
 * OIDC self-host never create one.
 */
import { create } from "@bufbuild/protobuf";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";

import { trustedLocalIdentityFor } from "../../pipeline/interceptors/auth.js";
import { accountIdFor, localIdpIdFor } from "./constants.js";
import type { CreateAccount } from "./provisioning.js";
import { resolveCreateRace } from "./provisioning.js";
import { assignDirectBackendFields } from "./steps.js";
import type { IdentityAccountStore } from "./store.js";

/** The operator as boot/config.ts loads it; empty email = the "system" placeholder. */
export interface OperatorIdentity {
  readonly email: string;
  readonly displayName: string;
}

export interface OperatorAccountDeps {
  readonly accounts: IdentityAccountStore;
  readonly createAccount: CreateAccount;
}

/** The unconfigured laptop's operator: what the interceptor stamps as identityId. */
const SYSTEM_OPERATOR = "system";

export async function ensureOperatorAccount(
  deps: OperatorAccountDeps,
  operator: OperatorIdentity,
): Promise<IdentityAccount> {
  // The caller the interceptor would stamp for this operator; its
  // identityId (the email, or "system") is the subject's local principal.
  const caller = trustedLocalIdentityFor(operator);
  const idpId = localIdpIdFor(caller.identityId);
  const existing = await deps.accounts.findById(accountIdFor(idpId));
  if (existing !== undefined) {
    return existing;
  }
  const name =
    operator.displayName !== ""
      ? operator.displayName
      : operator.email !== ""
        ? operator.email
        : SYSTEM_OPERATOR;
  try {
    return await deps.createAccount(
      {
        name,
        spec: assignDirectBackendFields(
          create(IdentityAccountSpecSchema, {
            idpId,
            email: operator.email,
          }),
        ),
      },
      caller,
    );
  } catch (error) {
    return resolveCreateRace(error, () =>
      deps.accounts.findById(accountIdFor(idpId)),
    );
  }
}
