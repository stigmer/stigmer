/**
 * Pins the session run-target resolver (P1 sp.run-gate): a session's run
 * target is the agent instance it binds to — agent_instance#can_execute on
 * spec.agent_instance_id, with the domain's byte-pinned deny copy — and a
 * session with no instance yet has no target (ResolveDefaultAgentInstance
 * guarantees one before the step runs; an empty id reaching the resolver
 * is the guard's arm, not a check to make).
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { runAgentInstanceDeniedMessage } from "../constants.js";
import { sessionRunTarget } from "../run-target.js";

describe("sessionRunTarget", () => {
  it("targets the bound agent instance with can_execute and the pinned copy", () => {
    const target = sessionRunTarget(
      create(SessionSchema, { spec: { agentInstanceId: "agi_01abc" } }),
    );
    expect(target).toEqual({
      permission: IamPermission.can_execute,
      resourceKind: ApiResourceKind.agent_instance,
      resourceId: "agi_01abc",
      deniedMessage: "unauthorized to run agent instance 'agi_01abc'",
    });
    expect(target?.deniedMessage).toBe(
      runAgentInstanceDeniedMessage("agi_01abc"),
    );
  });

  it("answers no target when the session names no instance", () => {
    expect(sessionRunTarget(create(SessionSchema, {}))).toBeUndefined();
    expect(
      sessionRunTarget(
        create(SessionSchema, { spec: { agentInstanceId: "" } }),
      ),
    ).toBeUndefined();
  });
});
