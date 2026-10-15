/**
 * Pins the create lane's authorization question (steps.ts,
 * resolveChannelCreateTargets): can_manage_audience on the referenced agent
 * (a channel of any type widens who reaches the agent, the owner's decision,
 * so an editor's can_edit is not enough), then can_create_channel on the
 * channel's organization (a channel spends
 * the organization's provider keys, an admin-level act, and a member owns the
 * agents they create); a missing referenced agent throws.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  CHANNEL_AGENT_DENIED_MESSAGE,
  CHANNEL_ORGANIZATION_DENIED_MESSAGE,
  REFERENCED_AGENT_KEY,
  resolveChannelCreateTargets,
} from "../steps.js";

const agent = create(AgentSchema, {
  metadata: { id: "agt_01target", name: "helper", org: "acme" },
});

function ctxFor(stash = true) {
  const ctx = new RequestContext(
    ChannelSchema,
    create(ChannelSchema, { metadata: { name: "support", org: "acme" } }),
    testCallerIdentity(),
    ApiResourceKind.channel,
  );
  if (stash) {
    ctx.set(REFERENCED_AGENT_KEY, agent);
  }
  return ctx;
}

describe("resolveChannelCreateTargets", () => {
  it("asks can_manage_audience on the referenced agent, then can_create_channel on the organization", () => {
    expect(resolveChannelCreateTargets(ctxFor())).toEqual([
      {
        permission: IamPermission.can_manage_audience,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_01target",
        deniedMessage: CHANNEL_AGENT_DENIED_MESSAGE,
      },
      {
        permission: IamPermission.can_create_channel,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
        deniedMessage: CHANNEL_ORGANIZATION_DENIED_MESSAGE,
      },
    ]);
  });

  it("a missing referenced agent is a broken chain invariant and throws", () => {
    expect(() => resolveChannelCreateTargets(ctxFor(false))).toThrow(
      "referenced agent not found in context",
    );
  });
});
