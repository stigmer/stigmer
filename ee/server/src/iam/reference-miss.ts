/**
 * The answer an Enterprise lane gives when what a caller named is not
 * there: "not found" only to a caller who could see it if it existed, and
 * to everyone else the refusal an existing-but-forbidden one would get,
 * with the same code and the same copy.
 *
 * Why the lanes need it. A read by reference (an organization and a slug)
 * loads before it can authorize, because the row it authorizes is the one
 * the load finds. Answering NOT_FOUND for a miss and PERMISSION_DENIED for
 * a hit the caller may not see tells an outsider, by the code alone,
 * whether another organization holds a team or a federation issuer of a
 * guessed name. So on a miss the lane asks the question that decides
 * whether the caller could see such a row at all: the kind's bar on the
 * organization the reference names (a team's viewers are its
 * organization's viewers, `team.fga`; every provider of an organization is
 * seen by its admins, `federation_issuer.fga`). The order is the library's
 * own anti-probing rule for mid-chain questions: the organization's bar
 * before the row, so an outsider learns nothing about the row
 * (`@stigmer/server` pipeline/steps/authorize-resolved-target.ts).
 *
 * The hit path is unchanged and asks the row, so each path puts one
 * question to the engine. A missing organization is refused like a
 * forbidden one: the lane does not tell an outsider whether an
 * organization exists either. An engine outage is INTERNAL, never
 * softened into a denial. The in-process `internal` caller is the
 * enforcement itself and is never refused, as the library's resolved-target
 * evaluation exempts it.
 *
 * The denial's copy is the refusing method's own, read from its proto
 * annotation (`deniedCopyOf`), so a miss and a forbidden hit cannot drift
 * apart: the read by reference answers with its `get`'s `error_msg`, the
 * copy `loadedTargetAsMethod(get)` answers a forbidden hit with.
 */
import { getOption } from "@bufbuild/protobuf";
import type { DescMethod } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { config } from "@stigmer/apis/ai/stigmer/commons/rpc/method_options_pb";
import type { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import type { Authorizer, CallerIdentity } from "@stigmer/server";
import { internalError } from "@stigmer/server";

/** The question that decides whether a caller could see a kind's rows in an organization. */
export interface OrganizationBar {
  /** The organization the caller named. */
  readonly organization: string;
  /** The organization permission every viewer of the kind's rows there holds. */
  readonly permission: IamPermission;
  /** The copy a forbidden hit answers, so a miss answers the same. */
  readonly deniedMessage: string;
}

/**
 * Returns when the caller holds the bar, so the lane may answer its
 * NOT_FOUND; throws the denial otherwise, and INTERNAL on an outage.
 */
export async function refuseMissUnlessOrganizationBar(
  authorizer: Authorizer,
  caller: CallerIdentity,
  bar: OrganizationBar,
): Promise<void> {
  if (caller.callerClass === "internal") {
    return;
  }
  const decision = await authorizer.authorize(caller, {
    permission: bar.permission,
    resourceKind: ApiResourceKind.organization,
    resourceId: bar.organization,
  });
  switch (decision.kind) {
    case "allow":
      return;
    case "deny":
    case "not-found":
      throw new ConnectError(bar.deniedMessage, Code.PermissionDenied);
    case "unavailable":
      throw internalError(decision.cause, "failed to verify organization access");
    default: {
      const exhaustive: never = decision;
      throw new Error(`unknown decision ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * A method's own authorization copy, its annotation's `error_msg`. A
 * method the lanes answer for always carries one, so an empty copy is a
 * wiring defect and throws rather than refusing with no sentence.
 */
export function deniedCopyOf(method: DescMethod): string {
  const copy = getOption(method, config).errorMsg;
  if (copy === "") {
    throw new Error(`${method.parent.typeName}.${method.name} carries no authorization copy`);
  }
  return copy;
}
