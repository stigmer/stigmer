/**
 * Pins the create lane's authorization question (steps.ts,
 * resolveScheduleCreateTargets): can_edit on the REFERENCED AGENT with the
 * Java handler's copy, and nothing on the organization (the same-org
 * invariant already binds the schedule to the agent's); a missing
 * referenced agent throws.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  REFERENCED_AGENT_KEY,
  SCHEDULE_CREATE_DENIED_MESSAGE,
  resolveScheduleCreateTargets,
} from "../steps.js";

const agent = create(AgentSchema, {
  metadata: { id: "agt_01target", name: "helper", org: "acme" },
});

function ctxFor(stash = true) {
  const ctx = new RequestContext(
    ScheduleSchema,
    create(ScheduleSchema, { metadata: { name: "nightly", org: "acme" } }),
    testCallerIdentity(),
    ApiResourceKind.schedule,
  );
  if (stash) {
    ctx.set(REFERENCED_AGENT_KEY, agent);
  }
  return ctx;
}

describe("resolveScheduleCreateTargets", () => {
  it("asks can_edit on the referenced agent and nothing else", () => {
    expect(resolveScheduleCreateTargets(ctxFor())).toEqual([
      {
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_01target",
        deniedMessage: SCHEDULE_CREATE_DENIED_MESSAGE,
      },
    ]);
  });

  it("a missing referenced agent is a broken chain invariant and throws", () => {
    expect(() => resolveScheduleCreateTargets(ctxFor(false))).toThrow(
      "referenced agent not found in context",
    );
  });
});
