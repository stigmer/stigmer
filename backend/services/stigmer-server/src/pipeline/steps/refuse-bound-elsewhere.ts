/**
 * RefuseBoundElsewhere — a credential bound to one organization
 * (`CallerIdentity.boundOrg`, authorization/credential-binding.ts) never
 * writes into another: not a row, not a run, not a connect. The binding
 * wraps the Authorizer, so every lane that authorizes on the organization
 * it writes into is bound already; this is the check for the lanes that
 * authorize on something else (the agent a run executes, the
 * MCP server a connect reaches) and take the organization they write into
 * from the request. A run filed in another organization would otherwise
 * mint a run credential bound there (runnerauth/runner-subject-verifier.ts),
 * and a connect would read the person's secrets there.
 *
 * Organizations arrive as ids (pipeline/interceptors/organization-names.ts
 * resolves every slug a request names), so the check is one comparison and
 * no read. An empty organization is left to the lane's own validation; an
 * unbound caller passes untouched. The persist step asks the same question
 * of every row it saves (persist.ts), the backstop for a lane that forgets.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { BOUND_ELSEWHERE_DENY_REASON } from "../../authorization/credential-binding.js";
import { boundOrgOf } from "../../extensions/identity.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { metadataOf } from "./shapes.js";

/** Throws PERMISSION_DENIED when `caller` is bound to another organization than `org`. */
export function refuseBoundElsewhere(
  caller: CallerIdentity | undefined,
  org: string,
): void {
  const bound = boundOrgOf(caller);
  if (bound !== undefined && org !== "" && org !== bound) {
    throw new ConnectError(BOUND_ELSEWHERE_DENY_REASON, Code.PermissionDenied);
  }
}

/** The step form, over the request's `metadata.org`, placed before any side effect. */
export function newRefuseBoundElsewhereStep<
  Desc extends DescMessage,
>(): PipelineStep<Desc> {
  return {
    name: "RefuseBoundElsewhere",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      refuseBoundElsewhere(
        ctx.callerIdentity,
        metadataOf(ctx.newState)?.org ?? "",
      );
    },
  };
}
