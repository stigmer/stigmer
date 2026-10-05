/**
 * Pins the deciding hook's copy through both pending-approval
 * projections: a call a plugin's hook asked for carries
 * approval_policy_hook beside approval_policy_source from the ToolCall to
 * the message scan's PendingApproval (compute.ts), to the REQUESTED
 * event's ApprovalRequest (emit.ts), and from that event back to the
 * event-stream projection's PendingApproval (compute-from-events.ts), so
 * the two projections agree and an approval surface can name the plugin
 * without a lookup.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  ApprovalPolicySource,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

import { computePendingApprovals } from "../compute.js";
import { computePendingApprovalsFromEvents } from "../compute-from-events.js";
import { emitApprovalEvents } from "../emit.js";

describe("approval_policy_hook through the projections", () => {
  it("reaches the message scan, the requested event and the event-stream projection alike", () => {
    const messages = [
      create(AgentMessageSchema, {
        toolCalls: [
          {
            id: "tc-push",
            name: "execute",
            status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requiresApproval: true,
            approvalRequestedAt: "2026-10-05T00:00:00Z",
            approvalPolicySource: ApprovalPolicySource.HOOK,
            approvalPolicyHook: "safety",
          },
        ],
      }),
    ];

    const fromScan = computePendingApprovals(messages, []);
    expect(
      fromScan.map((p) => [p.approvalPolicySource, p.approvalPolicyHook]),
    ).toEqual([[ApprovalPolicySource.HOOK, "safety"]]);

    const stream = emitApprovalEvents(messages, []);
    const requested = stream.events[0]?.payload;
    expect(
      requested?.case === "requested" && requested.value.approvalPolicyHook,
    ).toBe("safety");

    const fromEvents = computePendingApprovalsFromEvents(stream);
    expect(
      fromEvents.map((p) => [p.approvalPolicySource, p.approvalPolicyHook]),
    ).toEqual([[ApprovalPolicySource.HOOK, "safety"]]);
  });
});
