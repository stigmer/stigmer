/**
 * Who a chat link reaches. An omitted audience means the organization's
 * members: a link reaches anyone on the internet only when its owner chose
 * public (agentshare/v1/spec.proto `audience`). Two halves keep that one
 * meaning everywhere:
 *
 *   - ResolveShareAudience writes an omitted audience out as org on
 *     create, update and apply (right after ValidateProto, and on update
 *     after BuildUpdateState, which rebuilds the state from the request),
 *     so every stored share and every echo says what it means.
 *   - shareAdmitsAnyone is the one question every reader asks (exactly
 *     public). A row stored before the server wrote the audience out, still
 *     holding 0, therefore reads as organization-only: it narrows, never
 *     widens. Editions ask it through the package root instead of comparing
 *     to org, which once let an omitted audience mean public.
 */
import type { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import {
  AgentShareAudience,
  type AgentShareSpec,
} from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";

import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";

/** True only for a share whose owner chose "Anyone with the link". */
export function shareAdmitsAnyone(spec: AgentShareSpec | undefined): boolean {
  return spec?.audience === AgentShareAudience.public;
}

/**
 * ResolveShareAudience: an omitted audience becomes org, before anything
 * else reads the spec. Runs after ValidateProto, whose rules already treat
 * an omitted audience as organization-only (vaults and saved run settings
 * need an explicit public); on update, after BuildUpdateState.
 */
export function newResolveShareAudienceStep(): PipelineStep<
  typeof AgentShareSchema
> {
  return {
    name: "ResolveShareAudience",
    execute(ctx: RequestContext<typeof AgentShareSchema>): void {
      const share = ctx.newState;
      if (
        share.spec !== undefined &&
        share.spec.audience === AgentShareAudience.unspecified
      ) {
        share.spec.audience = AgentShareAudience.org;
      }
    },
  };
}
