/**
 * Pins the create lane's two questions (steps.ts, resolveShareCreateTargets):
 * can_edit on the referenced agent, then can_create_agent_share on the
 * share's organization, in that order, each with its byte-pinned copy. A
 * share's agent lives in the share's organization (the resolve step refuses
 * anything else before this runs), so the two bars are one organization's:
 * sharing puts the agent in front of a wider audience (an editor's act) and
 * spends the organization's credits on the open internet (an admin's). A
 * missing referenced agent throws.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  REFERENCED_AGENT_KEY,
  SHARE_AGENT_DENIED_MESSAGE,
  SHARE_ORGANIZATION_DENIED_MESSAGE,
  resolveShareCreateTargets,
} from "../steps.js";

const agent = create(AgentSchema, {
  metadata: { id: "agt_01helper", name: "helper", org: "publisher-org" },
});

function ctxFor(shareOrg: string, stash = true) {
  const ctx = new RequestContext(
    AgentShareSchema,
    create(AgentShareSchema, {
      metadata: { name: "helper", org: shareOrg },
      spec: { agentRef: { org: shareOrg, slug: "helper" } },
    }),
    testCallerIdentity(),
    ApiResourceKind.agent_share,
  );
  if (stash) {
    ctx.set(REFERENCED_AGENT_KEY, agent);
  }
  return ctx;
}

describe("resolveShareCreateTargets", () => {
  it("asks can_edit on the referenced agent, then can_create_agent_share on the share's organization", () => {
    expect(resolveShareCreateTargets(ctxFor("publisher-org"))).toEqual([
      {
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_01helper",
        deniedMessage: SHARE_AGENT_DENIED_MESSAGE,
      },
      {
        permission: IamPermission.can_create_agent_share,
        resourceKind: ApiResourceKind.organization,
        resourceId: "publisher-org",
        deniedMessage: SHARE_ORGANIZATION_DENIED_MESSAGE,
      },
    ]);
  });

  it("a missing referenced agent is a broken chain invariant and throws", () => {
    expect(() =>
      resolveShareCreateTargets(ctxFor("publisher-org", false)),
    ).toThrow("referenced agent not found in context");
  });
});
