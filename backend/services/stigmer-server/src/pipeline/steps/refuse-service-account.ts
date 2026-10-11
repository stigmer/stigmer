/**
 * RefuseServiceAccountCaller — an organization's service account never
 * decides who belongs to the organization or what credentials exist. A
 * request is refused when its principal is a service account, on the RPCs
 * that would:
 *
 *   - create or change an API key, for itself or another account (ApiKey
 *     `create`, `createForServiceAccount`, `update`);
 *   - create a service account;
 *   - change or delete an identity account, its own included;
 *   - create or delete an organization, a child one included;
 *   - grant or revoke a role on the organization itself (IamPolicy
 *     `create`, `delete` and `revokeOrgAccess` when the resource is the
 *     organization, domain/iampolicy);
 *   - create or change a platform client, or rotate its secret (its
 *     sign-in role makes members, its secret mints users);
 *   - create, change or remove a federated account;
 *   - an edition's own doors of the same kind (the hosted edition's
 *     invitations and identity providers splice the step).
 *
 * So a leaked key can neither outlive its revocation, by minting another
 * credential, nor widen the organization. The model alone cannot hold this:
 * an admin service account is `admin from organization` of its own
 * organization, so it holds `can_manage_keys` on itself and on every other
 * service account there. A share of one resource by an admin service
 * account is not refused: that is the resource's audience, not the
 * organization's membership.
 *
 * Who is a service account is the PRINCIPAL's fact, not the credential's:
 * its API key carries the `service_account` class, but a credential of
 * another class can speak for the same account (a run's own credential,
 * class `runner`, acts as the run's creator; an edition's runner bootstrap
 * token speaks for whoever asked for it). So the class answers first,
 * with no read, and otherwise the principal's row is read once
 * (`lookup.findById`, only for an id shaped like an account id). The
 * server acting as itself (`internal`) is never a service account. A
 * store fault fails the request: an outage must never read as "a person".
 *
 * Placement: right after the chain's Authorize step, before any read or
 * write the request names. The refusal is PERMISSION_DENIED with the act
 * named, so the person reading the CI log knows an admin must do it.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { isServiceAccountCaller } from "../../extensions/identity.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";

/** How the refusal reads a principal's row: the identity-account port's by-id read. */
export interface ServiceAccountLookup {
  findById(id: string): Promise<IdentityAccount | undefined>;
}

/** The refusal's copy: what was refused and who may do it. */
export function serviceAccountRefusedMessage(act: string): string {
  return `a service account cannot ${act}; an organization admin must do it`;
}

/** An account id's shape (`ida_…`), the only principal a row can be read for. */
const ACCOUNT_ID = /^ida_/;

/** Whether `caller` speaks for an organization's service account, by its class or its row. */
export async function speaksForServiceAccount(
  caller: CallerIdentity,
  lookup: ServiceAccountLookup,
): Promise<boolean> {
  if (isServiceAccountCaller(caller)) {
    return true;
  }
  if (caller.callerClass === "internal" || !ACCOUNT_ID.test(caller.identityId)) {
    return false;
  }
  let account: IdentityAccount | undefined;
  try {
    account = await lookup.findById(caller.identityId);
  } catch (error) {
    throw internalError(error, "failed to load the caller's identity account");
  }
  return (
    account?.spec?.provisioningMode ===
    IdentityAccountProvisioningMode.service_account
  );
}

/** Throws PERMISSION_DENIED when `caller` speaks for a service account. */
export async function refuseServiceAccountCaller(
  caller: CallerIdentity,
  act: string,
  lookup: ServiceAccountLookup,
): Promise<void> {
  if (await speaksForServiceAccount(caller, lookup)) {
    throw new ConnectError(
      serviceAccountRefusedMessage(act),
      Code.PermissionDenied,
    );
  }
}

/** The step form; `act` completes "a service account cannot …". */
export function newRefuseServiceAccountCallerStep<Desc extends DescMessage>(
  act: string,
  lookup: ServiceAccountLookup,
): PipelineStep<Desc> {
  return {
    name: "RefuseServiceAccountCaller",
    execute(ctx: RequestContext<Desc>): Promise<void> {
      return refuseServiceAccountCaller(ctx.callerIdentity, act, lookup);
    },
  };
}
