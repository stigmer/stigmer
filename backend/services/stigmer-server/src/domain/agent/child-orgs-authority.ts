/**
 * Sharing an agent with child organizations stays an admin's act. Members
 * may create agents when their organization allows it (organization#
 * can_create_agent), and a creator owns the agent, so `can_manage_audience`
 * alone would let a member put it in front of every child organization.
 * RequireChildOrgsAuthority asks, beside the agent's own check, the
 * organization's `can_manage_child_orgs` (its admins) whenever the
 * requested level is visibility_child_orgs: on create, and on
 * updateVisibility, the only door that changes a stored level. Private and
 * organization-wide stay the creator's choice.
 *
 * It runs after RefuseChildOrgsVisibilityInChild, which refuses the level
 * outright in a child organization, so a refusal here only ever means "ask
 * an admin". The question is the agentshare idiom of asking the
 * organization beside the resource (domain/agentshare/steps.ts).
 */
import type { Message } from "@bufbuild/protobuf";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";

/** The refusal a member hears when they ask for child organizations. */
export const CHILD_ORGS_SHARE_DENIED_MESSAGE =
  "only an admin of the organization can share an agent with its child organizations";

async function requireChildOrgsAuthority(
  authorizer: Authorizer,
  identity: CallerIdentity,
  org: string,
): Promise<void> {
  await authorizeResolvedResource(
    authorizer,
    identity,
    {
      permission: IamPermission.can_manage_child_orgs,
      resourceKind: ApiResourceKind.organization,
      resourceId: org,
    },
    CHILD_ORGS_SHARE_DENIED_MESSAGE,
  );
}

/** RequireChildOrgsAuthority — agent create: a child-organizations level asks the organization. */
export function newRequireChildOrgsAuthorityStep(
  authorizer: Authorizer,
): PipelineStep<typeof AgentSchema> {
  return {
    name: "RequireChildOrgsAuthority",
    async execute(ctx: RequestContext<typeof AgentSchema>): Promise<void> {
      const metadata = metadataOf(ctx.input);
      if (metadata?.visibility !== ApiResourceVisibility.visibility_child_orgs) {
        return;
      }
      await requireChildOrgsAuthority(authorizer, ctx.callerIdentity, metadata.org);
    },
  };
}

/**
 * RequireChildOrgsAuthorityOnUpdate — agent updateVisibility, after the
 * load: a child-organizations level asks the loaded agent's organization.
 */
export function newRequireChildOrgsAuthorityOnUpdateStep(
  authorizer: Authorizer,
  loadedKey: string,
): PipelineStep<typeof UpdateVisibilityInputSchema> {
  return {
    name: "RequireChildOrgsAuthority",
    async execute(
      ctx: RequestContext<typeof UpdateVisibilityInputSchema>,
    ): Promise<void> {
      if (ctx.input.visibility !== ApiResourceVisibility.visibility_child_orgs) {
        return;
      }
      const loaded = ctx.get(loadedKey) as Message | undefined;
      const org = loaded === undefined ? "" : (metadataOf(loaded)?.org ?? "");
      if (org === "") {
        throw internalError(
          new Error("RequireChildOrgsAuthority ran without a loaded agent that names its organization"),
          "failed to update visibility",
        );
      }
      await requireChildOrgsAuthority(authorizer, ctx.callerIdentity, org);
    },
  };
}
