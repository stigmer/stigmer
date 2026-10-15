/**
 * RefuseBoundElsewhere — a credential bound to an organization
 * (`CallerIdentity.boundOrg`, authorization/credential-binding.ts) writes
 * only into the organizations it reaches: its own and, for every
 * credential but a run's, its own's children. Not a row, not a run, not a
 * connect elsewhere. The binding wraps the Authorizer, so every lane that
 * authorizes on the organization it writes into is bound already; this is
 * the check for the lanes that authorize on something else (the agent a
 * run executes, the MCP server a connect reaches) and take the
 * organization they write into from the request. A run filed in another
 * organization would otherwise mint a run credential bound there
 * (runnerauth/runner-subject-verifier.ts), and a connect would read the
 * person's secrets there.
 *
 * Organizations arrive as ids (pipeline/interceptors/organization-names.ts
 * resolves every slug a request names), and the question is the binding's
 * one predicate, `admitsOrganization`: no read for the bound organization
 * itself, one memoised read of a child's `spec.parent_org`. An empty
 * organization is left to the lane's own validation; an unbound caller
 * passes untouched. The persist step asks the same question of every row
 * it saves (persist.ts), the backstop for a lane that forgets.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { BOUND_ELSEWHERE_DENY_REASON } from "../../authorization/credential-binding.js";
import type { CredentialBinding } from "../../extensions/credential-binding.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { metadataOf } from "./shapes.js";

/** The one question this step asks of the binding. */
export type OrganizationAdmission = Pick<CredentialBinding, "admitsOrganization">;

/** Throws PERMISSION_DENIED when `caller`'s credential does not reach `org`. */
export async function refuseBoundElsewhere(
  binding: OrganizationAdmission,
  caller: CallerIdentity | undefined,
  org: string,
): Promise<void> {
  if (caller === undefined || org === "") {
    return;
  }
  if (!(await binding.admitsOrganization(caller, org))) {
    throw new ConnectError(BOUND_ELSEWHERE_DENY_REASON, Code.PermissionDenied);
  }
}

/** The step form, over the request's `metadata.org`, placed before any side effect. */
export function newRefuseBoundElsewhereStep<Desc extends DescMessage>(
  binding: OrganizationAdmission,
): PipelineStep<Desc> {
  return {
    name: "RefuseBoundElsewhere",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      await refuseBoundElsewhere(
        binding,
        ctx.callerIdentity,
        metadataOf(ctx.newState)?.org ?? "",
      );
    },
  };
}
