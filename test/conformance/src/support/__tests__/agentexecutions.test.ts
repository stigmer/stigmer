// Unit arms for the submit-approval seam and the race proof beneath it: the
// proof finds exactly the tool calls decided in the approval-event stream and
// undecided in the transcript (root and sub-agent); the seam is submit-and-
// assert on a TS target and, on the registered Java target, prove-report-
// re-submit-assert. Pure: hand-built executions, a stub reader, no target.
// Domain: conformance support (execution engine).
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ApprovalEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decisionsLostFromTranscript,
  expectDecisionLostFromTranscript,
  submitApprovalPerContract,
  type AgentExecutionReader,
} from "../agentexecutions";
import type { TargetIdentity } from "../../targets/target";

interface ToolCallInit {
  id: string;
  action: ApprovalAction;
  // Placed on a sub-agent's transcript instead of the root's.
  nested?: boolean;
}

interface DecisionInit {
  toolCallId: string;
  type: ApprovalEventType;
}

function execution(opts: {
  pending?: string[];
  toolCalls?: ToolCallInit[];
  events?: DecisionInit[];
}): AgentExecution {
  const root = (opts.toolCalls ?? []).filter((tc) => tc.nested !== true);
  const nested = (opts.toolCalls ?? []).filter((tc) => tc.nested === true);
  return create(AgentExecutionSchema, {
    metadata: { id: "aex_unit" },
    status: {
      pendingApprovals: (opts.pending ?? []).map((toolCallId) => ({ toolCallId })),
      messages: [{ toolCalls: root.map((tc) => ({ id: tc.id, approvalAction: tc.action })) }],
      subAgentExecutions:
        nested.length === 0
          ? []
          : [{ messages: [{ toolCalls: nested.map((tc) => ({ id: tc.id, approvalAction: tc.action })) }] }],
      approvalEventStream: {
        events: (opts.events ?? []).map((event) => ({
          approvalRequestId: event.toolCallId,
          eventType: event.type,
        })),
      },
    },
  });
}

describe("decisionsLostFromTranscript", () => {
  it("names a tool call decided in the stream and undecided in the transcript — Java's only-in-scan divergence", () => {
    const lost = decisionsLostFromTranscript(
      execution({
        toolCalls: [{ id: "call_reject", action: ApprovalAction.UNSPECIFIED }],
        events: [
          { toolCallId: "call_reject", type: ApprovalEventType.REQUESTED },
          { toolCallId: "call_reject", type: ApprovalEventType.REJECTED },
        ],
      }),
    );
    expect(lost).toEqual(["call_reject"]);
  });

  it("is empty when the transcript carries the decision (the contract) or the stream has none (an undecided gate)", () => {
    expect(
      decisionsLostFromTranscript(
        execution({
          toolCalls: [{ id: "call_ok", action: ApprovalAction.APPROVE }],
          events: [{ toolCallId: "call_ok", type: ApprovalEventType.APPROVED }],
        }),
      ),
    ).toEqual([]);
    expect(
      decisionsLostFromTranscript(
        execution({
          toolCalls: [{ id: "call_waiting", action: ApprovalAction.UNSPECIFIED }],
          events: [{ toolCallId: "call_waiting", type: ApprovalEventType.REQUESTED }],
        }),
      ),
    ).toEqual([]);
  });

  it("scans sub-agent transcripts too, and reports only the lost one of a co-pending pair", () => {
    const lost = decisionsLostFromTranscript(
      execution({
        toolCalls: [
          { id: "call_all_1", action: ApprovalAction.APPROVE_ALL },
          { id: "call_all_2", action: ApprovalAction.UNSPECIFIED, nested: true },
        ],
        events: [
          { toolCallId: "call_all_1", type: ApprovalEventType.APPROVED },
          { toolCallId: "call_all_2", type: ApprovalEventType.APPROVED },
        ],
      }),
    );
    expect(lost).toEqual(["call_all_2"]);
  });

  it("expectDecisionLostFromTranscript throws with both sides named when nothing was lost", () => {
    expect(() =>
      expectDecisionLostFromTranscript(
        execution({
          toolCalls: [{ id: "call_x", action: ApprovalAction.UNSPECIFIED }],
          events: [{ toolCallId: "call_x", type: ApprovalEventType.REQUESTED }],
        }),
      ),
    ).toThrow(/decided in stream: \[\], undecided in transcript: \["call_x"\]/);
  });
});

