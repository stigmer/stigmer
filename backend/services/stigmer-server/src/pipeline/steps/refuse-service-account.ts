/**
 * RefuseServiceAccountCaller — an organization's service account never
 * decides who belongs to the organization or what credentials exist
 * (`isServiceAccountCaller`, extensions/identity.ts). Its key is refused
 * on the RPCs that would:
 *
 *   - create an API key, for itself or another account (ApiKey `create`,
 *     `createForServiceAccount`);
 *   - create a service account;
 *   - change or delete an identity account, its own included;
 *   - create an organization, a child one included;
 *   - grant or revoke a role on the organization itself (IamPolicy
 *     `create`, `delete` and `revokeOrgAccess` when the resource is the
 *     organization, domain/iampolicy);
 *   - create an invitation (an edition that serves them splices the step).
 *
 * So a leaked key can neither outlive its revocation, by minting another,
 * nor widen the organization. The model alone cannot hold this: an admin
 * service account is `admin from organization` of its own organization,
 * so it holds `can_manage_keys` on itself and on every other service
 * account there. A share of one resource by an admin service account is
 * not refused: that is the resource's audience, not the organization's
 * membership.
 *
 * Placement: first, before any read or write, so the refusal is the same
 * whatever the request names. The refusal is PERMISSION_DENIED with the
 * act named, so the person reading the CI log knows an admin must do it.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { isServiceAccountCaller } from "../../extensions/identity.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";

/** The refusal's copy: what was refused and who may do it. */
export function serviceAccountRefusedMessage(act: string): string {
  return `a service account cannot ${act}; an organization admin must do it`;
}

/** Throws PERMISSION_DENIED when `caller` is a service account. */
export function refuseServiceAccountCaller(
  caller: CallerIdentity,
  act: string,
): void {
  if (isServiceAccountCaller(caller)) {
    throw new ConnectError(
      serviceAccountRefusedMessage(act),
      Code.PermissionDenied,
    );
  }
}

/** The step form; `act` completes "a service account cannot …". */
export function newRefuseServiceAccountCallerStep<Desc extends DescMessage>(
  act: string,
): PipelineStep<Desc> {
  return {
    name: "RefuseServiceAccountCaller",
    execute(ctx: RequestContext<Desc>): void {
      refuseServiceAccountCaller(ctx.callerIdentity, act);
    },
  };
}
