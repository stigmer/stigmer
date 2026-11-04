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
 *   - grant or revoke a role on the organization itself (Grant
 *     `create`, `delete` and `revokeOrgAccess` when the resource is the
 *     organization, domain/grant);
 *   - change the organization's embedding settings (their sign-in role
 *     decides which role the key's own mint grants: minting is the one
 *     act that creates accounts the key may do, and only with the role
 *     its organization's admins set, domain/token/mint.ts);
 *   - create, change or remove a federated account;
 *   - an edition's own doors of the same kind (the hosted edition's
 *     invitations and federation issuers splice the step).
 *
 * The same acts are refused to every credential that speaks for one piece
 * of work rather than for a person or the platform: a run's credential
 * (class `runner`) and every lane class an edition mints for its
 * sandboxes, connects, evaluations and visitors. Such a credential acts as
 * the person who started the work, with the person's whole role, but it
 * is meant to end with that work; holding it must not become the person's
 * lasting API key, a new service account, or a change to who belongs to
 * the organization (stigmer#2946). Admitted: a person's own credential
 * (`user`), the platform's own machine accounts (`machine`), and a request
 * the server composed itself (`internal`, or anything that entered
 * in-process).
 *
 * So a leaked key, acting as itself, can neither outlive its revocation, by
 * minting another credential, nor widen the organization. What it reaches
 * through the mint is its app users' own reach, the trust an organization
 * gives its product's backend as it gives a federation issuer's key
 * (domain/token/mint.ts). The model alone cannot hold this:
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
 * named and who may do it: an admin, for a service account's credential;
 * the person, signed in as themselves, for a credential for one piece of
 * work.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";

import {
  isServerComposedRequest,
  isServiceAccountCaller,
  SERVICE_ACCOUNT_CALLER_CLASS,
} from "../../extensions/identity.js";
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

/**
 * The refusal when a credential for one piece of work asks for one of the
 * acts; `act` completes "a credential for one run or lane cannot …".
 */
export function workCredentialRefusedMessage(act: string): string {
  return `a credential for one run or lane cannot ${act}; the person must do it signed in as themselves`;
}

/** The classes that speak for a person or the platform itself; `service_account` has its own refusal. */
const PERSON_OR_PLATFORM_CLASSES: ReadonlySet<string> = new Set([
  "user",
  "machine",
  SERVICE_ACCOUNT_CALLER_CLASS,
]);

/**
 * Whether `caller` is a credential for one piece of work (a run's, or an
 * edition's lane credential) rather than a person's own, a machine
 * account's or the server's: the class answers, with no read.
 */
export function speaksForOnePieceOfWork(caller: CallerIdentity): boolean {
  return (
    !isServerComposedRequest(caller) &&
    !PERSON_OR_PLATFORM_CLASSES.has(caller.callerClass)
  );
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

/**
 * Throws PERMISSION_DENIED when `caller` is a credential for one piece of
 * work or speaks for a service account.
 */
export async function refuseServiceAccountCaller(
  caller: CallerIdentity,
  act: string,
  lookup: ServiceAccountLookup,
): Promise<void> {
  if (speaksForOnePieceOfWork(caller)) {
    throw new ConnectError(
      workCredentialRefusedMessage(act),
      Code.PermissionDenied,
    );
  }
  if (await speaksForServiceAccount(caller, lookup)) {
    throw new ConnectError(
      serviceAccountRefusedMessage(act),
      Code.PermissionDenied,
    );
  }
}

/**
 * The step form; `act` completes both refusals, "a credential for one run
 * or lane cannot …" and "a service account cannot …".
 */
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
