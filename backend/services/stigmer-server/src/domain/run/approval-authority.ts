/**
 * RequireApprovalAuthority — a turn that waives its own approvals
 * (spec.auto_approve_all) speaks for the conversation's owners.
 *
 * Approving a tool call, stopping a run and deciding on its file changes
 * are run#can_edit, which a run reads from its session's owners
 * (run.fga: `owner from session`). A conversation's participant may add a
 * turn (session#can_create_run_in) but never decide for its owners, so a
 * turn into an existing conversation that sets auto_approve_all also asks
 * session#can_edit. A turn that starts a new conversation is its creator's
 * own and asks nothing more here. Runs right after AuthorizeRunTarget, the
 * session gate, before anything is stored.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
import { sessionIdOf } from "./target.js";

/** The refusal a participant's auto-approving turn gets. */
export function autoApproveDeniedMessage(sessionId: string): string {
  return `only the owners of session ${sessionId} can approve its tool calls in advance; send the message without auto_approve_all`;
}

export function newRequireApprovalAuthorityStep(
  authorizer: Authorizer,
): PipelineStep<typeof RunSchema> {
  return {
    name: "RequireApprovalAuthority",
    async execute(ctx: RequestContext<typeof RunSchema>): Promise<void> {
      const spec = ctx.newState.spec;
      const sessionId = sessionIdOf(spec);
      if (spec?.autoApproveAll !== true || sessionId === "") {
        return;
      }
      await authorizeResolvedResource(
        authorizer,
        ctx.callerIdentity,
        {
          permission: IamPermission.can_edit,
          resourceKind: ApiResourceKind.session,
          resourceId: sessionId,
        },
        autoApproveDeniedMessage(sessionId),
      );
    },
  };
}
