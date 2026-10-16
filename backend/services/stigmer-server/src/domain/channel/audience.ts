/**
 * Who a web channel's chat link reaches. An omitted audience means the
 * organization's members: a link reaches anyone on the internet only when
 * its owner chose public (channel/v1/spec.proto `WebChannelConfig.audience`).
 * Two halves keep that one meaning everywhere:
 *
 *   - ResolveChannelAudience writes an omitted audience out as org on
 *     create, update and apply (right after ValidateProto, and on update
 *     after BuildUpdateState, which rebuilds the state from the request),
 *     so every stored web channel and every echo says what it means.
 *   - channelAdmitsAnyone is the one question every reader asks (a web
 *     channel whose audience is exactly public). A row stored before the
 *     server wrote the audience out, still holding 0, therefore reads as
 *     organization-only: it narrows, never widens. A Slack or WhatsApp
 *     channel admits no anonymous visitor at all. Editions ask it through
 *     the package root instead of comparing to org, which once let an
 *     omitted audience mean public.
 */
import type { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import {
  ChannelAudience,
  type ChannelSpec,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";

import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";

/** True only for a web channel whose owner chose "Anyone with the link". */
export function channelAdmitsAnyone(spec: ChannelSpec | undefined): boolean {
  return (
    spec?.type.case === "web" &&
    spec.type.value.audience === ChannelAudience.public
  );
}

/**
 * ResolveChannelAudience: a web channel's omitted audience becomes org,
 * before anything else reads the spec. Runs after ValidateProto, whose
 * rules already treat an omitted audience as organization-only (vaults and
 * saved run settings need an explicit public); on update, after
 * BuildUpdateState. Other types have no audience and pass through.
 */
export function newResolveChannelAudienceStep(): PipelineStep<
  typeof ChannelSchema
> {
  return {
    name: "ResolveChannelAudience",
    execute(ctx: RequestContext<typeof ChannelSchema>): void {
      const type = ctx.newState.spec?.type;
      if (
        type?.case === "web" &&
        type.value.audience === ChannelAudience.unspecified
      ) {
        type.value.audience = ChannelAudience.org;
      }
    },
  };
}
