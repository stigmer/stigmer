/**
 * Pins the create lane's two-arm consent bar (steps.ts,
 * resolveShareCreateTargets), the Java handler's: a same-org share asks
 * can_edit on the referenced agent; a cross-org share asks can_execute on
 * the agent and then can_create_agent_share on the SHARING organization,
 * agent first; each question carries its byte-pinned copy; a missing
 * referenced agent throws.
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
  metadata: { id: "agt_01public", name: "helper", org: "publisher-org" },
});

function ctxFor(shareOrg: string, agentOrg: string, stash = true) {
  const ctx = new RequestContext(
    AgentShareSchema,
    create(AgentShareSchema, {
      metadata: { name: "helper", org: shareOrg },
      spec: { agentRef: { org: agentOrg, slug: "helper" } },
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
  it("a same-org share asks can_edit on the referenced agent", () => {
    expect(
      resolveShareCreateTargets(ctxFor("publisher-org", "publisher-org")),
    ).toEqual([
      {
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_01public",
        deniedMessage: SHARE_AGENT_DENIED_MESSAGE,
      },
    ]);
  });

  it("a cross-org share asks can_execute on the agent, then can_create_agent_share on the sharing organization", () => {
    expect(
      resolveShareCreateTargets(ctxFor("consumer-org", "publisher-org")),
    ).toEqual([
      {
        permission: IamPermission.can_execute,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_01public",
        deniedMessage: SHARE_AGENT_DENIED_MESSAGE,
      },
      {
        permission: IamPermission.can_create_agent_share,
        resourceKind: ApiResourceKind.organization,
        resourceId: "consumer-org",
        deniedMessage: SHARE_ORGANIZATION_DENIED_MESSAGE,
      },
    ]);
  });

  it("a missing referenced agent is a broken chain invariant and throws", () => {
    expect(() =>
      resolveShareCreateTargets(
        ctxFor("publisher-org", "publisher-org", false),
      ),
    ).toThrow("referenced agent not found in context");
  });
});
