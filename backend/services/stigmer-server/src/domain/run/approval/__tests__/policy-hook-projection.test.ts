/**
 * Pins the deciding hook's copy through the pending-approval scan: a call
 * a plugin's hook asked for carries approval_policy_hook beside
 * approval_policy_source from the ToolCall to its PendingApproval
 * (compute.ts), so an approval surface can name the plugin without a
 * lookup.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  ApprovalPolicySource,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";

import { computePendingApprovals } from "../compute.js";

describe("approval_policy_hook through the scan", () => {
  it("reaches the pending approval", () => {
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
  });
});
