/**
 * Pins the session run-target resolver: a session's run target is the
 * agent it pins — agent#can_execute on status.agent_id, the id
 * ResolveSessionAgent wrote, with the domain's byte-pinned deny copy — and
 * whenever the write changes the pin: a create naming an agent, an update
 * moving to another agent or to another version of the same one. An
 * update that keeps the stored pin (an echo) is not re-asked, and a
 * session with no agent (the built-in assistant) has no target.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { runAgentDeniedMessage } from "../constants.js";
import { sessionRunTarget } from "../run-target.js";

function pinned(agentId: string, agentVersionHash = ""): Session {
  return create(SessionSchema, { status: { agentId, agentVersionHash } });
}

describe("sessionRunTarget", () => {
  it("targets the pinned agent with can_execute and the pinned copy on a create", () => {
    const target = sessionRunTarget(pinned("agt_01abc"), undefined);
    expect(target).toEqual({
      permission: IamPermission.can_execute,
      resourceKind: ApiResourceKind.agent,
      resourceId: "agt_01abc",
      deniedMessage: "unauthorized to run agent 'agt_01abc'",
    });
    expect(target?.deniedMessage).toBe(runAgentDeniedMessage("agt_01abc"));
  });

  it("targets the new agent when an update changes it", () => {
    expect(
      sessionRunTarget(pinned("agt_01new"), pinned("agt_01old"))?.resourceId,
    ).toBe("agt_01new");
  });

  it("targets an agent an update introduces on a built-in-assistant session", () => {
    expect(sessionRunTarget(pinned("agt_01new"), pinned(""))?.resourceId).toBe(
      "agt_01new",
    );
  });

  it("targets the agent when an update moves it to another version", () => {
    expect(
      sessionRunTarget(pinned("agt_01abc", "h2"), pinned("agt_01abc", "h1"))
        ?.resourceId,
    ).toBe("agt_01abc");
  });

  it("answers no target when an update keeps the stored pin", () => {
    expect(
      sessionRunTarget(pinned("agt_01abc", "h1"), pinned("agt_01abc", "h1")),
    ).toBeUndefined();
  });

  it("answers no target when the session pins no agent", () => {
    expect(
      sessionRunTarget(create(SessionSchema, {}), undefined),
    ).toBeUndefined();
    expect(sessionRunTarget(pinned(""), undefined)).toBeUndefined();
    expect(sessionRunTarget(pinned(""), pinned("agt_01old"))).toBeUndefined();
  });

  it("never reads the reference a client wrote, only the resolved pin", () => {
    const session = create(SessionSchema, {
      spec: {
        agentRef: { kind: ApiResourceKind.agent, org: "acme", slug: "pr" },
      },
    });
    expect(sessionRunTarget(session, undefined)).toBeUndefined();
  });
});
