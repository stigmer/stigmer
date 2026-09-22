/**
 * Pins the create lane's authorization question (steps.ts,
 * resolveChannelCreateTargets): can_edit on the REFERENCED AGENT with the
 * Java handler's copy, and nothing on the organization (the same-org
 * invariant already binds the channel to the agent's); a missing
 * referenced agent throws.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  CHANNEL_CREATE_DENIED_MESSAGE,
  REFERENCED_AGENT_KEY,
  resolveChannelCreateTargets,
} from "../steps.js";

const agent = create(AgentSchema, {
  metadata: { id: "agt_01target", name: "helper", org: "acme" },
});

function ctxFor(stash = true) {
  const ctx = new RequestContext(
    AgentChannelSchema,
    create(AgentChannelSchema, { metadata: { name: "support", org: "acme" } }),
    testCallerIdentity(),
    ApiResourceKind.agent_channel,
  );
  if (stash) {
    ctx.set(REFERENCED_AGENT_KEY, agent);
  }
  return ctx;
}

describe("resolveChannelCreateTargets", () => {
  it("asks can_edit on the referenced agent and nothing else", () => {
    expect(resolveChannelCreateTargets(ctxFor())).toEqual([
      {
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_01target",
        deniedMessage: CHANNEL_CREATE_DENIED_MESSAGE,
      },
    ]);
  });

  it("a missing referenced agent is a broken chain invariant and throws", () => {
    expect(() => resolveChannelCreateTargets(ctxFor(false))).toThrow(
      "referenced agent not found in context",
    );
  });
});
