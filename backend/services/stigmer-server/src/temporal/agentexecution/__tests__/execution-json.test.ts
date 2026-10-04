/**
 * The workflow's load of its execution tolerates what an older server
 * wrote: a local activity's result is replayed from history, so an
 * execution in flight across a deploy is decoded from JSON that may carry
 * a reserved enum name or field. Pins that such JSON decodes, the reserved
 * enum reading as its zero value, and that everything else survives.
 */
import { describe, expect, it } from "vitest";
import { ApprovalPolicySource, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { decodeLoadedExecution } from "../execution-json.js";

describe("decodeLoadedExecution", () => {
  it("decodes a tool call carrying a reserved provenance name as UNSPECIFIED, keeping the rest", () => {
    const execution = decodeLoadedExecution({
      metadata: { id: "aex_1" },
      status: {
        messages: [
          {
            toolCalls: [
              {
                id: "call_1",
                name: "search_issues",
                status: "TOOL_CALL_COMPLETED",
                approvalPolicySource: "APPROVAL_POLICY_SOURCE_CLASSIFIER_DEFAULT",
              },
            ],
          },
        ],
      },
    });
    const call = execution.status?.messages[0]?.toolCalls[0];
    expect(execution.metadata?.id).toBe("aex_1");
    expect(call?.name).toBe("search_issues");
    expect(call?.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(call?.approvalPolicySource).toBe(ApprovalPolicySource.UNSPECIFIED);
  });

  it("drops a field the contract no longer knows", () => {
    const execution = decodeLoadedExecution({ metadata: { id: "aex_2" }, removedField: true });
    expect(execution.metadata?.id).toBe("aex_2");
  });
});
