/**
 * Pins the agent-execution run-gate resolvers, the turn's two questions:
 *   - agentExecutionRunTarget (AuthorizeRunTarget) asks only about the
 *     conversation a turn continues: session#can_create_execution_in on
 *     the target's session_id, with its byte-pinned deny copy. A new
 *     conversation (a session_spec, whatever agent it names) and the
 *     built-in assistant (no target) answer no target here: the session
 *     create the chain runs asks about the agent itself.
 *   - agentExecutionRunAgent (AuthorizeRunAgent) asks agent#can_execute on
 *     the stamp ResolveRunAgent wrote (status.agent_id), never on anything
 *     the request names in spec; no stamp is the built-in assistant, with
 *     no target.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  addExecutionToSessionDeniedMessage,
  runAgentDeniedMessage,
} from "../constants.js";
import {
  agentExecutionRunAgent,
  agentExecutionRunTarget,
} from "../run-target.js";

const AGENT_REF = {
  kind: ApiResourceKind.agent,
  org: "acme",
  slug: "pr-reviewer",
};

describe("agentExecutionRunTarget", () => {
  it("session_id → session#can_create_execution_in", () => {
    expect(
      agentExecutionRunTarget(
        create(AgentExecutionSchema, {
          spec: { target: { case: "sessionId", value: "ses_01abc" } },
        }),
      ),
    ).toEqual({
      permission: IamPermission.can_create_execution_in,
      resourceKind: ApiResourceKind.session,
      resourceId: "ses_01abc",
      deniedMessage: addExecutionToSessionDeniedMessage("ses_01abc"),
    });
    expect(addExecutionToSessionDeniedMessage("ses_01abc")).toBe(
      "unauthorized to add an execution to session 'ses_01abc'",
    );
  });

  it("asks about the session even when the turn's status names an agent", () => {
    const target = agentExecutionRunTarget(
      create(AgentExecutionSchema, {
        spec: { target: { case: "sessionId", value: "ses_01abc" } },
        status: { agentId: "agt_01abc" },
      }),
    );
    expect(target?.resourceKind).toBe(ApiResourceKind.session);
    expect(target?.resourceId).toBe("ses_01abc");
  });

  it("answers no target for a new conversation, whatever agent it names", () => {
    expect(
      agentExecutionRunTarget(
        create(AgentExecutionSchema, {
          spec: {
            target: { case: "sessionSpec", value: { agentRef: AGENT_REF } },
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("answers no target for the built-in assistant or an empty session_id", () => {
    expect(
      agentExecutionRunTarget(create(AgentExecutionSchema, {})),
    ).toBeUndefined();
    expect(
      agentExecutionRunTarget(
        create(AgentExecutionSchema, {
          spec: { target: { case: "sessionId", value: "" } },
        }),
      ),
    ).toBeUndefined();
  });
});

describe("agentExecutionRunAgent", () => {
  it("status.agent_id → agent#can_execute", () => {
    expect(
      agentExecutionRunAgent(
        create(AgentExecutionSchema, {
          spec: { target: { case: "sessionId", value: "ses_01abc" } },
          status: { agentId: "agt_01abc", agentVersionHash: "h1" },
        }),
      ),
    ).toEqual({
      permission: IamPermission.can_execute,
      resourceKind: ApiResourceKind.agent,
      resourceId: "agt_01abc",
      deniedMessage: runAgentDeniedMessage("agt_01abc"),
    });
    expect(runAgentDeniedMessage("agt_01abc")).toBe(
      "unauthorized to run agent 'agt_01abc'",
    );
  });

  it("answers no target when nothing is stamped, whatever the spec names", () => {
    expect(
      agentExecutionRunAgent(create(AgentExecutionSchema, {})),
    ).toBeUndefined();
    expect(
      agentExecutionRunAgent(
        create(AgentExecutionSchema, {
          spec: {
            target: { case: "sessionSpec", value: { agentRef: AGENT_REF } },
          },
          status: { agentId: "" },
        }),
      ),
    ).toBeUndefined();
  });
});