describe("submitApprovalPerContract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The two identities the seam distinguishes: the same "cloud-execution"
  // deployment shape served by either implementation. The race is Java's; the
  // composition behind the same target name asserts the contract, full stop.
  const tsTarget: TargetIdentity = { name: "local-execution", implementation: "stigmer-server" };
  const compositionTarget: TargetIdentity = { name: "cloud-execution", implementation: "stigmer-server" };
  const javaTarget: TargetIdentity = { name: "cloud-execution", implementation: "stigmer-service" };

  const settled = execution({ pending: [], toolCalls: [{ id: "call_a", action: ApprovalAction.APPROVE }] });
  const raced = execution({
    pending: ["call_a"],
    toolCalls: [{ id: "call_a", action: ApprovalAction.UNSPECIFIED }],
    events: [{ toolCallId: "call_a", type: ApprovalEventType.APPROVED }],
  });
  const reader = (readBack: AgentExecution): AgentExecutionReader => ({
    agentExecutionQuery: { get: async () => readBack },
  });

  it("on a TS target is submit-and-assert, returning the response", async () => {
    const submit = vi.fn(async () => settled);
    const response = await submitApprovalPerContract(tsTarget, reader(settled), {
      executionId: "aex_unit",
      expectedRemaining: 0,
      label: "approve clears the gate",
      submit,
    });
    expect(response).toBe(settled);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("on a TS target a failed contract is red — the race path is not open there", async () => {
    const read = vi.fn(async () => raced);
    await expect(
      submitApprovalPerContract(tsTarget, { agentExecutionQuery: { get: read } }, {
        executionId: "aex_unit",
        expectedRemaining: 0,
        label: "approve clears the gate",
        submit: async () => raced,
      }),
    ).rejects.toThrow("approve clears the gate");
    expect(read).not.toHaveBeenCalled();
  });

  it("on the composition behind the cloud-execution NAME a failed contract is red too — the race is keyed on the implementation, not the name", async () => {
    const read = vi.fn(async () => raced);
    await expect(
      submitApprovalPerContract(compositionTarget, { agentExecutionQuery: { get: read } }, {
        executionId: "aex_unit",
        expectedRemaining: 0,
        label: "approve clears the gate",
        submit: async () => raced,
      }),
    ).rejects.toThrow("approve clears the gate");
    expect(read).not.toHaveBeenCalled();
  });

  it("on the Java target proves the race from a fresh read, re-submits once, and returns the response that held", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const responses = [raced, settled];
    const submit = vi.fn(async () => responses.shift()!);
    const response = await submitApprovalPerContract(javaTarget, reader(raced), {
      executionId: "aex_unit",
      expectedRemaining: 0,
      label: "approve clears the gate",
      submit,
    });
    expect(response).toBe(settled);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("tracked race java.agentexecution.submit-approval.lost-update-race on cloud-execution (stigmer-service)"));
  });

  it("on the Java target a failure the fresh read cannot explain stays red", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const unexplained = execution({ pending: ["call_a"], toolCalls: [{ id: "call_a", action: ApprovalAction.UNSPECIFIED }] });
    const submit = vi.fn(async () => unexplained);
    await expect(
      submitApprovalPerContract(javaTarget, reader(unexplained), {
        executionId: "aex_unit",
        expectedRemaining: 0,
        label: "approve clears the gate",
        submit,
      }),
    ).rejects.toThrow("the known race: the approval-event stream carries a decision the transcript does not");
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
