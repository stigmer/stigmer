/**
 * Pins the create lane's authorization question (steps.ts,
 * resolveRoutineCreateTargets): can_edit on the REFERENCED AGENT with the
 * Java handler's copy, and nothing on the organization (the same-org
 * invariant already binds the routine to the agent's); a missing
 * referenced agent throws.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  REFERENCED_AGENT_KEY,
  ROUTINE_CREATE_DENIED_MESSAGE,
  resolveRoutineCreateTargets,
} from "../steps.js";

const agent = create(AgentSchema, {
  metadata: { id: "agt_01target", name: "helper", org: "acme" },
});

function ctxFor(stash = true) {
  const ctx = new RequestContext(
    RoutineSchema,
    create(RoutineSchema, { metadata: { name: "nightly", org: "acme" } }),
    testCallerIdentity(),
    ApiResourceKind.routine,
  );
  if (stash) {
    ctx.set(REFERENCED_AGENT_KEY, agent);
  }
  return ctx;
}

describe("resolveRoutineCreateTargets", () => {
  it("asks can_edit on the referenced agent and nothing else", () => {
    expect(resolveRoutineCreateTargets(ctxFor())).toEqual([
      {
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_01target",
        deniedMessage: ROUTINE_CREATE_DENIED_MESSAGE,
      },
    ]);
  });

  it("a missing referenced agent is a broken chain invariant and throws", () => {
    expect(() => resolveRoutineCreateTargets(ctxFor(false))).toThrow(
      "referenced agent not found in context",
    );
  });
});
