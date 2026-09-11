/**
 * Pins the agent-execution run-target resolver (P1 sp.run-gate, ruling
 * Q-RG-2): the target is dispatched on the request shape in the CHAIN's
 * own precedence — session_id, then session_spec.agent_instance_id, then
 * agent_id (CreateDefaultInstanceIfNeeded / CreateSessionIfNeeded read
 * them in exactly that order) — so the gate authorizes the target the
 * chain will actually use. Each shape carries its own permission and its
 * own byte-pinned deny copy; a record with none of the three has no
 * target (EnsureSessionOrAgentResolved owns that arm as an invariant).
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  addExecutionToSessionDeniedMessage,
  runAgentDeniedMessage,
  runAgentInstanceDeniedMessage,
} from "../constants.js";
import { agentExecutionRunTarget } from "../run-target.js";

describe("agentExecutionRunTarget", () => {
  it("session_id → session#can_create_execution_in", () => {
    expect(
      agentExecutionRunTarget(
        create(AgentExecutionSchema, { spec: { sessionId: "ses_01abc" } }),
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

  it("session_spec.agent_instance_id → agent_instance#can_execute", () => {
    expect(
      agentExecutionRunTarget(
        create(AgentExecutionSchema, {
          spec: { sessionSpec: { agentInstanceId: "agi_01abc" } },
        }),
      ),
    ).toEqual({
      permission: IamPermission.can_execute,
      resourceKind: ApiResourceKind.agent_instance,
      resourceId: "agi_01abc",
      deniedMessage: runAgentInstanceDeniedMessage("agi_01abc"),
    });
    expect(runAgentInstanceDeniedMessage("agi_01abc")).toBe(
      "unauthorized to run agent instance 'agi_01abc'",
    );
  });

  it("agent_id → agent#can_execute", () => {
    expect(
      agentExecutionRunTarget(
        create(AgentExecutionSchema, { spec: { agentId: "agt_01abc" } }),
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

  it("precedence is the chain's: session_id wins over both, the instance over agent_id", () => {
    const all = agentExecutionRunTarget(
      create(AgentExecutionSchema, {
        spec: {
          sessionId: "ses_01abc",
          agentId: "agt_01abc",
          sessionSpec: { agentInstanceId: "agi_01abc" },
        },
      }),
    );
    expect(all?.resourceKind).toBe(ApiResourceKind.session);
    expect(all?.resourceId).toBe("ses_01abc");

    const instanceAndAgent = agentExecutionRunTarget(
      create(AgentExecutionSchema, {
        spec: {
          agentId: "agt_01abc",
          sessionSpec: { agentInstanceId: "agi_01abc" },
        },
      }),
    );
    expect(instanceAndAgent?.resourceKind).toBe(ApiResourceKind.agent_instance);
    expect(instanceAndAgent?.resourceId).toBe("agi_01abc");
  });

  it("answers no target when none of the three references is set", () => {
    expect(
      agentExecutionRunTarget(create(AgentExecutionSchema, {})),
    ).toBeUndefined();
    expect(
      agentExecutionRunTarget(
        create(AgentExecutionSchema, {
          spec: {
            sessionId: "",
            agentId: "",
            sessionSpec: { agentInstanceId: "" },
          },
        }),
      ),
    ).toBeUndefined();
  });
});
